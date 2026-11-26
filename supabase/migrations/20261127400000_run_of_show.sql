-- Event-day run of show: an ordered segment plan per term plus one live state row.
-- Every table is private (RLS forced, no grants); clients reach them only through the RPCs below.
-- Reading: any core member of the term. Editing the plan and the live controls: StageMan heads
-- (committee.manage on the STAGEMAN unit) or admins (admin.configure). Writes are idempotent per
-- request id and the live controls also check the state version so two presses never skip twice.
begin;

create table app_private.run_of_show_segments (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  position integer not null check(position between 1 and 500),
  title text not null check(length(btrim(title)) between 1 and 160),
  kind text not null check(kind in ('talk','performance','host','break','tech')),
  planned_start time,
  planned_duration_s integer not null check(planned_duration_s between 0 and 86400),
  owner_unit_id uuid references public.org_units(id),
  cue_notes text not null default '' check(length(cue_notes)<=2000),
  status text not null default 'planned' check(status in ('planned','live','done','skipped')),
  actual_start timestamptz check(actual_start is null or isfinite(actual_start)),
  actual_end timestamptz check(actual_end is null or isfinite(actual_end)),
  version integer not null default 1 check(version>0),
  archived_at timestamptz,
  created_by uuid not null references public.term_memberships(id),
  updated_by uuid not null references public.term_memberships(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create index run_of_show_segments_term on app_private.run_of_show_segments(term_id,position) where archived_at is null;
create index run_of_show_segments_unit on app_private.run_of_show_segments(owner_unit_id);
create index run_of_show_segments_created_by on app_private.run_of_show_segments(created_by);
create index run_of_show_segments_updated_by on app_private.run_of_show_segments(updated_by);

create table app_private.run_of_show_state (
  term_id uuid primary key references public.terms(id),
  show_start time,
  phase text not null default 'idle' check(phase in ('idle','running','held','finished')),
  current_segment_id uuid references app_private.run_of_show_segments(id),
  segment_started_at timestamptz check(segment_started_at is null or isfinite(segment_started_at)),
  held_at timestamptz check(held_at is null or isfinite(held_at)),
  held_s integer not null default 0 check(held_s between 0 and 864000),
  delay_s integer not null default 0 check(delay_s between -43200 and 43200),
  version integer not null default 1 check(version>0),
  updated_by uuid references public.term_memberships(id),
  updated_at timestamptz not null default statement_timestamp()
);
create index run_of_show_state_segment on app_private.run_of_show_state(current_segment_id);
create index run_of_show_state_updated_by on app_private.run_of_show_state(updated_by);

do $$
declare relation text;
begin
  foreach relation in array array['run_of_show_segments','run_of_show_state'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

-- The caller's core membership in this term, or permission denied.
create function app_private.run_of_show_reader(p_term_id uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare m uuid;
begin
  m:=case when p_term_id is null then null else public.current_term_membership(p_term_id) end;
  if m is null then raise exception using errcode='42501',message='command_permission_denied'; end if;
  return m;
end;
$$;

-- StageMan heads (committee.manage on the live STAGEMAN unit) or admins.
create function app_private.run_of_show_editor(p_term_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.has_capability(p_term_id,'admin.configure') or exists(
    select 1 from public.org_units u where u.term_id=p_term_id and u.code='STAGEMAN' and u.archived_at is null
      and public.has_capability(p_term_id,'committee.manage',u.id));
$$;

-- Planned start per segment: a pinned start wins, otherwise the previous segment's planned end,
-- starting from the show start. Null while neither a show start nor an earlier pin exists.
create function app_private.run_of_show_schedule(p_term_id uuid) returns table(segment_id uuid,planned_at time)
language plpgsql stable security definer set search_path='' as $$
declare cursor_at time; s record;
begin
  select st.show_start into cursor_at from app_private.run_of_show_state st where st.term_id=p_term_id;
  for s in select x.id,x.planned_start,x.planned_duration_s from app_private.run_of_show_segments x
    where x.term_id=p_term_id and x.archived_at is null order by x.position,x.created_at,x.id
  loop
    cursor_at:=coalesce(s.planned_start,cursor_at);
    segment_id:=s.id; planned_at:=cursor_at;
    return next;
    if cursor_at is not null then cursor_at:=cursor_at+make_interval(secs=>s.planned_duration_s); end if;
  end loop;
end;
$$;

create function app_private.run_of_show_json(p_term_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'serverNow',statement_timestamp(),
    'canEdit',app_private.run_of_show_editor(p_term_id),
    'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'code',u.code,'name',u.name) order by u.name,u.id)
      from public.org_units u where u.term_id=p_term_id and u.archived_at is null),'[]'::jsonb),
    'segments',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'position',s.position,'title',s.title,'kind',s.kind,
        'plannedStart',to_char(s.planned_start,'HH24:MI'),'scheduledStart',to_char(sc.planned_at,'HH24:MI'),
        'durationS',s.planned_duration_s,'ownerUnitId',s.owner_unit_id,'ownerUnit',u.name,'ownerUnitCode',u.code,
        'cueNotes',s.cue_notes,'status',s.status,'actualStart',s.actual_start,'actualEnd',s.actual_end,'version',s.version)
        order by s.position,s.created_at,s.id)
      from app_private.run_of_show_segments s
      left join app_private.run_of_show_schedule(p_term_id) sc on sc.segment_id=s.id
      left join public.org_units u on u.id=s.owner_unit_id
      where s.term_id=p_term_id and s.archived_at is null),'[]'::jsonb),
    'state',(select jsonb_build_object('showStart',to_char(st.show_start,'HH24:MI'),'phase',coalesce(st.phase,'idle'),
        'currentSegmentId',st.current_segment_id,'segmentStartedAt',st.segment_started_at,'heldAt',st.held_at,
        'heldS',coalesce(st.held_s,0),'delayS',coalesce(st.delay_s,0),'version',coalesce(st.version,1),
        'updatedAt',st.updated_at,'updatedBy',m.display_name)
      from (select 1) one
      left join app_private.run_of_show_state st on st.term_id=p_term_id
      left join public.term_memberships tm on tm.id=st.updated_by
      left join public.members m on m.id=tm.member_id));
$$;

create function public.read_run_of_show(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.run_of_show_reader(p_term_id);
  return app_private.run_of_show_json(p_term_id);
end;
$$;

-- Ensures the state row exists and returns it locked.
create function app_private.run_of_show_lock(p_term_id uuid) returns app_private.run_of_show_state
language plpgsql security definer set search_path='' as $$
declare st app_private.run_of_show_state;
begin
  perform pg_advisory_xact_lock(hashtextextended('run-of-show:'||p_term_id::text,0));
  insert into app_private.run_of_show_state(term_id) values(p_term_id) on conflict(term_id) do nothing;
  select * into st from app_private.run_of_show_state where term_id=p_term_id for update;
  return st;
end;
$$;

-- Editor guard shared by both write RPCs: core member, editor, active term.
create function app_private.run_of_show_writer(p_term_id uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare m uuid;
begin
  m:=app_private.run_of_show_reader(p_term_id);
  if not app_private.run_of_show_editor(p_term_id)
    or not exists(select 1 from public.terms t where t.id=p_term_id and t.state='active') then
    raise exception using errcode='42501',message='command_permission_denied';
  end if;
  return m;
end;
$$;

-- Plan editing. p_action: 'save' {id?, version?, title, kind, plannedStart?, durationS, ownerUnitId?, cueNotes},
-- 'move' {id, direction:'up'|'down'}, 'remove' {id, version}, 'set_start' {showStart|null},
-- 'reset' {} (every segment back to planned and the live state to idle, for after a dry run).
create function public.edit_run_of_show(p_term_id uuid,p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; receipt jsonb; payload jsonb; st app_private.run_of_show_state; seg app_private.run_of_show_segments;
  other app_private.run_of_show_segments; v_title text; v_kind text; v_start time; v_duration integer; v_unit uuid;
  v_notes text; v_position integer; v_id uuid; v_version integer; v_text text;
begin
  actor:=app_private.run_of_show_writer(p_term_id);
  if p_request_id is null or p_action is null or p_action not in ('save','move','remove','set_start','reset')
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  payload:=jsonb_build_array(p_term_id,p_action,p_payload);
  receipt:=app_private.begin_work_command('edit_run_of_show',p_request_id,payload);
  if receipt is not null then return receipt; end if;
  st:=app_private.run_of_show_lock(p_term_id);

  if p_action in ('save','move','remove') and jsonb_typeof(p_payload->'id')='string' then
    v_text:=lower(p_payload->>'id');
    if v_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    v_id:=v_text::uuid;
    select * into seg from app_private.run_of_show_segments where id=v_id and term_id=p_term_id and archived_at is null for update;
    if seg.id is null then raise exception using errcode='40001',message='command_stale_version'; end if;
  elsif p_action in ('move','remove') then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  if p_action in ('save','remove') and seg.id is not null then
    v_version:=case when jsonb_typeof(p_payload->'version')='number' then (p_payload->>'version')::numeric::integer end;
    if v_version is distinct from seg.version then raise exception using errcode='40001',message='command_stale_version'; end if;
  end if;

  if p_action='save' then
    v_title:=btrim(coalesce(p_payload->>'title',''));
    v_kind:=p_payload->>'kind';
    v_notes:=btrim(coalesce(p_payload->>'cueNotes',''));
    if jsonb_typeof(p_payload->'durationS') is distinct from 'number' then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    v_duration:=(p_payload->>'durationS')::numeric::integer;
    v_text:=nullif(btrim(coalesce(p_payload->>'plannedStart','')),'');
    if v_text is not null and v_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    v_start:=v_text::time;
    v_text:=nullif(p_payload->>'ownerUnitId','');
    if v_text is not null then
      select u.id into v_unit from public.org_units u where u.term_id=p_term_id and u.archived_at is null
        and u.id::text=lower(v_text);
      if v_unit is null then raise exception using errcode='22023',message='command_validation_failed'; end if;
    end if;
    if length(v_title) not between 1 and 160 or v_kind is null or v_kind not in ('talk','performance','host','break','tech')
      or v_duration not between 0 and 86400 or length(v_notes)>2000 then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    if seg.id is null then
      select coalesce(max(position),0)+1 into v_position from app_private.run_of_show_segments
        where term_id=p_term_id and archived_at is null;
      if v_position>500 then raise exception using errcode='22023',message='command_validation_failed'; end if;
      insert into app_private.run_of_show_segments(term_id,position,title,kind,planned_start,planned_duration_s,owner_unit_id,
          cue_notes,created_by,updated_by)
        values(p_term_id,v_position,v_title,v_kind,v_start,v_duration,v_unit,v_notes,actor,actor);
    else
      update app_private.run_of_show_segments set title=v_title,kind=v_kind,planned_start=v_start,planned_duration_s=v_duration,
          owner_unit_id=v_unit,cue_notes=v_notes,version=version+1,updated_by=actor,updated_at=statement_timestamp()
        where id=seg.id;
    end if;
  elsif p_action='move' then
    if p_payload->>'direction' is null or p_payload->>'direction' not in ('up','down') then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    -- Renumber densely first so swaps stay well defined.
    update app_private.run_of_show_segments s set position=r.n
      from (select x.id,row_number() over(order by x.position,x.created_at,x.id)::integer n from app_private.run_of_show_segments x
        where x.term_id=p_term_id and x.archived_at is null) r
      where s.id=r.id and s.position<>r.n;
    select * into seg from app_private.run_of_show_segments where id=seg.id;
    select * into other from app_private.run_of_show_segments where term_id=p_term_id and archived_at is null
      and position=seg.position+case when p_payload->>'direction'='up' then -1 else 1 end;
    if other.id is not null then
      update app_private.run_of_show_segments set position=other.position,version=version+1,updated_by=actor,
        updated_at=statement_timestamp() where id=seg.id;
      update app_private.run_of_show_segments set position=seg.position,version=version+1,updated_by=actor,
        updated_at=statement_timestamp() where id=other.id;
    end if;
  elsif p_action='remove' then
    if st.current_segment_id=seg.id and st.phase in ('running','held') then
      raise exception using errcode='55000',message='command_run_of_show_live';
    end if;
    update app_private.run_of_show_segments set archived_at=statement_timestamp(),version=version+1,updated_by=actor,
      updated_at=statement_timestamp() where id=seg.id;
    if st.current_segment_id=seg.id then
      update app_private.run_of_show_state set current_segment_id=null,version=version+1,updated_by=actor,
        updated_at=statement_timestamp() where term_id=p_term_id;
    end if;
  elsif p_action='set_start' then
    v_text:=nullif(btrim(coalesce(p_payload->>'showStart','')),'');
    if v_text is not null and v_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode='22023',message='command_validation_failed';
    end if;
    update app_private.run_of_show_state set show_start=v_text::time,version=version+1,updated_by=actor,
      updated_at=statement_timestamp() where term_id=p_term_id;
  else
    update app_private.run_of_show_segments set status='planned',actual_start=null,actual_end=null,version=version+1,
        updated_by=actor,updated_at=statement_timestamp()
      where term_id=p_term_id and archived_at is null and (status<>'planned' or actual_start is not null or actual_end is not null);
    update app_private.run_of_show_state set phase='idle',current_segment_id=null,segment_started_at=null,held_at=null,held_s=0,
      delay_s=0,version=version+1,updated_by=actor,updated_at=statement_timestamp() where term_id=p_term_id;
  end if;
  return app_private.notification_receipt(p_term_id,'edit_run_of_show',p_request_id,payload,
    app_private.run_of_show_json(p_term_id));
end;
$$;

-- Start a segment now and measure the running delay against its planned start (Manila time of day).
create function app_private.run_of_show_start_segment(p_term_id uuid,p_segment uuid,p_actor uuid,p_now timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare planned time; diff integer;
begin
  update app_private.run_of_show_segments set status='live',actual_start=p_now,actual_end=null,version=version+1,
    updated_by=p_actor,updated_at=p_now where id=p_segment;
  select sc.planned_at into planned from app_private.run_of_show_schedule(p_term_id) sc where sc.segment_id=p_segment;
  if planned is not null then
    diff:=extract(epoch from ((p_now at time zone 'Asia/Manila')::time-planned))::integer;
    if diff>43200 then diff:=diff-86400; elsif diff<-43200 then diff:=diff+86400; end if;
  end if;
  update app_private.run_of_show_state set phase='running',current_segment_id=p_segment,segment_started_at=p_now,held_at=null,
    held_s=0,delay_s=coalesce(diff,delay_s) where term_id=p_term_id;
end;
$$;

-- Live controls: 'go' (start the first planned segment, or resume after a hold), 'hold', 'next'
-- (finish the current segment and start the next planned one), 'plus'/'minus' (running delay +-60 s),
-- 'skip' (mark the next planned segment skipped). p_expected_version is the state version the
-- caller saw; a mismatch is a stale press and changes nothing.
create function public.control_run_of_show(p_term_id uuid,p_action text,p_expected_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; receipt jsonb; payload jsonb; st app_private.run_of_show_state; now_at timestamptz:=statement_timestamp();
  current_seg app_private.run_of_show_segments; next_id uuid;
begin
  actor:=app_private.run_of_show_writer(p_term_id);
  if p_request_id is null or p_action is null or p_action not in ('go','hold','next','plus','minus','skip')
    or p_expected_version is null then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  payload:=jsonb_build_array(p_term_id,p_action,p_expected_version);
  receipt:=app_private.begin_work_command('control_run_of_show',p_request_id,payload);
  if receipt is not null then return receipt; end if;
  st:=app_private.run_of_show_lock(p_term_id);
  if st.version<>p_expected_version then raise exception using errcode='40001',message='command_stale_version'; end if;
  if st.current_segment_id is not null then
    select * into current_seg from app_private.run_of_show_segments where id=st.current_segment_id and archived_at is null;
  end if;
  -- The first planned segment after the current one (or from the top when nothing is live).
  select s.id into next_id from app_private.run_of_show_segments s
    where s.term_id=p_term_id and s.archived_at is null and s.status='planned'
      and (current_seg.id is null or (s.position,s.created_at,s.id)>(current_seg.position,current_seg.created_at,current_seg.id))
    order by s.position,s.created_at,s.id limit 1;

  if p_action='go' then
    if st.phase='held' and current_seg.id is not null then
      update app_private.run_of_show_state set phase='running',
        held_s=least(864000,held_s+greatest(0,extract(epoch from now_at-held_at)::integer)),held_at=null where term_id=p_term_id;
    elsif st.phase in ('idle','finished') or current_seg.id is null then
      if next_id is null then raise exception using errcode='55000',message='command_run_of_show_empty'; end if;
      perform app_private.run_of_show_start_segment(p_term_id,next_id,actor,now_at);
    end if;
  elsif p_action='hold' then
    if st.phase='running' then
      update app_private.run_of_show_state set phase='held',held_at=now_at where term_id=p_term_id;
    end if;
  elsif p_action='next' then
    if current_seg.id is not null and current_seg.status='live' then
      update app_private.run_of_show_segments set status='done',actual_end=now_at,version=version+1,updated_by=actor,
        updated_at=now_at where id=current_seg.id;
    end if;
    if next_id is null then
      update app_private.run_of_show_state set phase='finished',current_segment_id=null,segment_started_at=null,held_at=null,
        held_s=0 where term_id=p_term_id;
    else
      perform app_private.run_of_show_start_segment(p_term_id,next_id,actor,now_at);
    end if;
  elsif p_action in ('plus','minus') then
    update app_private.run_of_show_state set delay_s=greatest(-43200,least(43200,delay_s+case p_action when 'plus' then 60 else -60 end))
      where term_id=p_term_id;
  else
    if next_id is null then raise exception using errcode='55000',message='command_run_of_show_empty'; end if;
    update app_private.run_of_show_segments set status='skipped',version=version+1,updated_by=actor,updated_at=now_at
      where id=next_id;
  end if;
  update app_private.run_of_show_state set version=version+1,updated_by=actor,updated_at=now_at where term_id=p_term_id;
  return app_private.notification_receipt(p_term_id,'control_run_of_show',p_request_id,payload,
    app_private.run_of_show_json(p_term_id));
end;
$$;

revoke all on function app_private.run_of_show_reader(uuid),app_private.run_of_show_editor(uuid),
  app_private.run_of_show_schedule(uuid),app_private.run_of_show_json(uuid),app_private.run_of_show_lock(uuid),
  app_private.run_of_show_writer(uuid),app_private.run_of_show_start_segment(uuid,uuid,uuid,timestamptz),
  public.read_run_of_show(uuid),public.edit_run_of_show(uuid,text,jsonb,uuid),
  public.control_run_of_show(uuid,text,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_run_of_show(uuid),public.edit_run_of_show(uuid,text,jsonb,uuid),
  public.control_run_of_show(uuid,text,integer,uuid) to authenticated;

commit;
