-- Onboarding state for the workspace app: install, tutorial progress and last activity per core
-- membership, roster metadata (wave, invited time) and in-app nudges. Every table is private
-- (RLS forced, no grants); clients reach them only through the RPCs below.
begin;

create table app_private.member_client_state (
  term_membership_id uuid primary key references public.term_memberships(id),
  installed_at timestamptz check(installed_at is null or isfinite(installed_at)),
  tutorial_step integer not null default 0 check(tutorial_step between 0 and 100),
  tutorial_done_at timestamptz check(tutorial_done_at is null or isfinite(tutorial_done_at)),
  tutorial_version integer not null default 0 check(tutorial_version between 0 and 1000),
  last_active_at timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

-- Wave is descriptive roster metadata only. It is never an authorization input.
create table app_private.member_roster_meta (
  term_membership_id uuid primary key references public.term_memberships(id),
  wave text check(wave in ('wave1','wave1_5','core')),
  invited_at timestamptz not null default statement_timestamp(),
  invited_by uuid references public.term_memberships(id)
);
create index member_roster_meta_invited_by on app_private.member_roster_meta(invited_by);

create table app_private.member_nudges (
  id uuid primary key default gen_random_uuid(),
  term_membership_id uuid not null references public.term_memberships(id),
  kind text not null check(kind in ('sign_in','install','tutorial','reminders')),
  nudged_on date not null,
  created_by uuid not null references public.term_memberships(id),
  created_at timestamptz not null default statement_timestamp(),
  unique(term_membership_id,kind,nudged_on)
);
create index member_nudges_created_by on app_private.member_nudges(created_by);

do $$
declare relation text;
begin
  foreach relation in array array['member_client_state','member_roster_meta','member_nudges'] loop
    execute format('alter table app_private.%I enable row level security',relation);
    execute format('alter table app_private.%I force row level security',relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

-- The caller's current core membership, preferring the active term. No capability is required:
-- a newly added member may not hold a seat yet and still needs the tutorial.
create function app_private.client_state_actor() returns public.term_memberships
language plpgsql stable security definer set search_path='' as $$
declare m public.term_memberships;
begin
  select tm.* into m from public.members p join public.term_memberships tm on tm.member_id=p.id
    join public.terms t on t.id=tm.term_id
  where p.auth_user_id=(select auth.uid()) and tm.membership_kind='core' and tm.id=public.current_term_membership(tm.term_id)
  order by (t.state='active') desc,t.starts_on desc,tm.id limit 1;
  if m.id is null then raise exception using errcode='42501',message='command_permission_denied'; end if;
  return m;
end;
$$;

-- Reminders count as on when notifications are not muted and at least one outside channel is live.
create function app_private.member_reminders_on(p_membership uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.notification_preferences np where np.membership_id=p_membership and np.mode='mute')
    and (exists(select 1 from app_private.email_digest_preferences pr where pr.membership_id=p_membership
        and pr.opted_at is not null and pr.email_hash is not null and pr.email_hash is distinct from pr.bounced_hash)
      or exists(select 1 from app_private.telegram_links l where l.membership_id=p_membership and l.state='linked'));
$$;

-- A nudge stays relevant only while its condition is still unmet.
create function app_private.member_nudge_open(p_membership uuid,p_kind text) returns boolean
language sql stable security definer set search_path='' as $$
  select case p_kind
    when 'sign_in' then exists(select 1 from public.term_memberships tm join public.members m on m.id=tm.member_id
      where tm.id=p_membership and (m.auth_user_id is null or m.account_state='invited'))
    when 'install' then not exists(select 1 from app_private.member_client_state s
      where s.term_membership_id=p_membership and s.installed_at is not null)
    when 'tutorial' then not exists(select 1 from app_private.member_client_state s
      where s.term_membership_id=p_membership and s.tutorial_done_at is not null)
    when 'reminders' then not app_private.member_reminders_on(p_membership)
    else false end;
$$;

create function app_private.client_state_json(p_membership uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('installed',coalesce(s.installed_at is not null,false),'tutorialStep',coalesce(s.tutorial_step,0),
    'tutorialDone',coalesce(s.tutorial_done_at is not null,false),'tutorialVersion',coalesce(s.tutorial_version,0),
    'nudge',(select n.kind from app_private.member_nudges n where n.term_membership_id=p_membership and n.kind<>'sign_in'
      and n.created_at>statement_timestamp()-interval '7 days' and app_private.member_nudge_open(p_membership,n.kind)
      order by n.created_at desc,n.id limit 1))
  from (select 1) one left join app_private.member_client_state s on s.term_membership_id=p_membership;
$$;

create function public.read_client_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.term_memberships;
begin
  m:=app_private.client_state_actor();
  return app_private.client_state_json(m.id);
end;
$$;

create function public.record_client_state(p_installed boolean default null,p_tutorial_step integer default null,
  p_tutorial_done boolean default null,p_tutorial_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.term_memberships; now_at timestamptz:=statement_timestamp();
begin
  m:=app_private.client_state_actor();
  if (p_tutorial_step is not null and p_tutorial_step not between 0 and 100)
    or (p_tutorial_version is not null and p_tutorial_version not between 0 and 1000) then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  insert into app_private.member_client_state as s(term_membership_id,installed_at,tutorial_step,tutorial_done_at,tutorial_version,
      last_active_at,updated_at)
    values(m.id,case when p_installed then now_at end,coalesce(p_tutorial_step,0),case when p_tutorial_done then now_at end,
      coalesce(p_tutorial_version,0),now_at,now_at)
    on conflict(term_membership_id) do update set
      installed_at=case when p_installed is null then s.installed_at when p_installed then coalesce(s.installed_at,now_at) end,
      tutorial_step=coalesce(p_tutorial_step,s.tutorial_step),
      tutorial_done_at=case when p_tutorial_done is null then s.tutorial_done_at when p_tutorial_done then coalesce(s.tutorial_done_at,now_at) end,
      tutorial_version=coalesce(p_tutorial_version,s.tutorial_version),
      last_active_at=now_at,updated_at=now_at;
  return app_private.client_state_json(m.id);
end;
$$;

-- Roster managers hold roles.manage or admin.configure for the term.
create function app_private.roster_manager(p_term uuid,p_write boolean) returns public.term_memberships
language plpgsql stable security definer set search_path='' as $$
declare m public.term_memberships;
begin
  m:=app_private.request_actor(p_term,p_write);
  if not (public.has_capability(p_term,'roles.manage') or public.has_capability(p_term,'admin.configure'))
    or app_private.disposition_replay_required(p_term) then
    raise exception using errcode='42501',message='command_permission_denied';
  end if;
  return m;
end;
$$;

create function public.read_team_setup(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare people jsonb; open_positions jsonb;
begin
  perform app_private.roster_manager(p_term_id,false);
  with roster as materialized(
    select tm.id membership_id,m.id member_id,m.display_name,m.normalized_email,m.account_state,m.auth_user_id,tm.created_at
    from public.term_memberships tm join public.members m on m.id=tm.member_id
    where tm.term_id=p_term_id and tm.membership_kind='core' and tm.status in ('active','pending')),
  seat as(
    select distinct on (s.membership_id) s.membership_id,r.code role_code,r.name role_name,u.code unit_code,u.name unit_name
    from app_private.tedx_seats s join app_private.tedx_positions p on p.role_id=s.role_id join public.roles r on r.id=s.role_id
      left join public.org_units u on u.id=p.unit_id
    where s.term_id=p_term_id and not s.revoked and s.ends_at>statement_timestamp()
    order by s.membership_id,case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end,s.starts_at,s.id),
  unit as(
    select distinct on (d.term_membership_id) d.term_membership_id membership_id,u.code unit_code,u.name unit_name
    from public.unit_memberships d join public.org_units u on u.id=d.unit_id and u.archived_at is null
    where d.term_id=p_term_id and d.status='active' and d.effective_to>statement_timestamp()
    order by d.term_membership_id,case d.deployment_type when 'head' then 0 else 1 end,d.effective_from,d.id),
  rows as(
    select r.*,coalesce(seat.unit_code,unit.unit_code) committee_code,coalesce(seat.unit_name,unit.unit_name) committee,
      seat.role_name position,meta.wave,coalesce(meta.invited_at,r.created_at) invited_at,
      r.auth_user_id is not null and r.account_state='active' signed_in,u.last_sign_in_at,cs.last_active_at,
      cs.installed_at is not null installed,cs.tutorial_done_at is not null tutorial_done,coalesce(cs.tutorial_step,0) tutorial_step,
      app_private.member_reminders_on(r.membership_id) reminders_on,
      exists(select 1 from app_private.telegram_links l where l.membership_id=r.membership_id and l.state='linked') telegram_linked
    from roster r left join seat on seat.membership_id=r.membership_id left join unit on unit.membership_id=r.membership_id
      left join app_private.member_roster_meta meta on meta.term_membership_id=r.membership_id
      left join app_private.member_client_state cs on cs.term_membership_id=r.membership_id
      left join auth.users u on u.id=r.auth_user_id)
  select jsonb_build_object(
    'list',coalesce(jsonb_agg(jsonb_build_object('membershipId',membership_id,'memberId',member_id,'name',display_name,
      'email',normalized_email,'committee',committee,'committeeCode',committee_code,'position',position,'wave',wave,
      'accountState',account_state,'signedIn',signed_in,'lastSignInAt',last_sign_in_at,'lastActiveAt',last_active_at,
      'installed',installed,'tutorialDone',tutorial_done,'tutorialStep',tutorial_step,'remindersOn',reminders_on,
      'telegramLinked',telegram_linked,'invitedAt',invited_at) order by committee nulls last,display_name,membership_id),'[]'::jsonb),
    'totals',jsonb_build_object('people',count(*),'signedIn',count(*) filter(where signed_in),
      'installed',count(*) filter(where installed),'tutorialDone',count(*) filter(where tutorial_done),
      'remindersOn',count(*) filter(where reminders_on),'neverOpened',count(*) filter(where last_active_at is null)))
  into people from rows;
  select coalesce(jsonb_agg(jsonb_build_object('roleCode',r.code,'roleName',r.name,'committee',u.name,'committeeCode',u.code)
      order by case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end,u.name nulls first,r.name),'[]'::jsonb)
    into open_positions
  from app_private.tedx_positions p join public.roles r on r.id=p.role_id and r.state='active'
    left join public.org_units u on u.id=p.unit_id
  where p.term_id=p_term_id and (p.unit_id is null or u.archived_at is null)
    and not exists(select 1 from app_private.tedx_seats s where s.role_id=p.role_id and s.term_id=p_term_id and not s.revoked
      and s.ends_at>statement_timestamp());
  return jsonb_build_object('people',people->'list','openPositions',open_positions,'totals',people->'totals');
end;
$$;

revoke all on function app_private.client_state_actor(),app_private.member_reminders_on(uuid),
  app_private.member_nudge_open(uuid,text),app_private.client_state_json(uuid),app_private.roster_manager(uuid,boolean),
  public.read_client_state(),public.record_client_state(boolean,integer,boolean,integer),public.read_team_setup(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_client_state(),public.record_client_state(boolean,integer,boolean,integer),
  public.read_team_setup(uuid) to authenticated;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'term',array[id_column],
  format('select app_private.disposition_key(%L,array[x.%I::text]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.%I x
    join public.term_memberships m on m.id=x.term_membership_id where m.term_id=$1',
    'app_private.'||source,id_column,category,category,source),
  app_private.disposition_structure('app_private.'||source),false
from (values
  ('member_client_state','privacy','term_membership_id'),
  ('member_roster_meta','privacy','term_membership_id'),
  ('member_nudges','privacy','id')
) definitions(source,category,id_column);

commit;
