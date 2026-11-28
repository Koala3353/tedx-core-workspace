-- Owner reports: a daily summary email and urgent alert emails, sent by the Apps Script project
-- (apps-script/Code.gs: sendDailyReport, checkUrgent) through the ops-report edge function.
--
-- 1. Client error capture. Signed-in browsers report uncaught errors, failed promises, page render
--    errors and unexpected command failures through public.log_client_error. Text is scrubbed again
--    here (emails, URL query strings, long tokens and long numbers removed), grouped by a
--    server-computed fingerprint, capped per person (20 an hour) and globally (300 an hour), and kept
--    60 days (hourly counters 8 days). No request bodies or form contents are accepted; the only
--    identifier stored is the auth user id in the hourly counters (per-person cap, people affected).
-- 2. public.ops_report(kind, nonce): service role only. Read-only aggregate snapshot of usage, work and
--    system health. The nonce is recorded once (replay protection for the HMAC-signed Apps Script
--    call); a reused nonce returns {"error":"replay"}.
-- Every table is private (RLS forced, no grants) and registered in the disposition registry.
begin;

create table app_private.client_errors (
  fingerprint text primary key check(fingerprint ~ '^[a-f0-9]{64}$'),
  kind text not null check(kind in ('error','rejection','render','command')),
  message text not null check(length(message) between 1 and 300),
  route text not null check(length(route) between 1 and 200),
  stack text check(stack is null or length(stack) <= 1200),
  build text check(build is null or build ~ '^[A-Za-z0-9._-]{1,64}$'),
  agent text check(agent is null or agent ~ '^[A-Za-z0-9 ._/-]{1,40}$'),
  hits integer not null default 1 check(hits >= 1),
  first_seen timestamptz not null default statement_timestamp(),
  last_seen timestamptz not null default statement_timestamp()
);
create index client_errors_last_seen on app_private.client_errors(last_seen);

create table app_private.client_error_hits (
  auth_user_id uuid not null,
  fingerprint text not null references app_private.client_errors(fingerprint) on delete cascade,
  hour timestamptz not null,
  hits integer not null default 1 check(hits >= 1),
  primary key(auth_user_id, hour, fingerprint)
);
create index client_error_hits_hour on app_private.client_error_hits(hour);
create index client_error_hits_fingerprint on app_private.client_error_hits(fingerprint, hour);

create table app_private.ops_report_nonces (
  nonce text primary key check(nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  seen_at timestamptz not null default statement_timestamp()
);
create index ops_report_nonces_seen on app_private.ops_report_nonces(seen_at);

do $$
declare relation text;
begin
  foreach relation in array array['client_errors','client_error_hits','ops_report_nonces'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

-- Removes what could identify a person or carry a secret from free text, then trims to p_limit.
create function app_private.client_error_clean(p_text text, p_limit integer) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    left(coalesce(p_text, ''), 4000),
    '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+', ' ', 'g'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '[email]', 'g'),
    '((https?://|/)[^\s?#''"()]*)[?#][^\s''"()]*', '\1', 'g'),
    'eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+){0,2}', '[token]', 'g'),
    '[A-Za-z0-9_+/=]{32,}', '[token]', 'g'),
    '\d{7,}', '[number]', 'g'), p_limit)), '');
$$;

create function public.log_client_error(p_kind text, p_message text, p_route text, p_stack text default null,
  p_build text default null, p_agent text default null) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  uid uuid := auth.uid();
  now_at timestamptz := statement_timestamp();
  this_hour timestamptz := date_trunc('hour', statement_timestamp());
  message text; route text; stack text; build text; agent text; fp text;
begin
  if uid is null then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  if p_kind is null or p_kind not in ('error','rejection','render','command') then
    return jsonb_build_object('recorded', false, 'reason', 'invalid');
  end if;
  message := app_private.client_error_clean(p_message, 300);
  if message is null then return jsonb_build_object('recorded', false, 'reason', 'invalid'); end if;
  -- Routes keep their shape (ids become :id), never a query string or fragment.
  route := left(regexp_replace(regexp_replace(split_part(split_part(coalesce(p_route, '/'), '?', 1), '#', 1),
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g'), '[^A-Za-z0-9/._:~-]', '', 'g'), 200);
  if route = '' or left(route, 1) <> '/' then route := '/'; end if;
  stack := app_private.client_error_clean(p_stack, 1200);
  build := case when p_build ~ '^[A-Za-z0-9._-]{1,64}$' then p_build end;
  agent := case when p_agent ~ '^[A-Za-z0-9 ._/-]{1,40}$' then p_agent end;

  -- Per-person cap (20 an hour) and global cap (300 an hour). Over a cap is not an error for the browser.
  if (select coalesce(sum(h.hits), 0) from app_private.client_error_hits h where h.auth_user_id = uid and h.hour = this_hour) >= 20
    or (select coalesce(sum(h.hits), 0) from app_private.client_error_hits h where h.hour = this_hour) >= 300 then
    return jsonb_build_object('recorded', false, 'reason', 'limited');
  end if;

  -- One fingerprint per error shape: numbers, ids and build hashes do not split it; kind, route and first frame do.
  fp := encode(sha256(convert_to(p_kind || E'\n' ||
    regexp_replace(regexp_replace(message, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g'), '\d+', '0', 'g')
    || E'\n' || route || E'\n' ||
    regexp_replace(regexp_replace(coalesce(split_part(stack, E'\n', 1), ''), '-[A-Za-z0-9_-]{8}\.js', '.js', 'g'), ':\d+', '', 'g'),
    'UTF8')), 'hex');

  insert into app_private.client_errors as e(fingerprint, kind, message, route, stack, build, agent)
    values(fp, p_kind, message, route, stack, build, agent)
  on conflict(fingerprint) do update set hits = least(e.hits, 2000000000) + 1, last_seen = now_at,
    message = excluded.message, stack = coalesce(excluded.stack, e.stack), build = coalesce(excluded.build, e.build),
    agent = coalesce(excluded.agent, e.agent);
  insert into app_private.client_error_hits as h(auth_user_id, fingerprint, hour) values(uid, fp, this_hour)
  on conflict(auth_user_id, hour, fingerprint) do update set hits = h.hits + 1;

  -- Small opportunistic retention: hourly counters 8 days, errors 60 days.
  delete from app_private.client_error_hits where ctid in (
    select ctid from app_private.client_error_hits where hour < now_at - interval '8 days' limit 200);
  delete from app_private.client_errors where fingerprint in (
    select fingerprint from app_private.client_errors where last_seen < now_at - interval '60 days' limit 50);
  return jsonb_build_object('recorded', true);
end
$$;

-- Read-only snapshot. The summary window is 24 hours for 'daily' and 1 hour for 'urgent' (which skips
-- usage and work). Alert inputs (last hour, late and stuck thresholds) use fixed windows. Names appear
-- only where the owner would act on them (never-signed-in members, overdue and due-soon owners).
create function app_private.ops_report_data(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare
  now_at timestamptz := statement_timestamp();
  since timestamptz := statement_timestamp() - case when p_kind = 'daily' then interval '24 hours' else interval '1 hour' end;
  hour_ago timestamptz := statement_timestamp() - interval '1 hour';
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
  t public.terms;
  usage jsonb := '{}'; work jsonb := '{}'; health jsonb;
begin
  select * into t from public.terms where state = 'active' order by starts_on desc nulls last, id limit 1;

  if p_kind = 'daily' and t.id is not null then
    with roster as (
      select tm.id membership_id, m.display_name, m.auth_user_id, u.last_sign_in_at, u.created_at account_created_at,
        cs.installed_at, cs.tutorial_done_at, cs.setup_done_at,
        greatest(u.last_sign_in_at, cs.last_active_at,
          (select max(r.occurred_at) from public.restricted_access_events r
            where r.term_id = t.id and r.occurred_at > now_at - interval '7 days' and r.actor_id = m.auth_user_id)) active_at
      from public.term_memberships tm join public.members m on m.id = tm.member_id
      left join auth.users u on u.id = m.auth_user_id
      left join app_private.member_client_state cs on cs.term_membership_id = tm.id
      where tm.term_id = t.id and tm.membership_kind = 'core' and tm.status = 'active'
    )
    select jsonb_build_object(
      'members', count(*),
      'signedInEver', count(*) filter (where last_sign_in_at is not null),
      'neverSignedIn', count(*) filter (where last_sign_in_at is null),
      'neverSignedInNames', coalesce((select jsonb_agg(x.display_name order by x.display_name) from
        (select r2.display_name from roster r2 where r2.last_sign_in_at is null order by r2.display_name limit 15) x), '[]'),
      'active24h', count(*) filter (where active_at > now_at - interval '24 hours'),
      'active7d', count(*) filter (where active_at > now_at - interval '7 days'),
      'signInsWindow', count(*) filter (where last_sign_in_at > since),
      'newAccountsWindow', count(*) filter (where account_created_at > since),
      'installed', count(*) filter (where installed_at is not null),
      'tutorialDone', count(*) filter (where tutorial_done_at is not null),
      'setupDone', count(*) filter (where setup_done_at is not null),
      'pushMembers', (select count(distinct s.membership_id) from app_private.push_subscriptions s
        where s.revoked_at is null and s.membership_id in (select membership_id from roster)),
      'pushDevices', (select count(*) from app_private.push_subscriptions s
        where s.revoked_at is null and s.membership_id in (select membership_id from roster)),
      'emailRemindersOn', (select count(*) from app_private.email_digest_preferences p
        where p.opted_at is not null and p.email_hash is not null and p.email_hash is distinct from p.bounced_hash
          and p.membership_id in (select membership_id from roster)),
      'telegramLinked', (select count(*) from app_private.telegram_links l
        where l.state = 'linked' and l.membership_id in (select membership_id from roster)),
      'signInMethods', coalesce((select jsonb_object_agg(p.provider, p.n) from (select i.provider, count(distinct i.user_id) n
        from auth.identities i where i.user_id in (select auth_user_id from roster) group by i.provider) p), '{}'),
      'committees', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'members', c.members, 'active7d', c.active)
          order by c.name) from (
        select ou.name, count(distinct r.membership_id) members,
          count(distinct r.membership_id) filter (where r.active_at > now_at - interval '7 days') active
        from public.unit_memberships um join public.org_units ou on ou.id = um.unit_id and ou.archived_at is null
        join roster r on r.membership_id = um.term_membership_id
        where um.term_id = t.id and um.status = 'active' group by ou.name) c), '[]'))
    into usage from roster;

    with open_work as (
      select w.id, w.kind, w.title, coalesce(w.due_on, (w.due_at at time zone 'Asia/Manila')::date) due_day,
        coalesce(tk.assignee_name, w.owner_display_name) owner, coalesce(ou.name, ou2.name) committee
      from public.work_items w
      left join public.tasks tk on tk.work_item_id = w.id
      left join public.deliverables d on d.work_item_id = w.id
      left join public.org_units ou on ou.id = tk.assigned_unit_id
      left join public.org_units ou2 on ou2.id = w.lead_unit_id
      where w.term_id = t.id and w.archived_at is null and w.kind in ('task','deliverable')
        and ((w.kind = 'task' and tk.workflow_state not in ('done','cancelled'))
          or (w.kind = 'deliverable' and d.workflow_state not in ('accepted','cancelled')))
    )
    select jsonb_build_object(
      'tasks', (select jsonb_build_object(
          'open', count(*) filter (where tk.workflow_state not in ('done','cancelled')),
          'createdWindow', count(*) filter (where tk.created_at > since),
          'doneWindow', count(*) filter (where tk.workflow_state = 'done' and tk.updated_at > since),
          'blocked', count(*) filter (where tk.workflow_state = 'blocked'),
          'inReview', count(*) filter (where tk.workflow_state = 'ready_for_review'))
        from public.tasks tk join public.work_items w on w.id = tk.work_item_id and w.archived_at is null where tk.term_id = t.id),
      'deliverables', (select jsonb_build_object(
          'open', count(*) filter (where d.workflow_state not in ('accepted','cancelled')),
          'createdWindow', count(*) filter (where d.created_at > since),
          'acceptedWindow', count(*) filter (where d.workflow_state = 'accepted' and d.updated_at > since),
          'blocked', count(*) filter (where d.is_blocked and d.workflow_state not in ('accepted','cancelled')),
          'submitted', count(*) filter (where d.workflow_state = 'submitted'))
        from public.deliverables d join public.work_items w on w.id = d.work_item_id and w.archived_at is null where d.term_id = t.id),
      'overdue', jsonb_build_object('count', (select count(*) from open_work where due_day < today),
        'items', coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'title', left(o.title, 120), 'committee', o.committee,
            'owner', o.owner, 'dueOn', o.due_day, 'days', today - o.due_day, 'path', o.kind || 's/' || o.id)
            order by o.due_day, o.title)
          from (select * from open_work where due_day < today order by due_day, title limit 10) o), '[]')),
      'dueSoon', jsonb_build_object('count', (select count(*) from open_work where due_day between today and today + 3),
        'items', coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'title', left(o.title, 120), 'committee', o.committee,
            'owner', o.owner, 'dueOn', o.due_day, 'days', o.due_day - today, 'path', o.kind || 's/' || o.id)
            order by o.due_day, o.title)
          from (select * from open_work where due_day between today and today + 3 order by due_day, title limit 10) o), '[]')),
      'requests', (select jsonb_build_object(
          'inReview', count(*) filter (where r.request_state = 'in_review'),
          'needsRevision', count(*) filter (where r.request_state = 'needs_revision'),
          'createdWindow', count(*) filter (where r.created_at > since and r.request_state <> 'draft'),
          'oldestInReviewDays', coalesce(floor(max(extract(epoch from now_at - r.updated_at) / 86400)
            filter (where r.request_state = 'in_review')), 0)::integer)
        from public.requests r where r.term_id = t.id),
      'approvals', (select jsonb_build_object('waiting', count(*),
          'oldestHours', coalesce(floor(max(extract(epoch from now_at - a.assigned_at) / 3600)), 0)::integer)
        from public.approval_assignments a join public.requests r on r.work_item_id = a.request_id and r.request_state = 'in_review'
        where a.term_id = t.id and (a.expires_at is null or a.expires_at > now_at)
          and not exists (select 1 from public.approval_decisions d where d.assignment_id = a.id)),
      'announcements', coalesce((select jsonb_agg(jsonb_build_object('title', left(x.title, 120), 'createdAt', x.created_at,
          'acknowledged', x.acks) order by x.created_at desc) from (
        select w.title, w.created_at, (select count(distinct k.actor_id) from public.announcement_acknowledgments k
          where k.announcement_id = w.id) acks
        from public.work_items w where w.term_id = t.id and w.kind = 'announcement' and w.archived_at is null
          and w.created_at > now_at - interval '14 days' order by w.created_at desc limit 5) x), '[]'),
      'calendar', coalesce((select jsonb_agg(jsonb_build_object('title', left(x.title, 120), 'startsAt', x.starts_at,
          'startOn', x.start_on, 'allDay', x.all_day) order by x.sort_at) from (
        select c.title, c.starts_at, c.start_on, c.all_day, coalesce(c.starts_at, c.start_on::timestamptz) sort_at
        from public.calendar_events c join public.work_items w on w.id = c.work_item_id
        where w.term_id = t.id and w.archived_at is null and c.state = 'confirmed' and c.visibility in ('core','unit')
          and coalesce(c.ends_at, c.end_on::timestamptz) > now_at and coalesce(c.starts_at, c.start_on::timestamptz) < now_at + interval '7 days'
        order by 5 limit 8) x), '[]'))
    into work;
  end if;

  select jsonb_build_object(
    'reminders', (select jsonb_build_object('lastRunAt', a.domain_checked_at,
        'minutesSince', case when a.domain_checked_at is not null then floor(extract(epoch from now_at - a.domain_checked_at) / 60)::integer end,
        'senderLive', a.revoked_at is null and (a.approval_expires_at is null or a.approval_expires_at > now_at),
        'quotaBlockedAt', a.quota_blocked_at, 'approvalExpiresAt', a.approval_expires_at, 'dailyCap', a.daily_cap,
        'attemptsToday', coalesce((select q.attempts from app_private.email_digest_quota q
          where q.term_id = a.term_id and q.utc_day = (now_at at time zone 'UTC')::date), 0))
      from app_private.email_sender_approvals a where a.term_id = t.id),
    'outbox', (select jsonb_build_object(
        'pending', count(*) filter (where o.state = 'pending'),
        'pendingLate', count(*) filter (where o.state = 'pending' and o.next_at < now_at - interval '30 minutes'),
        'oldestLateMinutes', coalesce(floor(extract(epoch from now_at - min(o.next_at) filter (where o.state = 'pending' and o.next_at < now_at)) / 60), 0)::integer,
        'stuck', count(*) filter (where o.state = 'claimed' and o.lease_until < now_at - interval '30 minutes'),
        'failedWindow', count(*) filter (where o.state = 'failed' and o.updated_at > since),
        'failedHour', count(*) filter (where o.state = 'failed' and o.updated_at > hour_ago),
        'deliveredWindow', count(*) filter (where o.state = 'delivered' and o.delivered_at > since))
      from public.outbox_jobs o where o.state in ('pending','claimed') or o.updated_at > since or o.delivered_at > since),
    'email', (select jsonb_build_object(
        'window', coalesce((select jsonb_object_agg(s.state, s.n) from (select e2.state, count(*) n from app_private.email_digest_jobs e2
          where e2.changed_at > since group by e2.state) s), '{}'),
        'failedHour', count(*) filter (where e.state in ('failed','bounced') and e.changed_at > hour_ago),
        'uncertainHour', count(*) filter (where e.state = 'uncertain' and e.changed_at > hour_ago),
        'waitingLate', count(*) filter (where e.state = 'waiting' and e.next_at < now_at - interval '45 minutes'),
        'stuckSending', count(*) filter (where e.state = 'sending' and e.lease_until < now_at - interval '30 minutes'))
      from app_private.email_digest_jobs e where e.state in ('waiting','sending') or e.changed_at > since),
    'push', (select jsonb_build_object(
        'window', coalesce((select jsonb_object_agg(s.state, s.n) from (select p2.state, count(*) n from app_private.push_deliveries p2
          where p2.updated_at > since group by p2.state) s), '{}'),
        'sentHour', count(*) filter (where p.state = 'sent' and p.updated_at > hour_ago),
        'failedHour', count(*) filter (where p.state = 'failed' and p.updated_at > hour_ago),
        'waitingLate', count(*) filter (where p.state = 'waiting' and p.run_at < now_at - interval '45 minutes'),
        'activeSubscriptions', (select count(*) from app_private.push_subscriptions s where s.revoked_at is null))
      from app_private.push_deliveries p where p.state in ('waiting','sending') or p.updated_at > since),
    'clientErrors', jsonb_build_object(
        'hitsWindow', coalesce((select sum(h.hits) from app_private.client_error_hits h where h.hour >= date_trunc('hour', since)), 0),
        'hitsHour', coalesce((select sum(h.hits) from app_private.client_error_hits h where h.hour >= date_trunc('hour', hour_ago)), 0),
        'fingerprintsWindow', (select count(*) from app_private.client_errors e where e.last_seen > since),
        'newWindow', (select count(*) from app_private.client_errors e where e.first_seen > since),
        'top', coalesce((select jsonb_agg(jsonb_build_object('fingerprint', left(x.fingerprint, 12), 'kind', x.kind, 'message', x.message,
            'route', x.route, 'frame', nullif(split_part(coalesce(x.stack, ''), E'\n', 1), ''), 'build', x.build, 'agent', x.agent,
            'hitsWindow', x.window_hits, 'hitsHour', x.hour_hits, 'total', x.hits, 'people', x.people,
            'firstSeen', x.first_seen, 'lastSeen', x.last_seen, 'isNew', x.first_seen > since) order by x.window_hits desc, x.last_seen desc)
          from (select e.fingerprint, e.kind, e.message, e.route, e.stack, e.build, e.agent, e.hits, e.first_seen, e.last_seen,
              coalesce(sum(h.hits), 0) window_hits,
              coalesce(sum(h.hits) filter (where h.hour >= date_trunc('hour', hour_ago)), 0) hour_hits,
              count(distinct h.auth_user_id) people
            from app_private.client_errors e left join app_private.client_error_hits h
              on h.fingerprint = e.fingerprint and h.hour >= date_trunc('hour', since)
            where e.last_seen > since group by e.fingerprint
            order by window_hits desc, e.last_seen desc limit 10) x), '[]')),
    'database', jsonb_build_object('bytes', pg_database_size(current_database()), 'planBytes', 500 * 1024 * 1024,
      'tables', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'bytes', x.bytes, 'rows', x.est) order by x.bytes desc) from (
        select n.nspname || '.' || c.relname name, pg_total_relation_size(c.oid) bytes, greatest(c.reltuples, 0)::bigint est
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','app_private','auth','storage')
        order by pg_total_relation_size(c.oid) desc limit 8) x), '[]')),
    'audit', jsonb_build_object(
      'restrictedEventsWindow', (select count(*) from public.restricted_access_events r where r.term_id = t.id and r.occurred_at > since),
      'restrictedEventsTotal', (select greatest(c.reltuples, 0)::bigint from pg_class c where c.oid = 'public.restricted_access_events'::regclass)),
    'migrations', (select jsonb_build_object('count', count(*), 'latest', max(m.version))
      from supabase_migrations.schema_migrations m))
  into health;

  return jsonb_build_object('kind', p_kind, 'generatedAt', now_at, 'since', since,
    'term', case when t.id is null then null else jsonb_build_object('label', t.label, 'eventDate', t.event_date,
      'daysToEvent', t.event_date - today) end,
    'usage', usage, 'work', work, 'health', health);
end
$$;

create function public.ops_report(p_kind text, p_nonce text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  if p_kind is null or p_kind not in ('daily','urgent') or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  delete from app_private.ops_report_nonces where seen_at < statement_timestamp() - interval '1 day';
  insert into app_private.ops_report_nonces(nonce) values(p_nonce) on conflict do nothing;
  if not found then return jsonb_build_object('error', 'replay'); end if;
  return app_private.ops_report_data(p_kind);
end
$$;

revoke all on function app_private.client_error_clean(text,integer), app_private.ops_report_data(text),
  public.log_client_error(text,text,text,text,text,text), public.ops_report(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.log_client_error(text,text,text,text,text,text) to authenticated;
grant execute on function public.ops_report(text,text) to service_role;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'shared',key_columns,null,app_private.disposition_structure('app_private.'||source),false
from (values
  ('client_errors','operational',array['fingerprint']),
  ('client_error_hits','security',array['auth_user_id','hour','fingerprint']),
  ('ops_report_nonces','security',array['nonce'])
) definitions(source,category,key_columns)
on conflict(source_key) do update set category=excluded.category,scope_kind=excluded.scope_kind,key_columns=excluded.key_columns,
  query_sql=excluded.query_sql,structure_hash=excluded.structure_hash,preserve=excluded.preserve;

commit;
