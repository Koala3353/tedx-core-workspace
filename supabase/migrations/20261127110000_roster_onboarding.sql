-- Roster onboarding: bulk roster add with welcome email, admin nudges, and the Sunday weekly digest.
-- Welcome and nudge emails are transactional: they go to the roster's own @student.ateneo.edu address
-- without a digest opt-in, but still need a live sender approval, the shared daily cap, the 08:00
-- Manila start and an unbounced address. Weekly digests go only to members who turned email on.
begin;

alter table app_private.email_digest_jobs drop constraint email_digest_jobs_kind_check,
  add constraint email_digest_jobs_kind_check check(kind in ('digest','task_due_soon','task_overdue','deliverable_due_soon',
    'deliverable_overdue','approval_waiting','announcement_unacknowledged','event_countdown','welcome','nudge_sign_in',
    'nudge_install','nudge_tutorial','nudge_reminders','weekly_digest'));
update app_private.disposition_sources set structure_hash=app_private.disposition_structure(source_key)
  where source_key='app_private.email_digest_jobs';

-- The roster address for transactional mail. Before first sign-in this is the address the roster
-- manager entered; after sign-in it must still match the verified Google identity.
create function app_private.email_transactional_address(p_membership uuid) returns text
language sql stable security definer set search_path='' as $$
  select m.normalized_email from public.term_memberships tm join public.members m on m.id=tm.member_id
    join public.terms t on t.id=tm.term_id join public.organizations o on o.id=t.organization_id
  where tm.id=p_membership and tm.membership_kind='core' and tm.status='active' and tm.ends_at>statement_timestamp()
    and m.account_state in ('invited','active') and t.state='active' and o.state='active'
    and m.normalized_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@student[.]ateneo[.]edu$' and length(m.normalized_email)<=254
    and (m.auth_user_id is null or app_private.verified_google_email(m.auth_user_id)=m.normalized_email);
$$;

create function app_private.email_transactional_kind(p_kind text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_kind in ('welcome','nudge_sign_in','nudge_install','nudge_tutorial','nudge_reminders'),false);
$$;

-- Queue one transactional email once per (membership, key). Returns whether a job was added.
create function app_private.email_queue_transactional(p_term uuid,p_membership uuid,p_kind text,p_key text,p_now timestamptz)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a app_private.email_sender_approvals; prefs app_private.email_digest_preferences; recipient text; address_hash text;
begin
  if not app_private.email_transactional_kind(p_kind) then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  select * into a from app_private.email_sender_approvals where term_id=p_term;
  if not found or not app_private.email_approval_live(a,p_now) then return false; end if;
  recipient:=app_private.email_transactional_address(p_membership);
  if recipient is null then return false; end if;
  address_hash:=encode(sha256(convert_to(recipient,'UTF8')),'hex');
  insert into app_private.email_digest_preferences(membership_id) values(p_membership) on conflict(membership_id) do nothing;
  select * into prefs from app_private.email_digest_preferences where membership_id=p_membership;
  if address_hash=prefs.bounced_hash then return false; end if;
  insert into app_private.email_digest_jobs(term_id,membership_id,generation,email_hash,digest_day,next_at,kind,reminder_key,payload)
    values(p_term,p_membership,prefs.generation,address_hash,(p_now at time zone 'Asia/Manila')::date,p_now,p_kind,p_key,'{}'::jsonb)
    on conflict(membership_id,reminder_key) do nothing;
  return found;
end;
$$;

-- Live content for the new kinds; every older kind is delegated unchanged.
create function app_private.email_reminder_content_v2(p_kind text,p_payload jsonb,p_membership uuid,p_term uuid,p_day date,
  p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare local_day date:=(p_now at time zone 'Asia/Manila')::date; person uuid; unit uuid; unit_name text;
  week_start date; week_end date; due_count integer; overdue_count integer; meeting_count integer; open_count integer;
  track_count integer;
begin
  if p_kind is null or p_membership is null or p_term is null or p_day is null or p_now is null then return null; end if;
  if p_kind='welcome' then
    if local_day-p_day>14 or app_private.email_transactional_address(p_membership) is null then return null; end if;
    return jsonb_build_object('type',p_kind,'path','');
  elsif p_kind in ('nudge_sign_in','nudge_install','nudge_tutorial','nudge_reminders') then
    if local_day-p_day>2 or not app_private.member_nudge_open(p_membership,substr(p_kind,7)) then return null; end if;
    return jsonb_build_object('type',p_kind,'path','');
  elsif p_kind='weekly_digest' then
    if local_day-p_day>1 or exists(select 1 from public.notification_preferences np where np.membership_id=p_membership and np.mode='mute')
      then return null; end if;
    select tm.member_id into person from public.term_memberships tm where tm.id=p_membership and tm.term_id=p_term;
    if person is null then return null; end if;
    week_start:=p_day+1;
    week_end:=p_day+7;
    select count(*) filter(where x.due between week_start and week_end),count(*) filter(where x.due<week_start)
      into due_count,overdue_count
    from (select coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date) due from public.work_items w
      where w.term_id=p_term and w.owner_member_id=person and w.kind in ('task','deliverable') and w.archived_at is null
        and coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date)<=week_end
        and app_private.notification_pending(w) and app_private.notification_assignee(w)=p_membership) x;
    select d.unit_id,u.name into unit,unit_name from public.unit_memberships d join public.org_units u on u.id=d.unit_id and u.archived_at is null
      where d.term_membership_id=p_membership and d.term_id=p_term and d.status='active'
        and d.effective_from<=p_now and d.effective_to>p_now
      order by case d.deployment_type when 'head' then 0 else 1 end,d.effective_from,d.id limit 1;
    select count(*) into meeting_count from public.calendar_events e join public.work_items w on w.id=e.work_item_id
      where w.term_id=p_term and w.archived_at is null and e.state='confirmed'
        and (e.visibility='core' or (e.visibility='unit' and w.lead_unit_id is not null and exists(
          select 1 from public.unit_memberships d where d.term_membership_id=p_membership and d.unit_id=w.lead_unit_id
            and d.status='active' and d.effective_from<=p_now and d.effective_to>p_now)))
        and case when e.all_day then e.start_on<=week_end and e.end_on>week_start
          else (e.starts_at at time zone 'Asia/Manila')::date between week_start and week_end end;
    if unit is not null then
      select count(*),count(*) filter(where coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date)>=week_start)
        into open_count,track_count from public.work_items w
        where w.term_id=p_term and w.lead_unit_id=unit and w.kind in ('task','deliverable') and w.archived_at is null
          and app_private.notification_pending(w);
    end if;
    if due_count=0 and overdue_count=0 and meeting_count=0 then return null; end if;
    return jsonb_build_object('type',p_kind,'path','','dueThisWeek',due_count,'overdue',overdue_count,'meetings',meeting_count,
      'committee',case when coalesce(open_count,0)>0 then left(unit_name,80) end,
      'onTrackPct',case when coalesce(open_count,0)>0 then round(100.0*track_count/open_count)::integer end);
  end if;
  return app_private.email_reminder_content(p_kind,p_payload,p_membership,p_term,p_day,p_now);
end;
$$;

-- Sunday 20:00-21:00 Manila: one weekly digest per opted-in member per ISO week.
create function app_private.email_enqueue_weekly(p_term_id uuid,p_now timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a app_private.email_sender_approvals; local_at timestamp:=p_now at time zone 'Asia/Manila'; day date; candidate record;
  added integer; n integer:=0; week_key text;
begin
  if p_term_id is null or p_now is null or not isfinite(p_now) or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  day:=local_at::date;
  if extract(isodow from day)<>7 or local_at::time<time '20:00' or local_at::time>=time '21:00' then return 0; end if;
  select * into a from app_private.email_sender_approvals where term_id=p_term_id;
  if not found or not app_private.email_approval_live(a,p_now) or app_private.email_quota_blocked(a,p_now) then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('email-reminders:'||p_term_id,0));
  week_key:='weekly:'||to_char(day,'IYYY-"W"IW');
  for candidate in
    select pr.membership_id,pr.generation,pr.email_hash from app_private.email_digest_preferences pr
      join public.term_memberships tm on tm.id=pr.membership_id
    where tm.term_id=p_term_id and pr.opted_at is not null and pr.email_hash is not null and pr.email_hash is distinct from pr.bounced_hash
      and pr.email_hash=encode(sha256(convert_to(app_private.email_current_school_address(pr.membership_id),'UTF8')),'hex')
      and not exists(select 1 from public.notification_preferences np where np.membership_id=pr.membership_id and np.mode='mute')
      and not exists(select 1 from app_private.email_digest_jobs j where j.membership_id=pr.membership_id and j.reminder_key=week_key)
    order by pr.membership_id
  loop
    exit when n>=p_limit;
    if app_private.email_reminder_content_v2('weekly_digest','{}'::jsonb,candidate.membership_id,p_term_id,day,p_now) is null then
      continue;
    end if;
    insert into app_private.email_digest_jobs(term_id,membership_id,generation,email_hash,digest_day,next_at,kind,reminder_key,payload)
      values(p_term_id,candidate.membership_id,candidate.generation,candidate.email_hash,day,p_now,'weekly_digest',week_key,'{}'::jsonb)
      on conflict(membership_id,reminder_key) do nothing;
    get diagnostics added=row_count;
    n:=n+added;
  end loop;
  return n;
end;
$$;

create or replace function public.enqueue_notification_reminders(p_limit integer default 100) returns integer
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
    begin
      n:=n+app_private.email_enqueue_weekly(term,statement_timestamp(),p_limit);
    exception when others then
      raise warning using message='email_weekly_enqueue_failed',detail=sqlstate;
    end;
  end loop;
  return n;
end;
$$;

-- Same contract as 20261126090000. Prepare now also sends transactional kinds to the roster address,
-- and keeps sending weekly digests until 21:00 Manila on the evening they are queued.
create or replace function app_private.email_dispatch_at(p_term_id uuid,p_action text,p_sender text,p_domain_id uuid,p_now timestamptz,
  p_id uuid,p_lease uuid,p_outcome text,p_provider_id uuid,p_delay integer) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a app_private.email_sender_approvals; job app_private.email_digest_jobs; prefs app_private.email_digest_preferences;
  local_time timestamp; target_day date; quota_day date; recipient text; state_after text; content jsonb; late boolean;
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
  if local_time::time<time '08:00' or local_time::time>=time '21:00' then return null; end if;
  late:=local_time::time>=time '20:00';
  target_day:=local_time::date-1;
  quota_day:=(p_now at time zone 'UTC')::date;
  select * into job from app_private.email_digest_jobs where term_id=p_term_id and state='waiting'
    and next_at<=p_now and (not late or kind='weekly_digest') order by next_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  select * into prefs from app_private.email_digest_preferences where membership_id=job.membership_id for share;
  if app_private.email_transactional_kind(job.kind) then
    recipient:=app_private.email_transactional_address(job.membership_id);
    content:=app_private.email_reminder_content_v2(job.kind,job.payload,job.membership_id,job.term_id,job.digest_day,p_now);
    if recipient is null or content is null or job.email_hash=prefs.bounced_hash
      or job.email_hash is distinct from encode(sha256(convert_to(recipient,'UTF8')),'hex') then
      update app_private.email_digest_jobs set state='skipped',changed_at=p_now where id=job.id;
      return jsonb_build_object('skipped',true);
    end if;
  else
    recipient:=app_private.email_current_school_address(job.membership_id);
    if job.kind='digest' then
      if job.digest_day=target_day and app_private.email_has_digest(prefs,target_day,p_now) then
        content:=jsonb_build_object('type','digest','path','');
      end if;
    else
      content:=app_private.email_reminder_content_v2(job.kind,job.payload,job.membership_id,job.term_id,job.digest_day,p_now);
    end if;
    if prefs.generation is distinct from job.generation or recipient is null or prefs.email_hash is distinct from job.email_hash
      or prefs.email_hash=prefs.bounced_hash or content is null
      or job.email_hash is distinct from encode(sha256(convert_to(recipient,'UTF8')),'hex') then
      update app_private.email_digest_jobs set state='skipped',changed_at=p_now where id=job.id;
      return jsonb_build_object('skipped',true);
    end if;
  end if;
  insert into app_private.email_digest_quota as q(term_id,utc_day,attempts) values(p_term_id,quota_day,1)
    on conflict(term_id,utc_day) do update set attempts=q.attempts+1;
  update app_private.email_digest_jobs set state='sending',lease=gen_random_uuid(),lease_until=p_now+interval '60 seconds',
    attempts=attempts+1,changed_at=p_now where id=job.id returning * into job;
  return jsonb_build_object('id',job.id,'lease',job.lease,'recipient',recipient,'content',content);
end;
$$;

-- Bulk roster add. Each person becomes an invited member with an active core membership for the
-- rest of the term, optionally seated through the existing tedx seat machinery, and gets one
-- welcome email. Invalid rows are skipped with a reason; valid rows in the same call still apply.
create function public.add_roster_members(p_term_id uuid,p_people jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.term_memberships; full_admin boolean; payload jsonb; receipt jsonb; person jsonb; t public.terms;
  address text; person_name text; role_code text; unit_code text; wave text; reason text; ends timestamptz;
  position app_private.tedx_positions; unit public.org_units; existing public.members; tm public.term_memberships;
  seat app_private.tedx_seats; seated_role text; queued boolean; seen text[]:='{}'; added jsonb:='[]'; skipped jsonb:='[]';
begin
  perform app_private.readiness_lock(p_term_id);
  actor:=app_private.roster_manager(p_term_id,true);
  if p_request_id is null or jsonb_typeof(p_people) is distinct from 'array' or jsonb_array_length(p_people) not between 1 and 100 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  payload:=jsonb_build_array(p_term_id,p_people);
  receipt:=app_private.begin_work_command('add_roster_members',p_request_id,payload);
  if receipt is not null then return receipt; end if;
  -- Administrator positions keep save_tedx_seat's bar: both administrative capabilities.
  full_admin:=public.has_capability(p_term_id,'roles.manage') and public.has_capability(p_term_id,'admin.configure');
  select * into t from public.terms where id=p_term_id;
  ends:=(t.closes_on+1)::timestamp at time zone 'Asia/Manila';
  if ends<=statement_timestamp() then raise exception using errcode='22023',message='command_validation_failed'; end if;

  for person in select value from jsonb_array_elements(p_people) loop
    reason:=null; position:=null; unit:=null; existing:=null; tm:=null; seat:=null; seated_role:=null;
    address:=null; person_name:=null; role_code:=null; unit_code:=null; wave:=null;
    if jsonb_typeof(person)<>'object' or exists(select 1 from jsonb_each(person) f
        where f.key not in ('name','email','committeeCode','roleCode','wave')
          or jsonb_typeof(f.value) not in ('string','null')) then
      reason:='invalid';
    else
      address:=lower(btrim(person->>'email'));
      person_name:=btrim(person->>'name');
      role_code:=nullif(lower(btrim(person->>'roleCode')),'');
      unit_code:=nullif(upper(btrim(person->>'committeeCode')),'');
      wave:=nullif(btrim(person->>'wave'),'');
      if address is null or length(address)>254 or address !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@student[.]ateneo[.]edu$' then
        reason:='not_school_email';
      elsif person_name is null or length(person_name) not between 1 and 200 then reason:='invalid_name';
      elsif wave is not null and wave not in ('wave1','wave1_5','core') then reason:='invalid_wave';
      elsif address=any(seen) then reason:='duplicate';
      end if;
    end if;
    if reason is null and unit_code is not null then
      select * into unit from public.org_units where term_id=p_term_id and code=unit_code and archived_at is null;
      if unit.id is null then reason:='unknown_committee'; end if;
    end if;
    if reason is null and role_code is not null then
      select p.* into position from app_private.tedx_positions p join public.roles r on r.id=p.role_id and r.state='active'
        left join public.org_units u on u.id=p.unit_id
        where p.term_id=p_term_id and r.code=role_code and (p.unit_id is null or u.archived_at is null);
      if position.role_id is null then reason:='unknown_role';
      elsif unit.id is not null and position.unit_id is distinct from unit.id then reason:='role_committee_mismatch';
      elsif (position.administrator or position.tier<>'core') and not full_admin then reason:='role_not_allowed';
      end if;
    elsif reason is null and unit.id is not null then
      select p.* into position from app_private.tedx_positions p join public.roles r on r.id=p.role_id and r.state='active'
        where p.term_id=p_term_id and p.unit_id=unit.id and p.tier='core' and not p.administrator order by r.code limit 1;
    end if;
    if reason is null then
      select * into existing from public.members where organization_id=actor.organization_id and normalized_email=address for update;
      if existing.id is not null and existing.account_state not in ('invited','active') then reason:='account_unavailable';
      elsif existing.id is not null and exists(select 1 from public.term_memberships x where x.term_id=p_term_id
        and x.member_id=existing.id) then reason:='already_on_roster';
      end if;
    end if;
    if reason is not null then
      skipped:=skipped||jsonb_build_array(jsonb_build_object('email',coalesce(left(address,254),left(person->>'email',254),''),
        'reason',reason));
      continue;
    end if;
    seen:=seen||address;
    if existing.id is null then
      insert into public.members(organization_id,email,display_name,account_state)
        values(actor.organization_id,address,person_name,'invited') returning * into existing;
    end if;
    insert into public.term_memberships(organization_id,term_id,member_id,membership_kind,status,joined_at,ends_at)
      values(actor.organization_id,p_term_id,existing.id,'core','active',statement_timestamp(),ends) returning * into tm;
    insert into app_private.member_roster_meta(term_membership_id,wave,invited_by) values(tm.id,wave,actor.id);
    if position.role_id is not null then
      insert into app_private.tedx_seats(term_id,membership_id,role_id,starts_at,ends_at)
        values(p_term_id,tm.id,position.role_id,tm.joined_at,tm.ends_at) returning * into seat;
      seat:=app_private.tedx_materialize_seat(seat,position,actor);
      insert into app_private.tedx_seat_history(seat_id,version,actor_id,reason,before_value,after_value)
        values(seat.id,seat.version,actor.id,'Added to the roster',null,to_jsonb(seat));
      select code into seated_role from public.roles where id=position.role_id;
      if unit.id is null and position.unit_id is not null then
        select * into unit from public.org_units where id=position.unit_id;
      end if;
    elsif unit.id is not null then
      insert into public.unit_memberships(organization_id,term_id,term_membership_id,unit_id,deployment_type,
          effective_from,effective_to,approved_by)
        values(actor.organization_id,p_term_id,tm.id,unit.id,'member',tm.joined_at,tm.ends_at,actor.id);
    end if;
    queued:=app_private.email_queue_transactional(p_term_id,tm.id,'welcome','welcome:'||tm.id,statement_timestamp());
    added:=added||jsonb_build_array(jsonb_build_object('membershipId',tm.id,'memberId',existing.id,'name',existing.display_name,
      'email',address,'committeeCode',unit.code,'roleCode',seated_role,'wave',wave,'welcomeQueued',queued));
  end loop;
  return app_private.notification_receipt(p_term_id,'add_roster_members',p_request_id,payload,
    jsonb_build_object('added',added,'skipped',skipped));
end;
$$;

-- Admin nudges: at most one per member per kind per Manila day, only while the step is still undone.
-- Each nudge shows in the member's app (read_client_state.nudge) and queues one transactional email.
create function public.nudge_members(p_term_id uuid,p_membership_ids uuid[],p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.term_memberships; target uuid; n integer:=0; day date:=(statement_timestamp() at time zone 'Asia/Manila')::date;
begin
  actor:=app_private.roster_manager(p_term_id,true);
  if p_kind is null or p_kind not in ('sign_in','install','tutorial','reminders') or p_membership_ids is null
    or cardinality(p_membership_ids) not between 1 and 200 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member-nudges:'||p_term_id,0));
  for target in select tm.id from public.term_memberships tm
    where tm.id=any(p_membership_ids) and tm.term_id=p_term_id and tm.membership_kind='core' and tm.status='active'
      and tm.ends_at>statement_timestamp() order by tm.id
  loop
    if not app_private.member_nudge_open(target,p_kind) then continue; end if;
    insert into app_private.member_nudges(term_membership_id,kind,nudged_on,created_by) values(target,p_kind,day,actor.id)
      on conflict(term_membership_id,kind,nudged_on) do nothing;
    if not found then continue; end if;
    perform app_private.email_queue_transactional(p_term_id,target,'nudge_'||p_kind,'nudge:'||p_kind||':'||to_char(day,'YYYY-MM-DD'),
      statement_timestamp());
    n:=n+1;
  end loop;
  return jsonb_build_object('queued',n);
end;
$$;

revoke all on function app_private.email_transactional_address(uuid),app_private.email_transactional_kind(text),
  app_private.email_queue_transactional(uuid,uuid,text,text,timestamptz),
  app_private.email_reminder_content_v2(text,jsonb,uuid,uuid,date,timestamptz),
  app_private.email_enqueue_weekly(uuid,timestamptz,integer),
  app_private.email_dispatch_at(uuid,text,text,uuid,timestamptz,uuid,uuid,text,uuid,integer),
  public.enqueue_notification_reminders(integer),public.add_roster_members(uuid,jsonb,uuid),
  public.nudge_members(uuid,uuid[],text)
  from public,anon,authenticated,service_role;
grant execute on function public.enqueue_notification_reminders(integer) to service_role;
grant execute on function public.add_roster_members(uuid,jsonb,uuid),public.nudge_members(uuid,uuid[],text) to authenticated;

commit;
