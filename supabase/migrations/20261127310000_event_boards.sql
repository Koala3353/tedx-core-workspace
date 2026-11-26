-- Seasonal event boards (Online contest, TEDify) and TEDify breakout sessions.
-- A board lists the tasks and deliverables whose title names it ("contest" / "TEDify"); there is no
-- tag field on work items, so the title keyword is the convention. Items still pass the normal
-- summary-level work access check. Sessions are readable by core members and managed by
-- admin.configure or committee.manage on PROGACT or TALREC. Depends on 20261127300000_speaker_portal.
begin;

create table app_private.tedify_sessions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  title text not null check(length(btrim(title)) between 1 and 160),
  speaker_name text check(speaker_name is null or length(btrim(speaker_name)) between 1 and 200),
  room text check(room is null or length(btrim(room)) between 1 and 120),
  starts_at timestamptz check(starts_at is null or isfinite(starts_at)),
  ends_at timestamptz check(ends_at is null or isfinite(ends_at)),
  note text check(note is null or length(note)<=500),
  archived_at timestamptz,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.term_memberships(id),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.term_memberships(id),
  check(ends_at is null or (starts_at is not null and ends_at>starts_at))
);
create index tedify_sessions_term on app_private.tedify_sessions(term_id,starts_at);
create index tedify_sessions_created_by on app_private.tedify_sessions(created_by);
create index tedify_sessions_updated_by on app_private.tedify_sessions(updated_by);
alter table app_private.tedify_sessions enable row level security;
alter table app_private.tedify_sessions force row level security;
revoke all on app_private.tedify_sessions from public,anon,authenticated,service_role;
create trigger turnover_freeze_guard before insert or update or delete on app_private.tedify_sessions
  for each row execute function app_private.turnover_frozen_guard();

create function app_private.tedify_manager(p_term uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(public.has_capability(p_term,'admin.configure'),false) or exists(
    select 1 from public.org_units u where u.term_id=p_term and u.code in ('PROGACT','TALREC') and u.archived_at is null
      and public.has_capability(p_term,'committee.manage',u.id))
$$;

create function app_private.tedify_session_json(s app_private.tedify_sessions) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',s.id,'version',s.version,'title',s.title,'speakerName',s.speaker_name,'room',s.room,
    'startsAt',s.starts_at,'endsAt',s.ends_at,'note',s.note)
$$;

-- p_board: 'contest' or 'tedify'.
create function public.read_event_board(p_term_id uuid,p_board text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare keyword text;
begin
  perform app_private.request_actor(p_term_id,false);
  keyword:=case p_board when 'contest' then 'contest' when 'tedify' then 'tedify' end;
  if keyword is null then raise exception using errcode='22023',message='command_validation_failed'; end if;
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'title',x.title,'dueOn',x.due_on,'dueAt',x.due_at,
        'state',x.semantic_category,'stateLabel',x.label,'committee',x.committee) order by x.sort_day nulls last,x.title,x.id)
      from (select w.id,w.kind,w.title,w.due_on,w.due_at,s.semantic_category,s.label,u.name committee,
          coalesce(w.due_on,(w.due_at at time zone 'Asia/Manila')::date) sort_day
        from public.work_items w join public.status_definitions s on s.id=w.status_id
          left join public.org_units u on u.id=w.lead_unit_id
        where w.term_id=p_term_id and w.archived_at is null and w.kind in ('task','deliverable')
          and strpos(lower(w.title),keyword)>0 and public.can_access_work(w.id,'summary')
        order by sort_day nulls last,w.title,w.id limit 60) x),'[]'::jsonb),
    'sessions',case when keyword='tedify' then coalesce((select jsonb_agg(app_private.tedify_session_json(s)
        order by s.starts_at nulls last,s.room nulls last,s.title,s.id)
      from app_private.tedify_sessions s where s.term_id=p_term_id and s.archived_at is null),'[]'::jsonb) end,
    'canManageSessions',keyword='tedify' and app_private.tedify_manager(p_term_id),
    'refreshedAt',statement_timestamp());
end;
$$;

-- Create or edit a breakout session. p_values: {title, speakerName?, room?, startsAt?, endsAt?, note?, archived?}
create function public.save_tedify_session(p_term_id uuid,p_session_id uuid,p_values jsonb,p_expected_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.term_memberships; s app_private.tedify_sessions; prior jsonb; payload jsonb;
  v_title text; v_speaker text; v_room text; v_starts timestamptz; v_ends timestamptz; v_note text; archive boolean;
begin
  actor:=app_private.request_actor(p_term_id,true);
  if not app_private.tedify_manager(p_term_id) or app_private.disposition_replay_required(p_term_id) then
    raise exception using errcode='42501',message='command_permission_denied'; end if;
  payload:=jsonb_build_array(p_session_id,p_values,p_expected_version);
  prior:=app_private.portal_command_prior(p_term_id,'save_tedify_session',p_request_id,payload);
  if prior is not null then return prior; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object'
    or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('title','speakerName','room','startsAt','endsAt','note','archived')) then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  v_title:=btrim(p_values->>'title'); v_speaker:=nullif(btrim(coalesce(p_values->>'speakerName','')),'');
  v_room:=nullif(btrim(coalesce(p_values->>'room','')),''); v_note:=nullif(btrim(coalesce(p_values->>'note','')),'');
  v_starts:=nullif(p_values->>'startsAt','')::timestamptz; v_ends:=nullif(p_values->>'endsAt','')::timestamptz;
  archive:=coalesce((p_values->>'archived')::boolean,false);
  if v_title is null or length(v_title) not between 1 and 160 or length(v_speaker)>200 or length(v_room)>120 or length(v_note)>500
    or (v_ends is not null and (v_starts is null or v_ends<=v_starts)) then
    raise exception using errcode='22023',message='command_validation_failed'; end if;
  if p_session_id is null then
    if archive then raise exception using errcode='22023',message='command_validation_failed'; end if;
    insert into app_private.tedify_sessions(term_id,title,speaker_name,room,starts_at,ends_at,note,created_by,updated_by)
      values(p_term_id,v_title,v_speaker,v_room,v_starts,v_ends,v_note,actor.id,actor.id) returning * into s;
  else
    select * into s from app_private.tedify_sessions where id=p_session_id and term_id=p_term_id and archived_at is null for update;
    if not found then raise exception using errcode='42501',message='command_permission_denied'; end if;
    if s.version is distinct from p_expected_version then raise exception using errcode='40001',message='command_stale_version'; end if;
    update app_private.tedify_sessions set title=v_title,speaker_name=v_speaker,room=v_room,starts_at=v_starts,ends_at=v_ends,note=v_note,
      archived_at=case when archive then statement_timestamp() end,version=version+1,updated_at=statement_timestamp(),updated_by=actor.id
      where id=s.id returning * into s;
  end if;
  return app_private.portal_command_finish(p_term_id,'save_tedify_session',p_request_id,payload,
    app_private.tedify_session_json(s)||jsonb_build_object('archived',s.archived_at is not null));
end;
$$;

revoke all on function app_private.tedify_manager(uuid),app_private.tedify_session_json(app_private.tedify_sessions),
  public.read_event_board(uuid,text),public.save_tedify_session(uuid,uuid,jsonb,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_event_board(uuid,text),public.save_tedify_session(uuid,uuid,jsonb,integer,uuid) to authenticated;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
values('app_private.tedify_sessions','operational','term',array['id'],
  'select app_private.disposition_key(''app_private.tedify_sessions'',array[x.id::text]) target_hash,
    ''operational'' category,null::uuid root_id,app_private.retention_is_held($1,''operational'',x.id,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.tedify_sessions x where x.term_id=$1',
  app_private.disposition_structure('app_private.tedify_sessions'),false);

commit;
