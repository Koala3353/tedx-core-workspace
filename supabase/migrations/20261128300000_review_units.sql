-- Review routing for the TEDx committee roster (owner decision, 2026-11-26).
--  * Adds two review-service units, MCD and PRISM, with head and core positions that follow the
--    committee roster pattern (roles, app_private.tedx_positions, base role_permissions).
--  * Additive review capabilities: every committee head reviews general requests for their own
--    committee (department.review), FIN members review FIN cases (finance.review), MCD members review
--    publicity (mcd.review) and PRISM members review feedback (feedback.review). Existing permissions
--    are never removed.
--  * FIN becomes a review service and the seeded FIN and MCD request types are bound to those units.
--  * Existing live seats get any newly needed scope assignment, starting now (never backdated). A scope
--    an admin revoked for that seat is not recreated.
--    The seat machinery creates one assignment per distinct allowed_scope; future seats pick the new permissions up automatically
--    because app_private.tedx_materialize_seat reads role_permissions at seat time.
--  * app_private.single_admin_actions keeps who/when for the single-admin commands added later.
begin;

create table app_private.single_admin_actions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  actor_membership_id uuid references public.term_memberships(id),
  actor_user_id uuid,
  action text not null check (action in (
    'review_units_setup', 'service_opened', 'service_closed', 'publisher_allowed', 'publisher_stopped',
    'finance_privacy_recorded', 'readiness_default_policy'
  )),
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  reason text not null default '' check (length(reason) <= 2000),
  recorded_at timestamptz not null default statement_timestamp()
);
create index single_admin_actions_term_idx on app_private.single_admin_actions(term_id, recorded_at desc);
alter table app_private.single_admin_actions enable row level security;
alter table app_private.single_admin_actions force row level security;
revoke all on app_private.single_admin_actions from public, anon, authenticated, service_role;

-- A full admin holds both admin.configure and roles.manage (the PM and VP HRTD presets, WebDev head).
create function app_private.full_admin(p_term uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.has_capability(p_term, 'admin.configure') and public.has_capability(p_term, 'roles.manage'), false)
$$;
revoke all on function app_private.full_admin(uuid) from public, anon, authenticated, service_role;

create function app_private.tedx_review_setup(p_term uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  term_row public.terms;
  unit_def record;
  unit uuid;
  tier text;
  role uuid;
  added_permissions integer := 0;
  added_grants integer := 0;
  n integer;
  seat record;
  scope record;
  grantor uuid;
  new_grant uuid;
begin
  select * into term_row from public.terms where id = p_term;
  if not found then return null; end if;
  perform app_private.readiness_lock(p_term);

  -- 1. Review-service units with roster positions.
  for unit_def in select * from (values
    ('MCD', 'Marketing & Communications (MCD)', 'MCD'), ('PRISM', 'PRISM', 'PRISM')
  ) v(code, name, label) loop
    insert into public.org_units(organization_id, term_id, code, name, delivery_committee, review_service)
      values (term_row.organization_id, p_term, unit_def.code, unit_def.name, false, true)
      on conflict (term_id, code) do nothing;
    select id into unit from public.org_units where term_id = p_term and code = unit_def.code;
    update public.org_units set review_service = true where id = unit and not review_service and archived_at is null;
    begin perform app_private.organization_alias(p_term, unit_def.code, unit); exception when invalid_parameter_value then null; end;
    begin perform app_private.organization_alias(p_term, unit_def.name, unit); exception when invalid_parameter_value then null; end;
    foreach tier in array array['head', 'core'] loop
      role := null;
      insert into public.roles(organization_id, term_id, code, name, privileged)
        values (term_row.organization_id, p_term, 'tedx_' || lower(unit_def.code) || '_' || tier, unit_def.label || ' ' || initcap(tier), tier = 'head')
        on conflict (term_id, code) do nothing returning id into role;
      if role is null then continue; end if;
      insert into app_private.tedx_positions values (p_term, role, unit, tier, false) on conflict do nothing;
      insert into public.role_permissions(organization_id, term_id, role_id, capability, allowed_scope)
        select term_row.organization_id, p_term, role, p.capability, p.scope
        from (values ('workspace.read','term'), ('directory.read','term'), ('profile.edit_own','own'), ('committee.manage','unit')) p(capability, scope)
        where p.scope <> 'unit' or tier = 'head'
        on conflict (role_id, capability, allowed_scope) do nothing;
    end loop;
  end loop;

  -- 2. FIN receives FIN cases, so it must be a review service.
  update public.org_units set review_service = true
    where term_id = p_term and code = 'FIN' and archived_at is null and not review_service;

  -- 3. Additive review capabilities for roster positions. Roles published through Roles & access
  --    (access_role_versions) are immutable and are left alone.
  insert into public.role_permissions(organization_id, term_id, role_id, capability, allowed_scope)
    select r.organization_id, r.term_id, r.id, x.capability, 'unit'
    from app_private.tedx_positions p
    join public.roles r on r.id = p.role_id
    join public.org_units u on u.id = p.unit_id
    cross join lateral (
      select 'department.review'::text as capability where p.tier = 'head'
      union all select 'finance.review' where u.code = 'FIN'
      union all select 'mcd.review' where u.code = 'MCD'
      union all select 'feedback.review' where u.code = 'PRISM'
    ) x
    where p.term_id = p_term and p.tier in ('head', 'core')
      and not exists (select 1 from public.access_role_versions v where v.role_id = r.id)
    on conflict (role_id, capability, allowed_scope) do nothing;
  get diagnostics added_permissions = row_count;

  -- 4. Bind the protected request services to their units while nothing has been submitted.
  update public.request_types t set receiving_unit_id = u.id
    from public.org_units u
    where t.term_id = p_term and t.archived_at is null and t.receiving_unit_id is null
      and u.term_id = p_term and u.archived_at is null
      and u.code = case t.governed_kind when 'fin' then 'FIN' when 'mcd' then 'MCD' end
      and not exists (select 1 from public.requests r where r.request_type_id = t.id and r.current_revision > 0);

  -- 5. Backfill: live seats get any scope assignment their position now needs.
  for seat in
    select s.*, p.unit_id from app_private.tedx_seats s
    join app_private.tedx_positions p on p.role_id = s.role_id
    where s.term_id = p_term and not s.revoked and s.ends_at > statement_timestamp()
  loop
    for scope in
      select distinct rp.allowed_scope from public.role_permissions rp where rp.role_id = seat.role_id
      except
      -- A scope with a live grant needs nothing; a scope an admin revoked for this seat and role stays revoked.
      select a.scope_type from app_private.tedx_seat_grants g join public.role_assignments a on a.id = g.grant_id
        where g.seat_id = seat.id and (a.status = 'active' or (a.status = 'revoked' and a.role_id = seat.role_id))
    loop
      if scope.allowed_scope = 'unit' and seat.unit_id is null then continue; end if;
      select a.granted_by into grantor from app_private.tedx_seat_grants g join public.role_assignments a on a.id = g.grant_id
        where g.seat_id = seat.id order by a.effective_from limit 1;
      if grantor is null then
        select h.actor_id into grantor from app_private.tedx_seat_history h where h.seat_id = seat.id order by h.version limit 1;
      end if;
      if grantor is null then continue; end if;
      insert into public.role_assignments(organization_id, term_id, term_membership_id, role_id, scope_type, unit_id,
        effective_from, effective_to, granted_by)
        values (term_row.organization_id, p_term, seat.membership_id, seat.role_id, scope.allowed_scope,
          case when scope.allowed_scope = 'unit' then seat.unit_id end, greatest(seat.starts_at, statement_timestamp()), seat.ends_at, grantor)
        returning id into new_grant;
      insert into app_private.tedx_seat_grants values (new_grant, seat.id);
      added_grants := added_grants + 1;
    end loop;
  end loop;

  select count(*) into n from app_private.tedx_positions where term_id = p_term;
  insert into app_private.single_admin_actions(term_id, action, detail)
    values (p_term, 'review_units_setup', jsonb_build_object('positions', n, 'permissionsAdded', added_permissions, 'grantsAdded', added_grants));
  return jsonb_build_object('permissionsAdded', added_permissions, 'grantsAdded', added_grants);
end;
$$;
revoke all on function app_private.tedx_review_setup(uuid) from public, anon, authenticated, service_role;

-- Apply to every term that already has the committee roster.
do $$
declare t uuid;
begin
  for t in select distinct term_id from app_private.tedx_positions loop
    perform app_private.tedx_review_setup(t);
  end loop;
end $$;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.single_admin_actions','security','term',array['id'],
  format('select app_private.disposition_key(%L,array[x.id::text]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.single_admin_actions x where x.term_id=$1',
    'app_private.single_admin_actions','security','security'),
  app_private.disposition_structure('app_private.single_admin_actions'),false
on conflict(source_key) do update set category=excluded.category,scope_kind=excluded.scope_kind,key_columns=excluded.key_columns,
  query_sql=excluded.query_sql,structure_hash=excluded.structure_hash,preserve=excluded.preserve;

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode='55000',message='privacy_disposition_catalog_changed',
      detail='A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
