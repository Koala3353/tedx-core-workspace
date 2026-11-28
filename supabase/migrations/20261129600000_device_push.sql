-- Device notifications (Web Push). A member turns them on per browser or installed app; the
-- dispatch-notifications worker sends a short alert for each new in-app notification while the
-- member's alert mode is "Right away". Digest and Off modes send nothing to devices.
--
-- Push subscriptions are device capabilities (endpoint plus encryption keys). They are kept in
-- app_private with forced RLS and no table grants; members reach them only through the RPCs below,
-- and only their own. The sender is service-role only and never sees more than the in-app row
-- already shows the recipient (titles of restricted work are left out, as in Telegram).
begin;

-- Only the browser push services. The sender posts to these URLs, so anything else is refused.
create function app_private.push_endpoint_allowed(p_endpoint text) returns boolean
language sql immutable set search_path='' as $$
  select p_endpoint is not null and length(p_endpoint) between 30 and 1000
    and p_endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com)/[A-Za-z0-9._~:/?=&%+!$,;@-]+$';
$$;

create table app_private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.term_memberships(id),
  subject_id uuid not null references auth.users(id),
  endpoint text not null unique check(app_private.push_endpoint_allowed(endpoint)),
  -- Uncompressed P-256 point (65 bytes) and the 16-byte auth secret, base64url without padding.
  p256dh text not null check(p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}$'),
  label text check(label is null or (length(label) between 1 and 60 and label !~ '[[:cntrl:]]')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check(failure_count between 0 and 1000),
  retry_after timestamptz,
  revoked_at timestamptz
);
create index push_subscriptions_member on app_private.push_subscriptions(membership_id) where revoked_at is null;
create index push_subscriptions_subject on app_private.push_subscriptions(subject_id) where revoked_at is null;

-- One row per (notification, device), or per (test, device). The row is the "already pushed" marker.
create table app_private.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references app_private.push_subscriptions(id) on delete cascade,
  membership_id uuid not null references public.term_memberships(id),
  notification_id uuid references public.notifications(id),
  test_id uuid,
  state text not null default 'waiting' check(state in ('waiting','sending','sent','failed','gone','skipped')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  run_at timestamptz not null default statement_timestamp(),
  lease uuid,
  lease_until timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check((notification_id is null)<>(test_id is null)),
  check((state='sending')=(lease is not null) and (lease is null)=(lease_until is null)),
  unique(notification_id,subscription_id)
);
create index push_deliveries_ready on app_private.push_deliveries(run_at,id) where state='waiting';
create index push_deliveries_in_flight on app_private.push_deliveries(lease_until) where state='sending';
create index push_deliveries_test on app_private.push_deliveries(test_id) where test_id is not null;
create index push_deliveries_member_tests on app_private.push_deliveries(membership_id,created_at desc) where test_id is not null;
create index push_deliveries_subscription on app_private.push_deliveries(subscription_id);
create index push_deliveries_age on app_private.push_deliveries(created_at);

do $$
declare relation text;
begin
  foreach relation in array array['push_subscriptions','push_deliveries'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

-- Quiet hours, Manila time: an alert made between 10 PM and 7 AM waits until 7 AM.
create function app_private.push_not_before(p_at timestamptz) returns timestamptz
language sql stable set search_path='' as $$
  select case when (p_at at time zone 'Asia/Manila')::time>=time '22:00'
      then (((p_at at time zone 'Asia/Manila')::date+1)+time '07:00') at time zone 'Asia/Manila'
    when (p_at at time zone 'Asia/Manila')::time<time '07:00'
      then (((p_at at time zone 'Asia/Manila')::date)+time '07:00') at time zone 'Asia/Manila'
    else p_at end;
$$;

-- Act as the recipient so app_private.notification_row applies that person's own current access.
create function app_private.push_as_subject(p_subject uuid) returns void
language plpgsql set search_path='' as $$
begin
  perform set_config('request.jwt.claim.sub',coalesce(p_subject::text,''),true);
  perform set_config('request.jwt.claim.role',case when p_subject is null then 'service_role' else 'authenticated' end,true);
  perform set_config('request.jwt.claims',case when p_subject is null then jsonb_build_object('role','service_role')
    else jsonb_build_object('sub',p_subject,'role','authenticated') end::text,true);
end;
$$;

-- Lock-screen text for one notification, from the same projection as the in-app list.
create function app_private.push_message(n public.notifications,p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare w public.work_items; label text:=p_row->>'label'; href text:=p_row->>'href'; title text; body text;
  due date; today date:=(statement_timestamp() at time zone 'Asia/Manila')::date; j public.outbox_jobs;
begin
  if href ~ '^/(tasks|deliverables)/[0-9a-f-]{36}$' then
    select * into w from public.work_items where id=split_part(href,'/',3)::uuid;
  end if;
  select * into j from public.outbox_jobs where id=n.job_id;
  title:=case when w.id is not null and w.classification='ordinary' then left(regexp_replace(w.title,'[[:cntrl:]]+',' ','g'),120) end;
  due:=coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date);
  body:=concat_ws(' · ',case when title is not null then label end,
    case when due is not null then case when due<today then 'overdue since '||to_char(due,'Dy, Mon FMDD')
      when due=today then 'due today' when due=today+1 then 'due tomorrow' else 'due '||to_char(due,'Dy, Mon FMDD') end end,
    case when (p_row->>'actionable')::boolean then 'needs your action' end);
  return jsonb_build_object('title',coalesce(title,label),'body',coalesce(nullif(body,''),'Open the workspace to see it.'),
    'url',href,'tag',href,'urgency',case when j.event_type='work_overdue' then 'high' else 'normal' end);
end;
$$;

create function public.save_push_subscription(p_term_id uuid,p_endpoint text,p_p256dh text,p_auth text,p_label text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.term_memberships; sub app_private.push_subscriptions; v_label text:=nullif(btrim(p_label),'');
begin
  member:=app_private.request_actor(p_term_id,false);
  if not app_private.push_endpoint_allowed(p_endpoint) or p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$'
    or (v_label is not null and (length(v_label)>60 or v_label ~ '[[:cntrl:]]')) then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push:'||auth.uid(),0));
  select * into sub from app_private.push_subscriptions where endpoint=p_endpoint for update;
  if found and (sub.subject_id<>auth.uid() or sub.membership_id<>member.id) then
    -- The browser now belongs to whoever is signed in on it. Drop the earlier owner's link.
    delete from app_private.push_subscriptions where id=sub.id;
    sub:=null;
  end if;
  if sub.id is not null then
    update app_private.push_subscriptions set p256dh=p_p256dh,auth=p_auth,label=coalesce(v_label,sub.label),
      updated_at=statement_timestamp(),failure_count=0,retry_after=null,revoked_at=null
      where id=sub.id returning * into sub;
  else
    -- At most 10 devices per person: the one used least recently makes room.
    delete from app_private.push_subscriptions where id in(select id from app_private.push_subscriptions
      where subject_id=auth.uid() and revoked_at is null
      order by coalesce(last_success_at,updated_at) desc,id offset 9);
    insert into app_private.push_subscriptions(membership_id,subject_id,endpoint,p256dh,auth,label)
      values(member.id,auth.uid(),p_endpoint,p_p256dh,p_auth,v_label) returning * into sub;
  end if;
  return jsonb_build_object('id',sub.id,'label',sub.label,'createdAt',sub.created_at);
end;
$$;

create function public.remove_push_subscription(p_endpoint text default null,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='command_permission_denied'; end if;
  if (p_endpoint is null)=(p_id is null) or (p_endpoint is not null and length(p_endpoint)>1000) then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  delete from app_private.push_subscriptions where subject_id=auth.uid()
    and (endpoint=p_endpoint or id=p_id);
  get diagnostics removed=row_count;
  return jsonb_build_object('removed',removed);
end;
$$;

create function public.read_my_push_devices(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare member public.term_memberships;
begin
  member:=app_private.request_actor(p_term_id,false);
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'createdAt',s.created_at,
      'lastSuccessAt',s.last_success_at,'failing',s.failure_count>0,
      'endpointHash',encode(sha256(convert_to(s.endpoint,'UTF8')),'hex')) order by s.created_at desc,s.id)
    from app_private.push_subscriptions s
    where s.subject_id=auth.uid() and s.membership_id=member.id and s.revoked_at is null),'[]'::jsonb);
end;
$$;

-- Queues one test alert to each of the caller's own devices. Once a minute at most.
create function public.send_test_push(p_term_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare member public.term_memberships; test uuid:=gen_random_uuid(); queued integer;
begin
  member:=app_private.request_actor(p_term_id,false);
  perform pg_advisory_xact_lock(hashtextextended('push:'||auth.uid(),0));
  if exists(select 1 from app_private.push_deliveries where membership_id=member.id and test_id is not null
    and created_at>statement_timestamp()-interval '1 minute') then
    raise exception using errcode='22023',message='command_quota_limit';
  end if;
  insert into app_private.push_deliveries(subscription_id,membership_id,test_id)
    select s.id,member.id,test from app_private.push_subscriptions s
    where s.subject_id=auth.uid() and s.membership_id=member.id and s.revoked_at is null;
  get diagnostics queued=row_count;
  if queued=0 then raise exception using errcode='55000',message='command_no_push_device'; end if;
  return jsonb_build_object('testId',test,'devices',queued);
end;
$$;

-- Service role: queue new alerts, then lease up to p_limit ready sends with their message.
-- With p_test_id, only that test's sends are leased (the app asks for its own test right away).
create function public.claim_push_batch(p_limit integer default 50,p_test_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare d app_private.push_deliveries; s app_private.push_subscriptions; n public.notifications;
  pref public.notification_preferences; r jsonb; message jsonb; items jsonb:='[]'; claims text; seen text[]:='{}';
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('push-dispatch',0)) then return items; end if;
  claims:=current_setting('request.jwt.claims',true);

  -- A send that never reported back: try again once or twice, then give up.
  update app_private.push_deliveries set state=case when attempts>=3 then 'failed' else 'waiting' end,
      lease=null,lease_until=null,run_at=statement_timestamp()+interval '1 minute',updated_at=statement_timestamp()
    where id in(select id from app_private.push_deliveries where state='sending' and lease_until<=statement_timestamp()
      order by lease_until limit 100 for update skip locked);

  if p_test_id is null then
    delete from app_private.push_deliveries where id in(select id from app_private.push_deliveries
      where created_at<statement_timestamp()-interval '14 days' order by created_at limit 500);
    delete from app_private.push_subscriptions where id in(select id from app_private.push_subscriptions
      where revoked_at<statement_timestamp()-interval '30 days' limit 50);
    -- New in-app notifications for people whose alert mode is "Right away".
    insert into app_private.push_deliveries(subscription_id,membership_id,notification_id,run_at)
      select s2.id,s2.membership_id,n2.id,app_private.push_not_before(n2.created_at)
      from public.notifications n2
      join app_private.push_subscriptions s2 on s2.membership_id=n2.recipient_id and s2.revoked_at is null
      left join public.notification_preferences p2 on p2.membership_id=n2.recipient_id
      left join public.notification_rule_reservations rr on rr.job_id=n2.job_id
      where n2.created_at>statement_timestamp()-interval '1 day' and n2.created_at>=s2.created_at
        and n2.read_at is null and coalesce(p2.mode,'immediate')='immediate'
        and n2.created_at>=coalesce(p2.updated_at,'-infinity') and coalesce(rr.mode,'immediate')='immediate'
        and not exists(select 1 from app_private.push_deliveries x where x.notification_id=n2.id and x.subscription_id=s2.id)
      order by n2.created_at limit 500
      on conflict(notification_id,subscription_id) do nothing;
  end if;

  for d in select * from app_private.push_deliveries x where x.state='waiting' and x.run_at<=statement_timestamp()
      and (p_test_id is null or x.test_id=p_test_id)
      and not exists(select 1 from app_private.push_subscriptions y where y.id=x.subscription_id and y.retry_after>statement_timestamp())
      order by x.run_at,x.id limit p_limit for update skip locked loop
    select * into s from app_private.push_subscriptions where id=d.subscription_id;
    message:=null;
    if s.revoked_at is null and d.test_id is not null then
      message:=jsonb_build_object('title','Test notification','body','Device notifications work on this device.',
        'url','/account','tag','tedx-test','urgency','normal');
    elsif s.revoked_at is null then
      select * into n from public.notifications where id=d.notification_id;
      select * into pref from public.notification_preferences where membership_id=n.recipient_id;
      if n.read_at is null and n.created_at>statement_timestamp()-interval '36 hours'
        and coalesce(pref.mode,'immediate')='immediate' then
        perform app_private.push_as_subject(s.subject_id);
        r:=app_private.notification_row(n);
        if r is not null and not coalesce((r->>'read')::boolean,false) then message:=app_private.push_message(n,r); end if;
      end if;
    end if;
    -- Several updates to the same item in one run: one alert per device, the rest are covered by it.
    if message is not null and (s.id::text||' '||(message->>'tag'))=any(seen) then message:=null; end if;
    if message is null then
      update app_private.push_deliveries set state='skipped',updated_at=statement_timestamp() where id=d.id;
      continue;
    end if;
    seen:=seen||(s.id::text||' '||(message->>'tag'));
    update app_private.push_deliveries set state='sending',lease=gen_random_uuid(),
        lease_until=statement_timestamp()+interval '90 seconds',attempts=attempts+1,updated_at=statement_timestamp()
      where id=d.id returning * into d;
    items:=items||jsonb_build_array(message||jsonb_build_object('id',d.id,'lease',d.lease,
      'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth));
  end loop;

  perform set_config('request.jwt.claims',coalesce(claims,''),true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  return items;
end;
$$;

-- Service role: record each send. sent clears failures, gone drops the device (404/410),
-- retry backs off the send and the device, failed is final for that send.
create function public.mark_push_results(p_results jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; d app_private.push_deliveries; outcome text; recorded integer:=0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)>100 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  for item in select value from jsonb_array_elements(p_results) loop
    outcome:=item->>'outcome';
    if outcome is null or outcome not in ('sent','gone','retry','failed')
      or coalesce(item->>'id','') !~ '^[0-9a-f-]{36}$' or coalesce(item->>'lease','') !~ '^[0-9a-f-]{36}$' then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    select * into d from app_private.push_deliveries where id=(item->>'id')::uuid and state='sending'
      and lease=(item->>'lease')::uuid for update;
    if not found then continue; end if;
    recorded:=recorded+1;
    update app_private.push_deliveries set lease=null,lease_until=null,updated_at=statement_timestamp(),
        state=case when outcome='retry' then case when attempts>=3 then 'failed' else 'waiting' end else outcome end,
        run_at=case when outcome='retry' then statement_timestamp()+make_interval(mins=>(2^attempts)::integer) else run_at end
      where id=d.id;
    if outcome='sent' then
      update app_private.push_subscriptions set last_success_at=statement_timestamp(),failure_count=0,retry_after=null
        where id=d.subscription_id;
    elsif outcome='gone' then
      update app_private.push_subscriptions set revoked_at=coalesce(revoked_at,statement_timestamp())
        where id=d.subscription_id;
    else
      update app_private.push_subscriptions set failure_count=least(failure_count+1,1000),
          retry_after=case when failure_count+1>=3
            then statement_timestamp()+make_interval(mins=>least(1440,(2^least(failure_count+1,11))::integer)) end,
          revoked_at=case when failure_count+1>=50 then statement_timestamp() else revoked_at end
        where id=d.subscription_id;
    end if;
  end loop;
  return jsonb_build_object('recorded',recorded);
end;
$$;

revoke all on function app_private.push_endpoint_allowed(text),app_private.push_not_before(timestamptz),
  app_private.push_as_subject(uuid),app_private.push_message(public.notifications,jsonb),
  public.save_push_subscription(uuid,text,text,text,text),public.remove_push_subscription(text,uuid),
  public.read_my_push_devices(uuid),public.send_test_push(uuid),
  public.claim_push_batch(integer,uuid),public.mark_push_results(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_push_subscription(uuid,text,text,text,text),public.remove_push_subscription(text,uuid),
  public.read_my_push_devices(uuid),public.send_test_push(uuid) to authenticated;
grant execute on function public.claim_push_batch(integer,uuid),public.mark_push_results(jsonb) to service_role;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'term',array['id'],
  format('select app_private.disposition_key(%L,array[x.id::text]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.%I x
    join public.term_memberships m on m.id=x.membership_id where m.term_id=$1',
    'app_private.'||source,category,category,source),
  app_private.disposition_structure('app_private.'||source),false
from (values
  ('push_subscriptions','privacy'),
  ('push_deliveries','security')
) definitions(source,category);

commit;
