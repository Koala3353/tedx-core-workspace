-- Telegram reminder actions and the daily 08:00 "Your day" message.
-- Messages carry inline buttons: tasks [Done] [Snooze 1 day] [Open], deliverables [Snooze 1 day] [Open],
-- announcements [Got it] [Open], approvals [Open] (approve/return stay in the app). Each callback button
-- holds a single-use opaque token; only its SHA-256 is stored. A token works for 48 hours, only from the
-- chat linked to its membership at mint time, and runs the existing member commands as that member.
begin;

create table app_private.telegram_action_tokens (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  id uuid not null unique default gen_random_uuid(),
  membership_id uuid not null references app_private.telegram_links(membership_id),
  generation uuid not null,
  action text not null check(action in ('done','snooze','ack')),
  target_kind text not null check(target_kind in ('task','deliverable','announcement')),
  target_id uuid not null,
  material_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  result text check(result in ('done','snoozed','acknowledged')),
  check((action='ack')=(target_kind='announcement') and (action='ack')=(material_id is not null)),
  check((used_at is null)=(result is null))
);
create index telegram_action_tokens_member on app_private.telegram_action_tokens(membership_id,target_id);
create index telegram_action_tokens_expiry on app_private.telegram_action_tokens(expires_at);

create table app_private.telegram_snoozes (
  id uuid not null unique default gen_random_uuid(),
  membership_id uuid not null references app_private.telegram_links(membership_id),
  target_id uuid not null,
  snoozed_until timestamptz not null,
  primary key(membership_id,target_id)
);

create table app_private.telegram_daily_jobs (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references app_private.telegram_links(membership_id),
  generation uuid not null,
  local_day date not null,
  state text not null default 'waiting' check(state in ('waiting','sending','sent','skipped','relink','failed','uncertain')),
  run_at timestamptz not null default statement_timestamp(),
  lease uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 4),
  updated_at timestamptz not null default statement_timestamp(),
  check((state='sending')=(lease is not null) and (lease is null)=(lease_until is null)),
  unique(membership_id,local_day)
);
create index telegram_daily_jobs_ready on app_private.telegram_daily_jobs(run_at,id) where state='waiting';
create index telegram_daily_jobs_in_flight on app_private.telegram_daily_jobs(lease_until,id) where state='sending';

do $$
declare relation text;
begin
  foreach relation in array array['telegram_action_tokens','telegram_snoozes','telegram_daily_jobs'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

-- Snoozed work no longer raises Telegram alerts until the snooze ends. Otherwise unchanged.
create or replace function app_private.telegram_sources(l app_private.telegram_links)
returns table(notification_id uuid,mode text,digest_day date,send_at timestamptz)
language sql stable security definer set search_path='' set timezone='UTC' as $$
  with candidate as (
    select n.id,
      case when pref.mode='mute' or r.mode='mute' then 'mute'
        when pref.mode='digest' or r.mode='digest' then 'digest' else 'immediate' end mode,
      greatest(n.created_at,r.optional_at) at time zone 'Asia/Manila' local_at
    from public.notifications n join public.outbox_jobs j on j.id=n.job_id and j.state='delivered'
    join public.work_items w on w.id=n.target_id and w.id=j.work_item_id and w.kind=n.target_kind
    left join public.notification_rule_reservations r on r.job_id=j.id
    left join public.notification_preferences pref on pref.membership_id=n.recipient_id
    where n.recipient_id=l.membership_id and n.target_kind in ('task','deliverable') and n.read_at is null
      and n.created_at>=greatest(l.linked_at,pref.updated_at) and n.created_at>statement_timestamp()-interval '3 days'
      and app_private.notification_pending(w) and app_private.notification_assignee(w)=l.membership_id
      and (r.job_id is null or (r.channel='telegram' and r.recipient_id=n.recipient_id
        and r.deadline=coalesce(w.due_on::text,w.due_at::text)))
      and (j.reminder_key is null or j.reminder_key like w.id::text||':'||coalesce(w.due_on::text,w.due_at::text)||':%')
      and not exists(select 1 from app_private.telegram_snoozes z where z.membership_id=l.membership_id and z.target_id=w.id
        and z.snoozed_until>statement_timestamp())
  )
  select id,mode,case when mode='digest' then local_at::date end,
    app_private.telegram_not_before(mode,local_at)
  from candidate where mode in ('immediate','digest');
$$;

-- Mint one single-use token. The plain token is returned once to the service caller and never stored.
create function app_private.telegram_mint(p_link app_private.telegram_links,p_action text,p_kind text,p_target uuid,p_material uuid)
returns text language plpgsql security definer set search_path='' as $$
declare token text:=replace(gen_random_uuid()::text,'-','');
begin
  insert into app_private.telegram_action_tokens(token_hash,membership_id,generation,action,target_kind,target_id,material_id,expires_at)
    values(encode(sha256(convert_to(token,'UTF8')),'hex'),p_link.membership_id,p_link.generation,p_action,p_kind,p_target,p_material,
      statement_timestamp()+interval '48 hours');
  return token;
end;
$$;

create function app_private.telegram_due_label(p_due date,p_today date) returns text
language sql immutable set search_path='' as $$
  select case when p_due<p_today then 'overdue since '||to_char(p_due,'Dy, Mon FMDD')
    when p_due=p_today then 'due today' when p_due=p_today+1 then 'due tomorrow'
    else 'due '||to_char(p_due,'Dy, Mon FMDD') end;
$$;

-- One message item with its button tokens. Restricted work shows no title.
create function app_private.telegram_work_item(p_link app_private.telegram_links,w public.work_items,p_today date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare due date:=coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date); item jsonb;
begin
  item:=jsonb_build_object('kind',w.kind,'title',case when w.classification='ordinary' then left(w.title,120) end,
    'when',app_private.telegram_due_label(due,p_today),'path',w.kind||'s/'||w.id,
    'snooze',app_private.telegram_mint(p_link,'snooze',w.kind,w.id,null));
  if w.kind='task' then item:=item||jsonb_build_object('done',app_private.telegram_mint(p_link,'done','task',w.id,null)); end if;
  return item;
end;
$$;

-- Up to three things for today: open work due by tomorrow (overdue first), then reviews waiting,
-- then announcements still asking for a read confirmation. Snoozed work is left out.
create function app_private.telegram_day_items(p_link app_private.telegram_links,p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare today date:=(p_now at time zone 'Asia/Manila')::date; term uuid; person uuid; items jsonb:='[]'; w public.work_items;
  candidate record; content jsonb;
begin
  select tm.term_id,tm.member_id into term,person from public.term_memberships tm where tm.id=p_link.membership_id;
  if term is null or exists(select 1 from public.notification_preferences np where np.membership_id=p_link.membership_id and np.mode='mute')
    then return items; end if;
  for w in select x.* from public.work_items x
    where x.term_id=term and x.owner_member_id=person and x.kind in ('task','deliverable') and x.archived_at is null
      and coalesce(x.due_on,(x.due_at at time zone 'Asia/Manila')::date) between today-14 and today+1
      and app_private.notification_pending(x) and app_private.notification_assignee(x)=p_link.membership_id
      and not exists(select 1 from app_private.telegram_snoozes z where z.membership_id=p_link.membership_id and z.target_id=x.id
        and z.snoozed_until>p_now)
    order by coalesce(x.due_on,(x.due_at at time zone 'Asia/Manila')::date),x.due_at nulls last,x.id limit 3
  loop
    items:=items||jsonb_build_array(app_private.telegram_work_item(p_link,w,today));
  end loop;
  if jsonb_array_length(items)<3 then
    for candidate in select aa.id from public.approval_assignments aa
      where aa.term_id=term and aa.reviewer_id=p_link.membership_id and aa.expires_at>p_now
        and not exists(select 1 from public.approval_decisions dd where dd.assignment_id=aa.id)
      order by aa.assigned_at,aa.id limit 10
    loop
      exit when jsonb_array_length(items)>=3;
      content:=app_private.email_reminder_content('approval_waiting',jsonb_build_object('assignmentId',candidate.id),
        p_link.membership_id,term,today,p_now);
      if content is not null then
        items:=items||jsonb_build_array(jsonb_build_object('kind','approval','title',null,'when',null,'path',content->>'path'));
      end if;
    end loop;
  end if;
  if jsonb_array_length(items)<3 then
    for candidate in select pc.work_item_id,app_private.bulletin_material_revision(pc.work_item_id,v.version,v.definition) material
      from public.presentation_controls pc
        cross join lateral(select pv.version,pv.definition from public.presentation_versions pv where pv.control_id=pc.work_item_id
          order by pv.version desc limit 1) v
      where pc.term_id=term and pc.kind='bulletin' and v.definition->>'requiredAck'='true'
      order by pc.work_item_id limit 20
    loop
      exit when jsonb_array_length(items)>=3;
      continue when candidate.material is null;
      content:=app_private.email_reminder_content('announcement_unacknowledged',jsonb_build_object('announcementId',
        candidate.work_item_id,'materialRevisionId',candidate.material),p_link.membership_id,term,today,p_now);
      if content is not null then
        items:=items||jsonb_build_array(jsonb_build_object('kind','announcement','title',left(content->>'title',120),'when',null,
          'path',content->>'path','ack',app_private.telegram_mint(p_link,'ack','announcement',candidate.work_item_id,candidate.material)));
      end if;
    end loop;
  end if;
  return items;
end;
$$;

-- Items for an alert job the caller holds the send lease for (see public.telegram_delivery).
create function public.telegram_job_items(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare job app_private.telegram_jobs; link app_private.telegram_links; w public.work_items; items jsonb:='[]';
  today date:=(statement_timestamp() at time zone 'Asia/Manila')::date;
begin
  select * into job from app_private.telegram_jobs where id=p_id and state='sending' and lease=p_lease
    and lease_until>statement_timestamp();
  if not found then return items; end if;
  select * into link from app_private.telegram_links where membership_id=job.membership_id and generation=job.generation
    and state='linked';
  if not found then return items; end if;
  for w in select distinct on (x.id) x.* from app_private.telegram_job_items i join public.notifications n on n.id=i.notification_id
      join public.work_items x on x.id=n.target_id and x.kind=n.target_kind
    where i.job_id=job.id and app_private.notification_pending(x) and app_private.notification_assignee(x)=job.membership_id
    order by x.id limit 3
  loop
    items:=items||jsonb_build_array(app_private.telegram_work_item(link,w,today));
  end loop;
  return items;
end;
$$;

-- Daily 08:00-12:00 Manila "Your day" message: one per linked live member per Manila day, only when
-- there is something to show. Same lease and outcome rules as public.telegram_delivery.
create function public.telegram_daily(p_action text,p_id uuid default null,p_lease uuid default null,
  p_outcome text default null,p_delay integer default null) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare job app_private.telegram_daily_jobs; link app_private.telegram_links; items jsonb; outcome text;
  local_at timestamp:=statement_timestamp() at time zone 'Asia/Manila'; checked integer:=0;
begin
  if p_action='finish' then
    if p_outcome is null or p_outcome not in ('sent','retry','relink','failed','uncertain')
      or (p_outcome='retry' and (p_delay is null or p_delay not between 1 and 3600)) then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    select * into job from app_private.telegram_daily_jobs where id=p_id and state='sending'
      and lease=p_lease and lease_until>statement_timestamp() for update;
    if not found then return jsonb_build_object('recorded',false); end if;
    outcome:=case when p_outcome='retry' then case when job.attempts>=4 then 'failed' else 'waiting' end else p_outcome end;
    update app_private.telegram_daily_jobs set state=outcome,lease=null,lease_until=null,updated_at=statement_timestamp(),
      run_at=case when outcome='waiting' then statement_timestamp()+greatest(p_delay,30*2^(job.attempts-1))*interval '1 second'
        else run_at end where id=job.id;
    if outcome='relink' then
      update app_private.telegram_links set state='relink',generation=gen_random_uuid(),chat_hash=null,sealed_chat=null
        where membership_id=job.membership_id and generation=job.generation;
    end if;
    return jsonb_build_object('recorded',true);
  end if;
  if p_action is distinct from 'prepare' then raise exception using errcode='22023',message='command_validation_failed'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('telegram-daily',0)) then return null; end if;
  update app_private.telegram_daily_jobs set state='uncertain',lease=null,lease_until=null,updated_at=statement_timestamp()
    where id in(select id from app_private.telegram_daily_jobs where state='sending' and lease_until<=statement_timestamp()
      order by lease_until limit 24 for update skip locked);
  delete from app_private.telegram_action_tokens where token_hash in(select token_hash from app_private.telegram_action_tokens
    where expires_at<=statement_timestamp()-interval '7 days' order by expires_at limit 200);
  if local_at::time<time '08:00' or local_at::time>=time '12:00' then return null; end if;
  while checked<20 loop
    checked:=checked+1;
    select * into job from app_private.telegram_daily_jobs where state='waiting' and run_at<=statement_timestamp()
      and local_day=local_at::date order by run_at,id limit 1 for update skip locked;
    if found then
      select * into link from app_private.telegram_links where membership_id=job.membership_id for share;
    else
      select l.* into link from app_private.telegram_links l
        where l.state='linked' and not exists(select 1 from app_private.telegram_daily_jobs d
          where d.membership_id=l.membership_id and d.local_day=local_at::date)
          and app_private.telegram_member_live(l.membership_id,l.subject_id)
        order by l.membership_id limit 1;
      if not found then return null; end if;
      insert into app_private.telegram_daily_jobs(membership_id,generation,local_day) values(link.membership_id,link.generation,
        local_at::date) returning * into job;
    end if;
    if link.state is distinct from 'linked' or link.generation is distinct from job.generation
      or not app_private.telegram_member_live(link.membership_id,link.subject_id) then
      update app_private.telegram_daily_jobs set state='skipped',updated_at=statement_timestamp() where id=job.id;
      continue;
    end if;
    items:=app_private.telegram_day_items(link,statement_timestamp());
    if jsonb_array_length(items)=0 then
      update app_private.telegram_daily_jobs set state='skipped',updated_at=statement_timestamp() where id=job.id;
      continue;
    end if;
    update app_private.telegram_daily_jobs set state='sending',lease=gen_random_uuid(),
      lease_until=statement_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=statement_timestamp()
      where id=job.id returning * into job;
    return jsonb_build_object('id',job.id,'lease',job.lease,'chatHash',link.chat_hash,'sealedChat',link.sealed_chat,'items',items);
  end loop;
  return jsonb_build_object('skipped',true);
end;
$$;

-- Run one existing member command as that member: the command derives the actor from auth.uid()
-- exactly as it would for an app call, so every scope, version and state check still applies.
-- Callers must already have proven the member through a live Telegram link.
create function app_private.telegram_as_member(p_membership uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
  select m.auth_user_id into subject from public.term_memberships tm join public.members m on m.id=tm.member_id
    where tm.id=p_membership and m.account_state='active';
  if subject is null then raise exception using errcode='42501',message='command_permission_denied'; end if;
  perform set_config('request.jwt.claim.sub',subject::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
  return subject;
end;
$$;

create function app_private.telegram_complete_task(p_membership uuid,p_task uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.work_items; t public.tasks; note text:='Marked done from Telegram';
begin
  perform app_private.telegram_as_member(p_membership);
  select * into w from public.work_items where id=p_task and kind='task';
  select * into t from public.tasks where work_item_id=p_task;
  if w.id is null or t.work_item_id is null then raise exception using errcode='42501',message='command_permission_denied'; end if;
  return public.transition_task(p_task,jsonb_build_object('state',case when t.task_type='review_required' then 'ready_for_review'
    else 'done' end,'reason',note,'evidence',note),w.version,p_request);
end;
$$;

create function app_private.telegram_ack_announcement(p_membership uuid,p_announcement uuid,p_material uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare term uuid; v jsonb;
begin
  perform app_private.telegram_as_member(p_membership);
  select term_id into term from public.term_memberships where id=p_membership;
  v:=public.read_announcement(term,p_announcement);
  if v is null or (v->>'materialRevisionId')::uuid is distinct from p_material then
    raise exception using errcode='40001',message='command_stale_version';
  end if;
  return public.acknowledge_announcement(term,p_announcement,p_material,(v->>'version')::integer,p_request);
end;
$$;

-- Called by the telegram-webhook function for a button press. The chat must be the one currently
-- linked to the token's membership, under the same link generation, and the member must be live.
create function public.telegram_action(p_token_hash text,p_chat_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tok app_private.telegram_action_tokens; link app_private.telegram_links; title text; outcome text;
  saved_sub text:=current_setting('request.jwt.claim.sub',true); saved_role text:=current_setting('request.jwt.claim.role',true);
  saved_claims text:=current_setting('request.jwt.claims',true);
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_chat_hash is null or p_chat_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('result','invalid');
  end if;
  select * into tok from app_private.telegram_action_tokens where token_hash=p_token_hash for update;
  if not found then return jsonb_build_object('result','invalid'); end if;
  select * into link from app_private.telegram_links where membership_id=tok.membership_id for share;
  if link.state is distinct from 'linked' or link.chat_hash is distinct from p_chat_hash or link.generation is distinct from tok.generation
    or not app_private.telegram_member_live(link.membership_id,link.subject_id) then
    return jsonb_build_object('result','denied');
  end if;
  if tok.used_at is not null then return jsonb_build_object('result',tok.result,'repeat',true); end if;
  if tok.expires_at<=statement_timestamp() then return jsonb_build_object('result','expired'); end if;
  select case when w.classification='ordinary' then left(w.title,120) end into title from public.work_items w where w.id=tok.target_id;
  begin
    if tok.action='snooze' then
      insert into app_private.telegram_snoozes(membership_id,target_id,snoozed_until)
        values(tok.membership_id,tok.target_id,statement_timestamp()+interval '1 day')
        on conflict(membership_id,target_id) do update set snoozed_until=excluded.snoozed_until;
      outcome:='snoozed';
    elsif tok.action='done' then
      perform app_private.telegram_complete_task(tok.membership_id,tok.target_id,tok.id);
      outcome:='done';
    else
      perform app_private.telegram_ack_announcement(tok.membership_id,tok.target_id,tok.material_id,tok.id);
      outcome:='acknowledged';
    end if;
  exception when others then
    -- Rolled back to the block start, including the member claims. Nothing changed.
    perform set_config('request.jwt.claim.sub',coalesce(saved_sub,''),true);
    perform set_config('request.jwt.claim.role',coalesce(saved_role,''),true);
    perform set_config('request.jwt.claims',coalesce(saved_claims,''),true);
    return jsonb_build_object('result','failed','title',title);
  end;
  perform set_config('request.jwt.claim.sub',coalesce(saved_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(saved_role,''),true);
  perform set_config('request.jwt.claims',coalesce(saved_claims,''),true);
  update app_private.telegram_action_tokens set used_at=statement_timestamp(),result=outcome where token_hash=tok.token_hash;
  -- Done or acknowledged settles the item, so its other buttons stop working.
  if outcome<>'snoozed' then
    update app_private.telegram_action_tokens set used_at=statement_timestamp(),result=outcome
      where membership_id=tok.membership_id and target_id=tok.target_id and used_at is null;
  end if;
  return jsonb_build_object('result',outcome,'title',title);
end;
$$;

revoke all on function app_private.telegram_mint(app_private.telegram_links,text,text,uuid,uuid),
  app_private.telegram_due_label(date,date),app_private.telegram_work_item(app_private.telegram_links,public.work_items,date),
  app_private.telegram_day_items(app_private.telegram_links,timestamptz),app_private.telegram_as_member(uuid),
  app_private.telegram_complete_task(uuid,uuid,uuid),app_private.telegram_ack_announcement(uuid,uuid,uuid,uuid),
  app_private.telegram_sources(app_private.telegram_links),
  public.telegram_job_items(uuid,uuid),public.telegram_daily(text,uuid,uuid,text,integer),public.telegram_action(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.telegram_job_items(uuid,uuid),public.telegram_daily(text,uuid,uuid,text,integer),
  public.telegram_action(text,text) to service_role;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'term',array[id_column],
  format('select app_private.disposition_key(%L,array[x.%I::text]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.%I x
    join public.term_memberships m on m.id=x.membership_id where m.term_id=$1',
    'app_private.'||source,id_column,category,category,source),
  app_private.disposition_structure('app_private.'||source),false
from (values
  ('telegram_action_tokens','security','token_hash'),
  ('telegram_snoozes','privacy','id'),
  ('telegram_daily_jobs','security','id')
) definitions(source,category,id_column);

commit;
