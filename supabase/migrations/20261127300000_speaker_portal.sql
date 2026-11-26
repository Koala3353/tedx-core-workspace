-- Speaker portal: a per-speaker checklist (bio, headshot, outline, script drafts, slides, rehearsal RSVP)
-- that TalRec manages and the invited speaker reads and answers from "My part".
-- Speakers are guests, so they hold no term membership. A speaker is keyed by the guest email the
-- invitation was sent to; renewing an invitation keeps the same checklist. Every table is private
-- (RLS forced, no grants); clients reach them only through the RPCs below.
-- Managers: admin.configure, or committee.manage on the term's TALREC unit. Readers of the tracker:
-- managers plus active TalRec members. A guest reads and answers only their own checklist.
begin;

create table app_private.speakers (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  guest_email text not null check(length(guest_email)<=254 and guest_email=lower(btrim(guest_email))
    and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  display_name text not null check(length(btrim(display_name)) between 1 and 200),
  talk_title text check(talk_title is null or length(btrim(talk_title)) between 1 and 240),
  contact_membership_id uuid references public.term_memberships(id),
  archived_at timestamptz,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.term_memberships(id),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.term_memberships(id)
);
create unique index speakers_live_email on app_private.speakers(term_id,guest_email) where archived_at is null;
create index speakers_contact on app_private.speakers(contact_membership_id);
create index speakers_created_by on app_private.speakers(created_by);
create index speakers_updated_by on app_private.speakers(updated_by);

create table app_private.speaker_requirements (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  speaker_id uuid not null references app_private.speakers(id),
  kind text not null check(kind in ('bio','headshot','outline','script','slides','rehearsal_rsvp','other')),
  label text not null check(length(btrim(label)) between 1 and 120),
  due_on date check(due_on is null or isfinite(due_on)),
  status text not null default 'not_started' check(status in ('not_started','submitted','changes_requested','done')),
  link_url text check(link_url is null or (length(link_url)<=2000 and link_url ~ '^https://[^[:space:]]+$')),
  note text check(note is null or length(note)<=500),
  guest_note text check(guest_note is null or length(guest_note)<=500),
  sort_order integer not null default 0 check(sort_order between 0 and 1000),
  submitted_at timestamptz,
  archived_at timestamptz,
  version integer not null default 1 check(version>0),
  updated_at timestamptz not null default statement_timestamp()
);
create index speaker_requirements_speaker on app_private.speaker_requirements(speaker_id,sort_order);
create index speaker_requirements_term on app_private.speaker_requirements(term_id);

-- Replay receipts for portal commands (speakers, checklist answers, TEDify sessions).
create table app_private.portal_commands (
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  term_id uuid not null references public.terms(id),
  command text not null check(command ~ '^[a-z_]{1,60}$'),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key(actor_id,request_id)
);
create index portal_commands_term on app_private.portal_commands(term_id);

do $$
declare relation text;
begin
  foreach relation in array array['speakers','speaker_requirements','portal_commands'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
    execute format('create trigger turnover_freeze_guard before insert or update or delete on app_private.%I for each row execute function app_private.turnover_frozen_guard()',relation);
  end loop;
end $$;

-- Idempotency: the same caller + request id returns the first result; different details conflict.
create function app_private.portal_command_prior(p_term uuid,p_command text,p_key uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c app_private.portal_commands; print text;
begin
  if p_key is null or auth.uid() is null then raise exception using errcode='22023',message='command_validation_failed'; end if;
  print:=encode(sha256(convert_to(jsonb_build_array(p_term,p_command,p_payload)::text,'UTF8')),'hex');
  select * into c from app_private.portal_commands where actor_id=auth.uid() and request_id=p_key;
  if not found then return null; end if;
  if c.fingerprint<>print then raise exception using errcode='22023',message='command_idempotency_conflict'; end if;
  return c.result;
end;
$$;
create function app_private.portal_command_finish(p_term uuid,p_command text,p_key uuid,p_payload jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  insert into app_private.portal_commands(actor_id,request_id,term_id,command,fingerprint,result)
    values(auth.uid(),p_key,p_term,p_command,
      encode(sha256(convert_to(jsonb_build_array(p_term,p_command,p_payload)::text,'UTF8')),'hex'),p_result);
  return p_result;
end;
$$;

create function app_private.talrec_unit(p_term uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select u.id from public.org_units u where u.term_id=p_term and u.code='TALREC' and u.archived_at is null limit 1
$$;
create function app_private.speaker_manager(p_term uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(public.has_capability(p_term,'admin.configure'),false)
    or coalesce((select public.has_capability(p_term,'committee.manage',app_private.talrec_unit(p_term))
      where app_private.talrec_unit(p_term) is not null),false)
$$;
create function app_private.speaker_reader(p_term uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select app_private.speaker_manager(p_term) or exists(select 1 from public.unit_memberships d
    where d.term_membership_id=public.current_term_membership(p_term) and d.unit_id=app_private.talrec_unit(p_term)
      and d.status='active' and d.effective_from<=statement_timestamp() and d.effective_to>statement_timestamp())
$$;
create function app_private.speaker_actor(p_term uuid,p_write boolean) returns public.term_memberships
language plpgsql stable security definer set search_path='' as $$
declare m public.term_memberships;
begin
  m:=app_private.request_actor(p_term,p_write);
  if not (case when p_write then app_private.speaker_manager(p_term) else app_private.speaker_reader(p_term) end)
    or (p_write and app_private.disposition_replay_required(p_term)) then
    raise exception using errcode='42501',message='command_permission_denied';
  end if;
  return m;
end;
$$;

-- A named, active core member; null when the membership no longer qualifies.
create function app_private.speaker_contact(p_membership uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('membershipId',tm.id,'name',m.display_name,'email',m.normalized_email,
    'position',(select r.name from app_private.tedx_seats s join public.roles r on r.id=s.role_id
      where s.membership_id=tm.id and not s.revoked and s.starts_at<=statement_timestamp() and s.ends_at>statement_timestamp()
      order by s.starts_at,s.id limit 1))
  from public.term_memberships tm join public.members m on m.id=tm.member_id
  where tm.id=p_membership and tm.membership_kind='core' and tm.status='active' and m.account_state='active'
    and tm.joined_at<=statement_timestamp() and tm.ends_at>statement_timestamp()
$$;

create function app_private.speaker_requirement_json(r app_private.speaker_requirements) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'version',r.version,'kind',r.kind,'label',r.label,'dueOn',r.due_on,'status',r.status,
    'linkUrl',r.link_url,'note',r.note,'guestNote',r.guest_note,'submittedAt',r.submitted_at)
$$;
create function app_private.speaker_requirements_json(p_speaker uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(app_private.speaker_requirement_json(r) order by r.sort_order,r.due_on nulls last,r.label,r.id),'[]'::jsonb)
  from app_private.speaker_requirements r where r.speaker_id=p_speaker and r.archived_at is null
$$;

-- "My part" for the signed-in guest. Event-week core calendar entries (title, time, place only) are
-- included so a speaker sees rehearsal and event day; anything else appears only when shared with them.
create function public.read_my_part(p_term_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.guest_invitations; sp app_private.speakers; term public.terms; result jsonb;
begin
  select * into inv from public.guest_invitations where id=app_private.current_guest_invitation(p_term_id);
  if not found then raise exception using errcode='42501',message='command_permission_denied'; end if;
  select * into term from public.terms where id=p_term_id;
  select * into sp from app_private.speakers where term_id=p_term_id and guest_email=inv.email and archived_at is null;
  result:=jsonb_build_object(
    'speaker',case when sp.id is null then null else jsonb_build_object('name',sp.display_name,'talkTitle',sp.talk_title) end,
    'requirements',case when sp.id is null then '[]'::jsonb else app_private.speaker_requirements_json(sp.id) end,
    'contact',coalesce(app_private.speaker_contact(sp.contact_membership_id),app_private.speaker_contact(inv.sponsor_id)),
    'eventDate',term.event_date,
    'shared',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'title',x.title,'dueOn',x.due_on,'dueAt',x.due_at,
        'state',x.semantic_category,'stateLabel',x.label) order by x.sort_day nulls last,x.title,x.id)
      from (select w.id,w.kind,w.title,w.due_on,w.due_at,s.semantic_category,s.label,
          coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date) sort_day
        from public.work_items w join public.status_definitions s on s.id=w.status_id
        where w.term_id=p_term_id and w.archived_at is null and w.kind in ('task','deliverable')
          and exists(select 1 from public.record_grants g where g.work_item_id=w.id and g.term_id=p_term_id
            and g.guest_invitation_id=inv.id and g.grant_kind='read' and app_private.work_grant_matches(g))
          and public.can_access_work(w.id,'detail')
        order by sort_day nulls last,w.title,w.id limit 30) x),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',x.work_item_id,'title',x.title,'location',x.location,'allDay',x.all_day,
        'startOn',x.start_on,'endOn',x.end_on,'startsAt',x.starts_at,'endsAt',x.ends_at) order by x.sort_at,x.title)
      from (select e.*,coalesce(e.starts_at,e.start_on::timestamp at time zone 'Asia/Manila') sort_at
        from public.calendar_events e join public.work_items w on w.id=e.work_item_id
        where w.term_id=p_term_id and w.archived_at is null and e.state='confirmed'
          and ((e.visibility='core' and coalesce(e.start_on,(e.starts_at at time zone 'Asia/Manila')::date)
                between term.event_date-3 and term.event_date)
            or public.can_access_work(w.id,'detail'))
        order by sort_at limit 10) x),'[]'::jsonb));
  perform app_private.record_content_read('read_my_part',p_term_id,null,sp.id is not null);
  return result;
end;
$$;

-- The guest marks one of their own items as sent, with an optional https link and a short note.
create function public.submit_my_requirement(p_term_id uuid,p_requirement_id uuid,p_link_url text,p_note text,
  p_expected_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.guest_invitations; r app_private.speaker_requirements; payload jsonb; prior jsonb;
  v_link text:=nullif(btrim(coalesce(p_link_url,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  select * into inv from public.guest_invitations where id=app_private.current_guest_invitation(p_term_id);
  if not found or app_private.disposition_replay_required(p_term_id) then
    raise exception using errcode='42501',message='command_permission_denied'; end if;
  payload:=jsonb_build_array(p_requirement_id,v_link,v_note,p_expected_version);
  prior:=app_private.portal_command_prior(p_term_id,'submit_my_requirement',p_request_id,payload);
  if prior is not null then return prior; end if;
  select r0.* into r from app_private.speaker_requirements r0 join app_private.speakers s on s.id=r0.speaker_id
    where r0.id=p_requirement_id and r0.term_id=p_term_id and r0.archived_at is null
      and s.guest_email=inv.email and s.archived_at is null
    for update of r0;
  if not found then raise exception using errcode='42501',message='command_permission_denied'; end if;
  if (v_link is not null and (length(v_link)>2000 or v_link !~ '^https://[^[:space:]]+$')) or length(v_note)>500 then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  if r.version is distinct from p_expected_version then raise exception using errcode='40001',message='command_stale_version'; end if;
  if r.status='done' then raise exception using errcode='55000',message='command_dependency_blocked'; end if;
  update app_private.speaker_requirements set status='submitted',link_url=coalesce(v_link,link_url),guest_note=v_note,
    submitted_at=statement_timestamp(),version=version+1,updated_at=statement_timestamp()
    where id=r.id returning * into r;
  return app_private.portal_command_finish(p_term_id,'submit_my_requirement',p_request_id,payload,app_private.speaker_requirement_json(r));
end;
$$;

-- TalRec tracker: every speaker with their checklist and invitation state.
create function public.read_speaker_tracker(p_term_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; unit uuid;
begin
  perform app_private.speaker_actor(p_term_id,false);
  unit:=app_private.talrec_unit(p_term_id);
  result:=jsonb_build_object(
    'canManage',app_private.speaker_manager(p_term_id),
    'speakers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'email',s.guest_email,'name',s.display_name,
        'talkTitle',s.talk_title,'contact',app_private.speaker_contact(s.contact_membership_id),
        'invitation',(select jsonb_build_object('state',case when i.revoked_at is not null then 'revoked'
              when i.expires_at<=statement_timestamp() then 'expired' when i.redeemed_at is not null then 'accepted' else 'pending' end,
            'expiresAt',i.expires_at)
          from public.guest_invitations i where i.term_id=p_term_id and i.email=s.guest_email
          order by i.created_at desc,i.id limit 1),
        'requirements',app_private.speaker_requirements_json(s.id)) order by s.display_name,s.id)
      from app_private.speakers s where s.term_id=p_term_id and s.archived_at is null),'[]'::jsonb),
    'contacts',coalesce((select jsonb_agg(c.contact order by c.contact->>'name') from (
        select distinct on (d.term_membership_id) app_private.speaker_contact(d.term_membership_id) contact
        from public.unit_memberships d where unit is not null and d.unit_id=unit and d.status='active'
          and d.effective_from<=statement_timestamp() and d.effective_to>statement_timestamp()) c
      where c.contact is not null),'[]'::jsonb));
  perform app_private.record_content_read('read_speaker_tracker',p_term_id,null,jsonb_array_length(result->'speakers')>0);
  return result;
end;
$$;

-- Create or edit a speaker. A new speaker starts with the standard checklist, due before the event.
-- p_values: {email, name, talkTitle?, contactMembershipId?, archived?}
create function public.save_speaker(p_term_id uuid,p_speaker_id uuid,p_values jsonb,p_expected_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.term_memberships; s app_private.speakers; term public.terms; prior jsonb; payload jsonb;
  mail text; name text; title text; contact uuid; archive boolean;
begin
  actor:=app_private.speaker_actor(p_term_id,true);
  payload:=jsonb_build_array(p_speaker_id,p_values,p_expected_version);
  prior:=app_private.portal_command_prior(p_term_id,'save_speaker',p_request_id,payload);
  if prior is not null then return prior; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object'
    or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('email','name','talkTitle','contactMembershipId','archived')) then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  mail:=lower(btrim(p_values->>'email')); name:=btrim(p_values->>'name'); title:=nullif(btrim(coalesce(p_values->>'talkTitle','')),'');
  archive:=coalesce((p_values->>'archived')::boolean,false);
  if nullif(p_values->>'contactMembershipId','') is not null then
    contact:=(p_values->>'contactMembershipId')::uuid;
    if not exists(select 1 from public.term_memberships where id=contact and term_id=p_term_id and membership_kind='core') then
      raise exception using errcode='22023',message='command_validation_failed'; end if;
  end if;
  if mail is null or length(mail)>254 or mail !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or name is null or length(name) not between 1 and 200 or length(title)>240 then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  if p_speaker_id is null then
    if archive then raise exception using errcode='22023',message='command_validation_failed'; end if;
    if exists(select 1 from app_private.speakers where term_id=p_term_id and guest_email=mail and archived_at is null) then
      raise exception using errcode='23505',message='command_conflict'; end if;
    select * into term from public.terms where id=p_term_id;
    insert into app_private.speakers(term_id,guest_email,display_name,talk_title,contact_membership_id,created_by,updated_by)
      values(p_term_id,mail,name,title,contact,actor.id,actor.id) returning * into s;
    insert into app_private.speaker_requirements(term_id,speaker_id,kind,label,due_on,sort_order)
    select p_term_id,s.id,v.kind,v.label,term.event_date-v.days_before,v.sort_order
    from (values ('bio','Short bio',75,10),('headshot','Headshot photo',75,20),('outline','Talk outline',60,30),
      ('script','Script draft',45,40),('slides','Slides',14,50),('rehearsal_rsvp','Rehearsal RSVP',7,60)) v(kind,label,days_before,sort_order);
  else
    select * into s from app_private.speakers where id=p_speaker_id and term_id=p_term_id and archived_at is null for update;
    if not found then raise exception using errcode='42501',message='command_permission_denied'; end if;
    if s.version is distinct from p_expected_version then raise exception using errcode='40001',message='command_stale_version'; end if;
    if not archive and mail<>s.guest_email and exists(select 1 from app_private.speakers
      where term_id=p_term_id and guest_email=mail and archived_at is null and id<>s.id) then
      raise exception using errcode='23505',message='command_conflict'; end if;
    update app_private.speakers set guest_email=mail,display_name=name,talk_title=title,contact_membership_id=contact,
      archived_at=case when archive then statement_timestamp() end,version=version+1,updated_at=statement_timestamp(),updated_by=actor.id
      where id=s.id returning * into s;
  end if;
  return app_private.portal_command_finish(p_term_id,'save_speaker',p_request_id,payload,
    jsonb_build_object('id',s.id,'version',s.version,'archived',s.archived_at is not null));
end;
$$;

-- Create or edit one checklist item. p_values: {speakerId (create only), kind, label, dueOn?, status?, linkUrl?, note?, archived?}
create function public.save_speaker_requirement(p_term_id uuid,p_requirement_id uuid,p_values jsonb,p_expected_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.term_memberships; r app_private.speaker_requirements; prior jsonb; payload jsonb; speaker uuid;
  v_kind text; v_label text; v_due date; v_status text; v_link text; v_note text; archive boolean;
begin
  actor:=app_private.speaker_actor(p_term_id,true);
  payload:=jsonb_build_array(p_requirement_id,p_values,p_expected_version);
  prior:=app_private.portal_command_prior(p_term_id,'save_speaker_requirement',p_request_id,payload);
  if prior is not null then return prior; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object'
    or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('speakerId','kind','label','dueOn','status','linkUrl','note','archived')) then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  v_kind:=p_values->>'kind'; v_label:=btrim(p_values->>'label'); v_due:=nullif(p_values->>'dueOn','')::date;
  v_status:=coalesce(p_values->>'status','not_started'); v_link:=nullif(btrim(coalesce(p_values->>'linkUrl','')),'');
  v_note:=nullif(btrim(coalesce(p_values->>'note','')),''); archive:=coalesce((p_values->>'archived')::boolean,false);
  if v_kind is null or v_kind not in ('bio','headshot','outline','script','slides','rehearsal_rsvp','other')
    or v_label is null or length(v_label) not between 1 and 120
    or v_status not in ('not_started','submitted','changes_requested','done')
    or (v_link is not null and (length(v_link)>2000 or v_link !~ '^https://[^[:space:]]+$')) or length(v_note)>500 then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  if p_requirement_id is null then
    speaker:=nullif(p_values->>'speakerId','')::uuid;
    if archive or not exists(select 1 from app_private.speakers where id=speaker and term_id=p_term_id and archived_at is null) then
      raise exception using errcode='22023',message='command_validation_failed'; end if;
    insert into app_private.speaker_requirements(term_id,speaker_id,kind,label,due_on,status,link_url,note,sort_order,submitted_at)
      values(p_term_id,speaker,v_kind,v_label,v_due,v_status,v_link,v_note,
        coalesce((select max(sort_order)+10 from app_private.speaker_requirements where speaker_id=speaker and sort_order<=990),10),
        case when v_status in ('submitted','done') then statement_timestamp() end)
      returning * into r;
  else
    select r0.* into r from app_private.speaker_requirements r0 join app_private.speakers s on s.id=r0.speaker_id
      where r0.id=p_requirement_id and r0.term_id=p_term_id and r0.archived_at is null and s.archived_at is null for update of r0;
    if not found then raise exception using errcode='42501',message='command_permission_denied'; end if;
    if r.version is distinct from p_expected_version then raise exception using errcode='40001',message='command_stale_version'; end if;
    update app_private.speaker_requirements set kind=v_kind,label=v_label,due_on=v_due,status=v_status,link_url=v_link,note=v_note,
      submitted_at=case when v_status in ('submitted','done') then coalesce(submitted_at,statement_timestamp()) end,
      archived_at=case when archive then statement_timestamp() end,version=version+1,updated_at=statement_timestamp()
      where id=r.id returning * into r;
  end if;
  return app_private.portal_command_finish(p_term_id,'save_speaker_requirement',p_request_id,payload,app_private.speaker_requirement_json(r));
end;
$$;

insert into public.restricted_read_endpoints(endpoint,argument_types) values
  ('read_my_part','uuid'),('read_speaker_tracker','uuid');

revoke all on function app_private.portal_command_prior(uuid,text,uuid,jsonb),app_private.portal_command_finish(uuid,text,uuid,jsonb,jsonb),
  app_private.talrec_unit(uuid),app_private.speaker_manager(uuid),app_private.speaker_reader(uuid),
  app_private.speaker_actor(uuid,boolean),app_private.speaker_contact(uuid),
  app_private.speaker_requirement_json(app_private.speaker_requirements),app_private.speaker_requirements_json(uuid),
  public.read_my_part(uuid),public.submit_my_requirement(uuid,uuid,text,text,integer,uuid),public.read_speaker_tracker(uuid),
  public.save_speaker(uuid,uuid,jsonb,integer,uuid),public.save_speaker_requirement(uuid,uuid,jsonb,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_my_part(uuid),public.submit_my_requirement(uuid,uuid,text,text,integer,uuid),
  public.read_speaker_tracker(uuid),public.save_speaker(uuid,uuid,jsonb,integer,uuid),
  public.save_speaker_requirement(uuid,uuid,jsonb,integer,uuid) to authenticated;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'term',array[id_column],
  format('select app_private.disposition_key(%L,array[x.%I::text]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.%I x where x.term_id=$1',
    'app_private.'||source,id_column,category,category,source),
  app_private.disposition_structure('app_private.'||source),false
from (values
  ('speakers','guest','id'),
  ('speaker_requirements','guest','id')
) definitions(source,category,id_column);
insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
values('app_private.portal_commands','security','term',array['actor_id','request_id'],
  'select app_private.disposition_key(''app_private.portal_commands'',array[x.actor_id::text,x.request_id::text]) target_hash,
    ''security'' category,null::uuid root_id,app_private.retention_is_held($1,''security'',null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.portal_commands x where x.term_id=$1',
  app_private.disposition_structure('app_private.portal_commands'),false);

commit;
