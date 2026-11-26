-- Event-day crew check-in. An admin creates (and rotates) one secret link per term; the door QR
-- encodes it. Each rotation starts a fresh check-in list (a new generation), so a dry run and the
-- event day can each have their own roll. Core members check themselves in with the link; PMs and
-- admins see who has not arrived. Tables are private (RLS forced, no grants); RPCs only.
begin;

create table app_private.crew_checkin_tokens (
  term_id uuid primary key references public.terms(id),
  token text not null unique check(token ~ '^[0-9a-f]{64}$'),
  generation integer not null default 1 check(generation>0),
  rotated_at timestamptz not null default statement_timestamp(),
  rotated_by uuid not null references public.term_memberships(id)
);
create index crew_checkin_tokens_rotated_by on app_private.crew_checkin_tokens(rotated_by);

create table app_private.crew_checkins (
  term_id uuid not null references public.terms(id),
  generation integer not null check(generation>0),
  term_membership_id uuid not null references public.term_memberships(id),
  checked_in_at timestamptz not null default statement_timestamp(),
  primary key(term_id,generation,term_membership_id)
);
create index crew_checkins_membership on app_private.crew_checkins(term_membership_id);

do $$
declare relation text;
begin
  foreach relation in array array['crew_checkin_tokens','crew_checkins'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

create function app_private.crew_checkin_manager(p_term_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_term_id is not null and (public.has_capability(p_term_id,'admin.configure') or public.has_capability(p_term_id,'roles.manage'));
$$;

-- Admins and PMs: the current door link token (null until one is created).
create function public.read_crew_checkin_link(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t app_private.crew_checkin_tokens;
begin
  if not app_private.crew_checkin_manager(p_term_id) then
    raise exception using errcode='42501',message='command_permission_denied';
  end if;
  select * into t from app_private.crew_checkin_tokens where term_id=p_term_id;
  return jsonb_build_object('token',t.token,'generation',t.generation,'rotatedAt',t.rotated_at,
    'canRotate',public.has_capability(p_term_id,'admin.configure'));
end;
$$;

-- Admins only: create or replace the door link. The old link stops working immediately.
create function public.rotate_crew_checkin_token(p_term_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; payload jsonb; receipt jsonb; fresh text; t app_private.crew_checkin_tokens;
begin
  actor:=case when p_term_id is null then null else public.current_term_membership(p_term_id) end;
  if actor is null or not public.has_capability(p_term_id,'admin.configure')
    or not exists(select 1 from public.terms x where x.id=p_term_id and x.state='active') then
    raise exception using errcode='42501',message='command_permission_denied';
  end if;
  if p_request_id is null then raise exception using errcode='22023',message='command_validation_failed'; end if;
  payload:=jsonb_build_array(p_term_id);
  receipt:=app_private.begin_work_command('rotate_crew_checkin_token',p_request_id,payload);
  if receipt is not null then return receipt; end if;
  perform pg_advisory_xact_lock(hashtextextended('crew-checkin:'||p_term_id::text,0));
  fresh:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into app_private.crew_checkin_tokens as c(term_id,token,rotated_by) values(p_term_id,fresh,actor)
    on conflict(term_id) do update set token=excluded.token,generation=c.generation+1,rotated_at=statement_timestamp(),
      rotated_by=excluded.rotated_by
    returning * into t;
  return app_private.notification_receipt(p_term_id,'rotate_crew_checkin_token',p_request_id,payload,
    jsonb_build_object('token',t.token,'generation',t.generation,'rotatedAt',t.rotated_at,'canRotate',true));
end;
$$;

-- Any core member of the link's term checks themselves in. Safe to repeat: the first time is kept.
create function public.check_in(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t app_private.crew_checkin_tokens; m uuid; at_time timestamptz; first boolean; who text; term_label text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='command_checkin_link_invalid';
  end if;
  select * into t from app_private.crew_checkin_tokens where token=p_token;
  if t.term_id is null then raise exception using errcode='22023',message='command_checkin_link_invalid'; end if;
  m:=public.current_term_membership(t.term_id);
  if m is null then raise exception using errcode='42501',message='command_permission_denied'; end if;
  insert into app_private.crew_checkins(term_id,generation,term_membership_id) values(t.term_id,t.generation,m)
    on conflict do nothing;
  first:=found;
  select c.checked_in_at into at_time from app_private.crew_checkins c
    where c.term_id=t.term_id and c.generation=t.generation and c.term_membership_id=m;
  select p.display_name into who from public.term_memberships tm join public.members p on p.id=tm.member_id where tm.id=m;
  select x.label into term_label from public.terms x where x.id=t.term_id;
  return jsonb_build_object('checkedInAt',at_time,'already',not first,'name',who,'termLabel',term_label);
end;
$$;

-- Admins and PMs: everyone on the core roster for the current check-in list, with their committee.
create function public.read_checkins(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t app_private.crew_checkin_tokens; people jsonb;
begin
  if not app_private.crew_checkin_manager(p_term_id) then
    raise exception using errcode='42501',message='command_permission_denied';
  end if;
  select * into t from app_private.crew_checkin_tokens where term_id=p_term_id;
  select coalesce(jsonb_agg(jsonb_build_object('membershipId',r.id,'name',r.display_name,'committee',r.unit_name,
      'committeeCode',r.unit_code,'checkedInAt',r.checked_in_at) order by r.unit_name nulls last,r.display_name,r.id),'[]'::jsonb)
    into people
  from (select tm.id,p.display_name,u.name unit_name,u.code unit_code,c.checked_in_at
    from public.term_memberships tm join public.members p on p.id=tm.member_id
    left join lateral (select x.name,x.code from public.unit_memberships d join public.org_units x on x.id=d.unit_id and x.archived_at is null
        where d.term_membership_id=tm.id and d.term_id=p_term_id and d.status='active'
          and d.effective_from<=statement_timestamp() and d.effective_to>statement_timestamp()
        order by case d.deployment_type when 'head' then 0 else 1 end,d.effective_from,d.id limit 1) u on true
    left join app_private.crew_checkins c on c.term_id=p_term_id and c.generation=t.generation and c.term_membership_id=tm.id
    where tm.term_id=p_term_id and tm.membership_kind='core' and tm.status='active'
      and tm.joined_at<=statement_timestamp() and tm.ends_at>statement_timestamp()
      and p.account_state in ('invited','active')) r;
  return jsonb_build_object('generation',t.generation,'rotatedAt',t.rotated_at,'people',people);
end;
$$;

revoke all on function app_private.crew_checkin_manager(uuid),public.read_crew_checkin_link(uuid),
  public.rotate_crew_checkin_token(uuid,uuid),public.check_in(text),public.read_checkins(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_crew_checkin_link(uuid),public.rotate_crew_checkin_token(uuid,uuid),
  public.check_in(text),public.read_checkins(uuid) to authenticated;

commit;
