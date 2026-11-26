-- Typed email reminders on the existing opt-in email job queue.
-- Each job now carries one reminder kind, a dedupe key and an opaque target payload; the adapter
-- renders per-kind copy from the live content returned by prepare. Legacy digest rows stay readable.
-- Quota bounds rise to the Workspace MailApp daily ceiling; actual caps remain per approval row.
begin;

alter table app_private.email_sender_approvals drop constraint email_sender_approvals_daily_cap_check,
  add constraint email_sender_approvals_daily_cap_check check(daily_cap>=1 and daily_cap<=1500);
alter table app_private.email_digest_quota drop constraint email_digest_quota_attempts_check,
  add constraint email_digest_quota_attempts_check check(attempts>=1 and attempts<=1500);

alter table app_private.email_digest_jobs
  add column kind text not null default 'digest',
  add column reminder_key text,
  add column payload jsonb not null default '{}'::jsonb;
update app_private.email_digest_jobs set reminder_key='digest:'||to_char(digest_day,'YYYY-MM-DD') where reminder_key is null;
alter table app_private.email_digest_jobs alter column kind drop default,
  alter column reminder_key set not null,
  drop constraint email_digest_jobs_membership_id_digest_day_key,
  add constraint email_digest_jobs_kind_check check(kind in ('digest','task_due_soon','task_overdue','deliverable_due_soon',
    'deliverable_overdue','approval_waiting','announcement_unacknowledged','event_countdown')),
  add constraint email_digest_jobs_reminder_key_check check(length(reminder_key)>=1 and length(reminder_key)<=200),
  add constraint email_digest_jobs_payload_check check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=1024),
  add constraint email_digest_jobs_reminder unique(membership_id,reminder_key);
update app_private.disposition_sources set structure_hash=app_private.disposition_structure(source_key)
  where source_key in ('app_private.email_sender_approvals','app_private.email_digest_jobs','app_private.email_digest_quota');

-- A provider quota signal now pauses sending for 24 hours instead of indefinitely: MailApp quotas
-- refill daily, and a sticky block would silently stop every reminder until a manual reset.
create or replace function app_private.email_quota_blocked(a app_private.email_sender_approvals,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(a.quota_blocked_at>p_now-interval '24 hours',false) or coalesce((select q.attempts from app_private.email_digest_quota q
    where q.term_id=a.term_id and q.utc_day=(p_now at time zone 'UTC')::date),0)>=a.daily_cap;
$$;

-- Current content for one reminder, or null when it no longer applies to this recipient.
-- Copy never exposes restricted request content: approvals carry only a route.
create function app_private.email_reminder_content(p_kind text,p_payload jsonb,p_membership uuid,p_term uuid,p_day date,
  p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare local_day date:=(p_now at time zone 'Asia/Manila')::date; w public.work_items; due date; a public.approval_assignments;
  r public.requests; x public.workflow_instances; c public.presentation_controls; v public.presentation_versions; d jsonb;
  material uuid; published timestamptz; t public.terms; route text; days integer;
begin
  if p_kind is null or p_payload is null or p_membership is null or p_term is null or p_day is null or p_now is null
    or exists(select 1 from public.notification_preferences np where np.membership_id=p_membership and np.mode='mute') then
    return null;
  end if;
  if p_kind in ('task_due_soon','task_overdue','deliverable_due_soon','deliverable_overdue') then
    select * into w from public.work_items where id=(p_payload->>'workItemId')::uuid and term_id=p_term;
    if w.id is null or w.kind is distinct from split_part(p_kind,'_',1) or not coalesce(app_private.notification_pending(w),false)
      or app_private.notification_assignee(w) is distinct from p_membership
      or coalesce(w.due_on::text,w.due_at::text) is distinct from p_payload->>'deadline' then return null; end if;
    due:=coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date);
    if p_kind like '%_due_soon' and (p_day<>local_day or due-local_day not in (0,2)) then return null; end if;
    if p_kind like '%_overdue' and due>=local_day then return null; end if;
    return jsonb_build_object('type',p_kind,'path',w.kind||'s/'||w.id,'title',left(w.title,160),'dueOn',due,'daysLeft',due-local_day);
  elsif p_kind='approval_waiting' then
    select * into a from public.approval_assignments where id=(p_payload->>'assignmentId')::uuid and term_id=p_term
      and reviewer_id=p_membership;
    if a.id is null or a.assigned_at>p_now-interval '24 hours' or a.expires_at<=p_now
      or exists(select 1 from public.approval_decisions dd where dd.assignment_id=a.id) then return null; end if;
    select * into r from public.requests where work_item_id=a.request_id;
    select * into x from public.workflow_instances where id=a.instance_id;
    if r.request_state is distinct from 'in_review' or r.current_revision_id is distinct from a.revision_id
      or x.state is distinct from 'active' or x.generation is distinct from a.generation
      or not coalesce(app_private.workflow_assignment_current(a),false) then return null; end if;
    if exists(select 1 from public.finance_cases where request_id=a.request_id) then
      if app_private.finance_entry(r,x) is not null then return null; end if;
      route:='finance/reviews/';
    elsif exists(select 1 from public.publicity_reviews where request_id=a.request_id) then
      if app_private.publicity_entry(r,x) is not null then return null; end if;
      route:='publicity/';
    else
      route:='reviews/';
    end if;
    return jsonb_build_object('type',p_kind,'path',route||a.term_id||'/'||a.request_id);
  elsif p_kind='announcement_unacknowledged' then
    select pc.* into c from public.presentation_controls pc join public.work_items cw on cw.id=pc.work_item_id
      and cw.term_id=pc.term_id and cw.archived_at is null
    where pc.work_item_id=(p_payload->>'announcementId')::uuid and pc.term_id=p_term and pc.kind='bulletin';
    if c.work_item_id is null then return null; end if;
    select * into v from public.presentation_versions pv where pv.control_id=c.work_item_id order by pv.version desc limit 1;
    d:=v.definition;
    begin
      perform app_private.validate_presentation('bulletin',d);
    exception when invalid_parameter_value then return null;
    end;
    if d->>'requiredAck' is distinct from 'true' or coalesce((d->>'expiresAt')::timestamptz<=p_now,false) then return null; end if;
    material:=app_private.bulletin_material_revision(c.work_item_id,v.version,d);
    select pv.published_at into published from public.presentation_versions pv where pv.id=material;
    if material is null or material is distinct from (p_payload->>'materialRevisionId')::uuid
      or published is null or published>p_now-interval '48 hours' then return null; end if;
    if not ((c.target_kind='term' and c.target_id=p_term) or (c.target_kind='unit' and exists(
      select 1 from public.unit_memberships um join public.org_units u on u.id=um.unit_id and u.term_id=um.term_id and u.archived_at is null
      where um.term_membership_id=p_membership and um.term_id=p_term and um.unit_id=c.target_id and um.status='active'
        and um.effective_from<=p_now and um.effective_to>p_now))) then return null; end if;
    if exists(select 1 from public.announcement_acknowledgments ack join public.members m on m.auth_user_id=ack.actor_id
      join public.term_memberships tm on tm.member_id=m.id
      where tm.id=p_membership and ack.announcement_id=c.work_item_id and ack.material_revision_id=material) then return null; end if;
    return jsonb_build_object('type',p_kind,'path','announcements/'||c.work_item_id,'title',left(d->>'title',160));
  elsif p_kind='event_countdown' then
    select * into t from public.terms where id=p_term and state='active';
    days:=t.event_date-local_day;
    if t.id is null or p_day<>local_day or t.event_date is distinct from (p_payload->>'eventDate')::date
      or days is distinct from (p_payload->>'days')::integer or days not in (30,14,7,1) then return null; end if;
    return jsonb_build_object('type',p_kind,'path','','daysLeft',days,'eventDate',t.event_date,'termLabel',left(t.label,120));
  end if;
  return null;
end;
$$;

-- Bounded enqueue for one term. Only opted-in, unbounced, current school addresses are considered,
-- inside the same 08:00-20:00 Asia/Manila window prepare uses. The unique key makes each reminder fire
-- once per recipient per target per window: due in 2 days, due today, overdue (once per deadline,
-- for deadlines missed within the past week), approval assignment, announcement material revision,
-- and each 30/14/7/1-day event countdown.
create function app_private.email_enqueue_reminders(p_term_id uuid,p_now timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a app_private.email_sender_approvals; day date; local_time time; candidate record; added integer; n integer:=0;
begin
  if p_term_id is null or p_now is null or not isfinite(p_now) or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  select * into a from app_private.email_sender_approvals where term_id=p_term_id;
  if not found or not app_private.email_approval_live(a,p_now) or app_private.email_quota_blocked(a,p_now) then return 0; end if;
  day:=(p_now at time zone 'Asia/Manila')::date;
  local_time:=(p_now at time zone 'Asia/Manila')::time;
  if local_time<time '08:00' or local_time>=time '20:00' then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('email-reminders:'||p_term_id,0));
  for candidate in
    with recipients as materialized(
      select pr.membership_id,pr.generation,pr.email_hash from app_private.email_digest_preferences pr
        join public.term_memberships tm on tm.id=pr.membership_id
      where tm.term_id=p_term_id and pr.email_hash is not null and pr.email_hash is distinct from pr.bounced_hash
        and pr.email_hash=encode(sha256(convert_to(app_private.email_current_school_address(pr.membership_id),'UTF8')),'hex')
        and not exists(select 1 from public.notification_preferences np where np.membership_id=pr.membership_id and np.mode='mute')),
    dated as materialized(
      select w.*,coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date) due,coalesce(w.due_on::text,w.due_at::text) deadline
      from public.work_items w
      where w.term_id=p_term_id and w.archived_at is null and w.kind in ('task','deliverable')
        and coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date) in (day,day+2,day-1,day-2,day-3,day-4,day-5,day-6,day-7)),
    work as(
      select r.membership_id,r.generation,r.email_hash,
        dated.kind||case when dated.due<day then '_overdue' else '_due_soon' end kind,
        'work:'||dated.id||':'||dated.deadline||':'||case when dated.due<day then 'overdue' else 'due_'||(dated.due-day) end reminder_key,
        jsonb_build_object('workItemId',dated.id,'deadline',dated.deadline) payload
      from dated cross join lateral(select app_private.notification_assignee(w) assignee
          from public.work_items w where w.id=dated.id) owner
        join recipients r on r.membership_id=owner.assignee),
    approvals as(
      select r.membership_id,r.generation,r.email_hash,'approval_waiting'::text kind,'approval:'||aa.id reminder_key,
        jsonb_build_object('assignmentId',aa.id) payload
      from public.approval_assignments aa join recipients r on r.membership_id=aa.reviewer_id
      where aa.term_id=p_term_id and aa.assigned_at<=p_now-interval '24 hours' and aa.expires_at>p_now
        and not exists(select 1 from public.approval_decisions dd where dd.assignment_id=aa.id)),
    bulletins as materialized(
      select pc.work_item_id,app_private.bulletin_material_revision(pc.work_item_id,v.version,v.definition) material
      from public.presentation_controls pc
        cross join lateral(select pv.version,pv.definition from public.presentation_versions pv where pv.control_id=pc.work_item_id
          order by pv.version desc limit 1) v
      where pc.term_id=p_term_id and pc.kind='bulletin' and v.definition->>'requiredAck'='true'),
    announcements as(
      select r.membership_id,r.generation,r.email_hash,'announcement_unacknowledged'::text kind,
        'announcement:'||b.work_item_id||':'||b.material reminder_key,
        jsonb_build_object('announcementId',b.work_item_id,'materialRevisionId',b.material) payload
      from bulletins b cross join recipients r where b.material is not null),
    events as(
      select r.membership_id,r.generation,r.email_hash,'event_countdown'::text kind,
        'event:'||t.id||':'||to_char(t.event_date,'YYYY-MM-DD')||':'||(t.event_date-day) reminder_key,
        jsonb_build_object('eventDate',t.event_date,'days',t.event_date-day) payload
      from public.terms t cross join recipients r where t.id=p_term_id and t.state='active' and t.event_date-day in (30,14,7,1))
    select s.* from (select * from work union all select * from approvals union all select * from announcements
      union all select * from events) s
    where not exists(select 1 from app_private.email_digest_jobs j where j.membership_id=s.membership_id and j.reminder_key=s.reminder_key)
    order by s.reminder_key,s.membership_id
  loop
    exit when n>=p_limit;
    if app_private.email_reminder_content(candidate.kind,candidate.payload,candidate.membership_id,p_term_id,day,p_now) is null then
      continue;
    end if;
    insert into app_private.email_digest_jobs(term_id,membership_id,generation,email_hash,digest_day,next_at,kind,reminder_key,payload)
      values(p_term_id,candidate.membership_id,candidate.generation,candidate.email_hash,day,p_now,candidate.kind,
        candidate.reminder_key,candidate.payload)
      on conflict(membership_id,reminder_key) do nothing;
    get diagnostics added=row_count;
    n:=n+added;
  end loop;
  return n;
end;
$$;

-- The service entry keeps its in-app behavior and now also enqueues typed email reminders.
-- An email enqueue failure never blocks in-app reminders.
alter function public.enqueue_notification_reminders(integer) set schema app_private;
alter function app_private.enqueue_notification_reminders(integer) rename to enqueue_notification_reminders_before_email;
create function public.enqueue_notification_reminders(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare n integer; term uuid;
begin
  n:=app_private.enqueue_notification_reminders_before_email(p_limit);
  for term in select s.term_id from app_private.email_sender_approvals s where s.revoked_at is null order by s.term_id loop
    begin
      n:=n+app_private.email_enqueue_reminders(term,statement_timestamp(),p_limit);
    exception when others then
      raise warning using message='email_reminder_enqueue_failed',detail=sqlstate;
    end;
  end loop;
  return n;
end;
$$;

-- Same contract as before; prepare now sends queued typed reminders and returns their live content.
create or replace function app_private.email_dispatch_at(p_term_id uuid,p_action text,p_sender text,p_domain_id uuid,p_now timestamptz,
  p_id uuid,p_lease uuid,p_outcome text,p_provider_id uuid,p_delay integer) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a app_private.email_sender_approvals; job app_private.email_digest_jobs; prefs app_private.email_digest_preferences;
  local_time timestamp; target_day date; quota_day date; recipient text; state_after text; content jsonb;
begin
  select * into a from app_private.email_sender_approvals where term_id=p_term_id for update;
  if not found or a.sender is distinct from p_sender or a.domain_id is distinct from p_domain_id
    or not app_private.email_approval_live(a,p_now) then return jsonb_build_object('allowed',false,'blocked','sender'); end if;
  if p_action='domain' then
    update app_private.email_sender_approvals set domain_checked_at=case when p_outcome='verified' then p_now end
      where term_id=p_term_id;
    return jsonb_build_object('recorded',true);
  end if;
  if p_action='gate' then return jsonb_build_object('allowed',not coalesce(a.quota_blocked_at>p_now-interval '24 hours',false),
    'reason',case when a.quota_blocked_at>p_now-interval '24 hours' then 'quota' end); end if;
  if p_action='check' then
    select * into job from app_private.email_digest_jobs where term_id=p_term_id
      and state in ('accepted','delivered') and provider_id is not null and next_at<=p_now and verify_until>p_now
      and (lease is null or lease_until<=p_now)
      order by next_at,id limit 1 for update skip locked;
    if not found then return null; end if;
    update app_private.email_digest_jobs set lease=gen_random_uuid(),lease_until=p_now+interval '60 seconds'
      where id=job.id returning * into job;
    return jsonb_build_object('id',job.id,'lease',job.lease,'providerId',job.provider_id);
  end if;
  if p_action in ('finish','reconcile') then
    select * into job from app_private.email_digest_jobs where id=p_id and term_id=p_term_id and lease=p_lease
      and lease_until>p_now for update;
    if not found then return jsonb_build_object('recorded',false); end if;
    if p_action='reconcile' and job.state in ('accepted','delivered') and p_outcome in ('pending','delivered','bounced','failed') then
      state_after:=case when p_outcome='pending' then job.state else p_outcome end;
      update app_private.email_digest_jobs set state=state_after,lease=null,lease_until=null,next_at=p_now+interval '6 hours',
        changed_at=case when state_after<>state then p_now else changed_at end where id=job.id;
      if state_after='bounced' then
        update app_private.email_digest_preferences set bounced_hash=job.email_hash,
          email_hash=case when email_hash=job.email_hash then null else email_hash end,
          opted_at=case when email_hash=job.email_hash then null else opted_at end,version=version+1
          where membership_id=job.membership_id;
      end if;
    elsif p_action='finish' and job.state='sending' and p_outcome in ('accepted','failed','retry','quota','uncertain')
      and (p_outcome<>'accepted' or p_provider_id is not null)
      and (p_outcome<>'retry' or p_delay between 1 and 3600) then
      state_after:=case when p_outcome='retry' and job.attempts<4 then 'waiting'
        when p_outcome in ('quota','retry') then 'failed' else p_outcome end;
      update app_private.email_digest_jobs set state=state_after,lease=null,lease_until=null,changed_at=p_now,
        provider_id=case when state_after='accepted' then p_provider_id end,
        verify_until=case when state_after='accepted' then p_now+interval '7 days' end,
        next_at=p_now+case when state_after='accepted' then interval '5 minutes' when state_after='waiting'
          then greatest(p_delay,30*2^(job.attempts-1))*interval '1 second' else interval '0 seconds' end
        where id=job.id;
      if p_outcome='quota' then update app_private.email_sender_approvals set quota_blocked_at=p_now where term_id=p_term_id; end if;
    else
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    return jsonb_build_object('recorded',true);
  end if;
  if p_action is distinct from 'prepare' then raise exception using errcode='22023',message='command_validation_failed'; end if;
  if app_private.email_quota_blocked(a,p_now) then return jsonb_build_object('blocked','quota'); end if;
  if a.domain_checked_at is null or a.domain_checked_at<=p_now-interval '1 day' then
    return jsonb_build_object('blocked','domain');
  end if;
  update app_private.email_digest_jobs set state='uncertain',lease=null,lease_until=null,changed_at=p_now
    where id in(select id from app_private.email_digest_jobs where term_id=p_term_id and state='sending'
      and lease_until<=p_now order by lease_until limit 24 for update skip locked);
  local_time:=p_now at time zone 'Asia/Manila';
  if local_time::time<time '08:00' or local_time::time>=time '20:00' then return null; end if;
  target_day:=local_time::date-1;
  quota_day:=(p_now at time zone 'UTC')::date;
  select * into job from app_private.email_digest_jobs where term_id=p_term_id and state='waiting'
    and next_at<=p_now order by next_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  select * into prefs from app_private.email_digest_preferences where membership_id=job.membership_id for share;
  recipient:=app_private.email_current_school_address(job.membership_id);
  if job.kind='digest' then
    if job.digest_day=target_day and app_private.email_has_digest(prefs,target_day,p_now) then
      content:=jsonb_build_object('type','digest','path','');
    end if;
  else
    content:=app_private.email_reminder_content(job.kind,job.payload,job.membership_id,job.term_id,job.digest_day,p_now);
  end if;
  if prefs.generation is distinct from job.generation or recipient is null or prefs.email_hash is distinct from job.email_hash
    or prefs.email_hash=prefs.bounced_hash or content is null
    or job.email_hash is distinct from encode(sha256(convert_to(recipient,'UTF8')),'hex') then
    update app_private.email_digest_jobs set state='skipped',changed_at=p_now where id=job.id;
    return jsonb_build_object('skipped',true);
  end if;
  insert into app_private.email_digest_quota as q(term_id,utc_day,attempts) values(p_term_id,quota_day,1)
    on conflict(term_id,utc_day) do update set attempts=q.attempts+1;
  update app_private.email_digest_jobs set state='sending',lease=gen_random_uuid(),lease_until=p_now+interval '60 seconds',
    attempts=attempts+1,changed_at=p_now where id=job.id returning * into job;
  return jsonb_build_object('id',job.id,'lease',job.lease,'recipient',recipient,'content',content);
end;
$$;

revoke all on function app_private.email_quota_blocked(app_private.email_sender_approvals,timestamptz),
  app_private.email_reminder_content(text,jsonb,uuid,uuid,date,timestamptz),
  app_private.email_enqueue_reminders(uuid,timestamptz,integer),
  app_private.enqueue_notification_reminders_before_email(integer),
  app_private.email_dispatch_at(uuid,text,text,uuid,timestamptz,uuid,uuid,text,uuid,integer),
  public.enqueue_notification_reminders(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.enqueue_notification_reminders(integer) to service_role;

commit;
