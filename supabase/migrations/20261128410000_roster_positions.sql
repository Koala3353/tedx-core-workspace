-- Roster positions for Team setup and Admin > Roles & access.
-- 1. Every position is offered, not only unheld ones: leadership and head positions can have
--    several holders (3 PMs, several heads per committee). read_team_setup keeps its signature and
--    keys; openPositions now lists all positions with holder counts, and people rows gain the
--    current position code and tier. read_roster_positions is the standalone list.
-- 2. set_member_position gives, changes or removes a member's position, including members who
--    were invited but have not signed in yet (account_state 'invited', no auth user). The grants it
--    creates stay inactive until the person signs in (access_base_live still requires an active,
--    verified account), so nothing is unlocked early. Same rule as add_roster_members: admin,
--    leadership and head positions need a full admin (admin.configure and roles.manage).
-- Additive only: new functions plus a same-signature replacement of read_team_setup.
begin;

create function public.read_roster_positions(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare full_admin boolean;
begin
  perform app_private.roster_manager(p_term_id, false);
  full_admin := app_private.full_admin(p_term_id);
  return jsonb_build_object('canAssignAll', full_admin, 'positions', coalesce((
    select jsonb_agg(jsonb_build_object('roleId', p.role_id, 'roleCode', r.code, 'roleName', r.name,
        'committee', u.name, 'committeeCode', u.code, 'tier', p.tier, 'administrator', p.administrator,
        'holders', (select count(distinct s.membership_id) from app_private.tedx_seats s
          where s.role_id = p.role_id and s.term_id = p_term_id and not s.revoked and s.ends_at > statement_timestamp()),
        'allowed', full_admin or (p.tier = 'core' and not p.administrator))
      order by case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end, u.name nulls first, r.name)
    from app_private.tedx_positions p join public.roles r on r.id = p.role_id and r.state = 'active'
      left join public.org_units u on u.id = p.unit_id
    where p.term_id = p_term_id and (p.unit_id is null or u.archived_at is null)
  ), '[]'::jsonb));
end;
$$;

-- Same signature and keys as 20261127100000_member_client_state.sql. openPositions now holds every
-- position (with tier, holders, allowed, open); each person also carries positionCode and positionTier.
create or replace function public.read_team_setup(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare people jsonb; positions jsonb;
begin
  perform app_private.roster_manager(p_term_id,false);
  with roster as materialized(
    select tm.id membership_id,m.id member_id,m.display_name,m.normalized_email,m.account_state,m.auth_user_id,tm.created_at
    from public.term_memberships tm join public.members m on m.id=tm.member_id
    where tm.term_id=p_term_id and tm.membership_kind='core' and tm.status in ('active','pending')),
  seat as(
    select distinct on (s.membership_id) s.membership_id,r.code role_code,r.name role_name,p.tier,u.code unit_code,u.name unit_name
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
      seat.role_name position,seat.role_code position_code,seat.tier position_tier,meta.wave,coalesce(meta.invited_at,r.created_at) invited_at,
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
      'email',normalized_email,'committee',committee,'committeeCode',committee_code,'position',position,
      'positionCode',position_code,'positionTier',position_tier,'wave',wave,
      'accountState',account_state,'signedIn',signed_in,'lastSignInAt',last_sign_in_at,'lastActiveAt',last_active_at,
      'installed',installed,'tutorialDone',tutorial_done,'tutorialStep',tutorial_step,'remindersOn',reminders_on,
      'telegramLinked',telegram_linked,'invitedAt',invited_at) order by committee nulls last,display_name,membership_id),'[]'::jsonb),
    'totals',jsonb_build_object('people',count(*),'signedIn',count(*) filter(where signed_in),
      'installed',count(*) filter(where installed),'tutorialDone',count(*) filter(where tutorial_done),
      'remindersOn',count(*) filter(where reminders_on),'neverOpened',count(*) filter(where last_active_at is null)))
  into people from rows;
  positions := public.read_roster_positions(p_term_id);
  return jsonb_build_object('people',people->'list','totals',people->'totals','canAssignAll',positions->'canAssignAll',
    'openPositions',coalesce((select jsonb_agg(x||jsonb_build_object('open',(x->>'holders')::int=0) order by o)
      from jsonb_array_elements(positions->'positions') with ordinality e(x,o)),'[]'::jsonb));
end;
$$;

-- Give, change or remove (p_role_code null) a member's main position. The main position is the
-- same one read_team_setup shows: leadership first, then head, then core.
create function public.set_member_position(p_term_id uuid, p_membership_id uuid, p_role_code text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.term_memberships; target public.term_memberships; full_admin boolean; payload jsonb; receipt jsonb;
  wanted text := nullif(lower(btrim(p_role_code)), '');
  position app_private.tedx_positions; old_position app_private.tedx_positions;
  previous app_private.tedx_seats; seat app_private.tedx_seats; starts timestamptz; result jsonb;
begin
  perform app_private.readiness_lock(p_term_id);
  actor := app_private.roster_manager(p_term_id, true);
  if p_request_id is null or p_membership_id is null or length(coalesce(wanted, '')) > 100 then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  payload := jsonb_build_array(p_term_id, p_membership_id, wanted);
  receipt := app_private.begin_work_command('set_member_position', p_request_id, payload);
  if receipt is not null then return receipt; end if;
  full_admin := app_private.full_admin(p_term_id);

  -- Invited members (no sign-in yet) qualify: a position only needs an active core term membership.
  select tm.* into target from public.term_memberships tm join public.members m on m.id = tm.member_id
    where tm.id = p_membership_id and tm.term_id = p_term_id and tm.membership_kind = 'core'
      and tm.status = 'active' and tm.ends_at > statement_timestamp() and m.account_state in ('active', 'invited')
      and m.normalized_email ~ '^[^[:space:]@]+@student[.]ateneo[.]edu$'
    for update of tm;
  if target.id is null then raise exception using errcode = '22023', message = 'member_not_on_roster'; end if;

  if wanted is not null then
    select p.* into position from app_private.tedx_positions p join public.roles r on r.id = p.role_id and r.state = 'active'
      left join public.org_units u on u.id = p.unit_id
      where p.term_id = p_term_id and r.code = wanted and (p.unit_id is null or u.archived_at is null);
    if position.role_id is null then raise exception using errcode = '22023', message = 'unknown_role'; end if;
  end if;

  select s.* into previous from app_private.tedx_seats s join app_private.tedx_positions p on p.role_id = s.role_id
    where s.term_id = p_term_id and s.membership_id = target.id and not s.revoked and s.ends_at > statement_timestamp()
    order by case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end, s.starts_at, s.id
    limit 1 for update of s;
  if previous.id is not null then
    select * into old_position from app_private.tedx_positions where role_id = previous.role_id;
  end if;

  -- Same bar as add_roster_members, applied to both the old and the new position.
  if not full_admin and ((position.role_id is not null and (position.administrator or position.tier <> 'core'))
      or (old_position.role_id is not null and (old_position.administrator or old_position.tier <> 'core'))) then
    raise exception using errcode = '42501', message = 'role_not_allowed';
  end if;
  if target.id = actor.id and (coalesce(position.administrator, false) or coalesce(old_position.administrator, false)) then
    raise exception using errcode = '42501', message = 'command_permission_denied';
  end if;

  if previous.role_id is not distinct from position.role_id then
    result := jsonb_build_object('membershipId', target.id, 'roleCode', wanted, 'seatId', previous.id, 'changed', false);
    return app_private.notification_receipt(p_term_id, 'set_member_position', p_request_id, payload, result);
  end if;

  if position.role_id is not null and exists (select 1 from app_private.tedx_seats s
      where s.term_id = p_term_id and s.membership_id = target.id and s.role_id = position.role_id
        and not s.revoked and s.ends_at > statement_timestamp() and s.id is distinct from previous.id) then
    raise exception using errcode = '23505', message = 'command_position_overlap';
  end if;

  -- Leaving a committee with open work there is blocked, as in save_tedx_seat. Moving between
  -- positions of the same committee keeps the person in it, so that is not checked.
  -- Leadership seats (no unit) are checked against all of the person's open work, as in save_tedx_seat.
  if previous.id is not null
      and (position.role_id is null or position.unit_id is distinct from old_position.unit_id) then
    if exists (
      select 1 from app_private.organization_obligations(p_term_id, null, previous.membership_id) w
        where old_position.unit_id is null or old_position.unit_id = w.lead_unit_id
          or exists (select 1 from public.tasks t where t.work_item_id = w.id and t.assigned_unit_id = old_position.unit_id)
          or exists (select 1 from public.requests r where r.work_item_id = w.id and r.receiving_unit_id = old_position.unit_id)
    ) or exists (
      select 1 from public.request_types rt where rt.term_id = p_term_id and rt.live_enabled and rt.archived_at is null
        and rt.receiving_unit_id = old_position.unit_id and previous.membership_id in (rt.primary_contact_id, rt.backup_contact_id)
    ) then
      raise exception using errcode = '55000', message = 'command_dependency_blocked';
    end if;
  end if;

  starts := greatest(statement_timestamp(), target.joined_at);
  if previous.id is not null then
    update public.role_assignments a set status = 'revoked'
      from app_private.tedx_seat_grants g where g.seat_id = previous.id and a.id = g.grant_id and a.status = 'active';
    update public.unit_memberships set status = 'revoked' where id = previous.deployment_id;
  end if;
  if previous.id is null then
    insert into app_private.tedx_seats(term_id, membership_id, role_id, starts_at, ends_at)
      values (p_term_id, target.id, position.role_id, starts, target.ends_at) returning * into seat;
    seat := app_private.tedx_materialize_seat(seat, position, actor);
  elsif position.role_id is null then
    update app_private.tedx_seats set revoked = true, version = version + 1 where id = previous.id returning * into seat;
  else
    update app_private.tedx_seats set role_id = position.role_id, deployment_id = null, starts_at = starts,
      ends_at = target.ends_at, version = version + 1 where id = previous.id returning * into seat;
    seat := app_private.tedx_materialize_seat(seat, position, actor);
  end if;
  insert into app_private.tedx_seat_history(seat_id, version, actor_id, reason, before_value, after_value)
    values (seat.id, seat.version, actor.id, 'Position changed in Team setup',
      case when previous.id is not null then to_jsonb(previous) end, to_jsonb(seat));
  result := jsonb_build_object('membershipId', target.id, 'roleCode', wanted, 'seatId', seat.id, 'changed', true);
  return app_private.notification_receipt(p_term_id, 'set_member_position', p_request_id, payload, result);
end;
$$;

revoke all on function public.read_roster_positions(uuid), public.read_team_setup(uuid),
  public.set_member_position(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_roster_positions(uuid), public.read_team_setup(uuid),
  public.set_member_position(uuid, uuid, text, uuid) to authenticated;

commit;
