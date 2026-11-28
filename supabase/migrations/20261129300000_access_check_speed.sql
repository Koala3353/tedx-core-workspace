-- Speed up the access checks that every read runs.
--
-- Measured on the live project (5 members): has_capability took 16-20 ms and
-- resolve_auth_context 280 ms, because
--   * SQL-language helpers that are SECURITY DEFINER or SET search_path are never inlined and
--     PostgreSQL 17 re-plans them on every call (about 20 ms of planning for has_capability);
--   * effective_role_assignments filters with access_lineage_current(id), and with the default
--     cost the planner ran that check on every assignment in the term before the cheap
--     "is this my membership" filter, so the cost grows with the size of the roster
--     (about 2 ms per assignment: ~0.6 s per check at 60-70 members);
--   * explain_access called has_capability once per granted capability.
--
-- Nothing here changes who can see or do what. Each function keeps its signature, return type,
-- volatility, SECURITY DEFINER/INVOKER setting, search_path and grants; bodies are the same
-- queries moved into PL/pgSQL (whose plans are cached per connection) with the caller's
-- membership looked up once.

-- Membership of the signed-in person in a term (same query; PL/pgSQL caches its plan).
create or replace function public.current_term_membership(p_term_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_membership uuid;
begin
  select tm.id into v_membership from public.term_memberships tm
  join public.members m on m.id=tm.member_id and m.organization_id=tm.organization_id
  join public.terms t on t.id=tm.term_id and t.organization_id=tm.organization_id
  join public.organizations o on o.id=tm.organization_id
  join auth.users u on u.id=m.auth_user_id and lower(btrim(u.email))=m.normalized_email
  where m.auth_user_id=(select auth.uid()) and app_private.is_school_identity(u.id)
    and m.account_state='active' and tm.membership_kind='core'
    and tm.term_id=p_term_id and tm.status='active' and o.state='active'
    and tm.joined_at<=statement_timestamp() and tm.ends_at>statement_timestamp()
    and t.state in ('active','frozen')
    and (statement_timestamp() at time zone 'Asia/Manila')::date between t.starts_on and t.closes_on;
  return v_membership;
end
$function$;

-- Capability check: the membership is resolved once, then only that member's assignments are
-- read (index below) and the expensive lineage check runs last.
create or replace function public.has_capability(p_term_id uuid, p_capability text, p_unit_id uuid default null::uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_membership uuid := public.current_term_membership(p_term_id);
begin
  if v_membership is null then return false; end if;
  return exists (
    select 1 from app_private.effective_role_assignments a
    join public.roles r on r.id = a.role_id and r.term_id = a.term_id and r.organization_id = a.organization_id
    join public.role_permissions p on p.role_id = r.id and p.term_id = a.term_id and p.organization_id = a.organization_id
    join public.term_memberships tm on tm.id = a.term_membership_id
    where a.term_membership_id = v_membership
      and a.term_id = p_term_id and tm.membership_kind = 'core'
      and a.status = 'active' and r.state = 'active'
      and a.effective_from <= statement_timestamp() and a.effective_to > statement_timestamp()
      and p.capability = p_capability and p.allowed_scope = a.scope_type
      and ((a.scope_type in ('term', 'own') and p_unit_id is null) or
        (a.scope_type = 'unit' and a.unit_id = p_unit_id and exists (
          select 1 from public.unit_memberships d join public.org_units u on u.id = d.unit_id
          where d.term_membership_id = tm.id and d.unit_id = a.unit_id and d.term_id = a.term_id
            and d.organization_id = a.organization_id and d.status = 'active' and u.archived_at is null
            and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp()
        )))
  );
end
$function$;

-- Grants of the signed-in person (used by resolve_auth_context on every page load/check).
create or replace function public.explain_access(p_term_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_membership uuid := public.current_term_membership(p_term_id);
begin
  return jsonb_build_object('membership_id', v_membership,
    'grants', coalesce((select jsonb_agg(jsonb_build_object(
      'role_id', a.role_id, 'capability', p.capability, 'scope', a.scope_type,
      'unit_id', a.unit_id, 'expires_at', a.effective_to) order by a.id, p.capability)
      from app_private.effective_role_assignments a join public.role_permissions p on p.role_id = a.role_id
      join public.roles r on r.id = a.role_id and r.state = 'active'
      where v_membership is not null and a.term_membership_id = v_membership
        and a.status = 'active' and a.effective_from <= statement_timestamp() and a.effective_to > statement_timestamp()
        and p.allowed_scope = a.scope_type and public.has_capability(p_term_id, p.capability, a.unit_id)), '[]'::jsonb));
end
$function$;

-- Identity check (SECURITY INVOKER, as before).
create or replace function app_private.is_school_identity(p_user_id uuid)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
begin
  return exists(select 1 from auth.users u join auth.identities i on i.user_id=u.id
    where u.id=p_user_id and u.email_confirmed_at is not null
      and lower(btrim(u.email)) ~ '^[^@[:space:]]+@student[.]ateneo[.]edu$'
      and lower(btrim(i.identity_data->>'email'))=lower(btrim(u.email))
      and ((i.provider='google' and i.identity_data->'email_verified'='true'::jsonb)
        or (i.provider='email' and coalesce(i.identity_data->'email_verified','true'::jsonb)='true'::jsonb
          -- Code-only accounts never have a password. A password set before the student confirmed
          -- could belong to someone else who signed up with their address, so it disqualifies.
          and coalesce(u.encrypted_password,'')='')));
end
$function$;

-- Verified address of a user (SECURITY INVOKER, as before).
create or replace function app_private.verified_google_email(p_user uuid)
returns text
language plpgsql
stable
set search_path to ''
as $function$
declare v_email text;
begin
  select lower(btrim(u.email)) into v_email from auth.users u where u.id=p_user and u.email_confirmed_at is not null
    and (exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'
        and i.identity_data->'email_verified'='true'::jsonb
        and lower(btrim(i.identity_data->>'email'))=lower(btrim(u.email)))
      or (app_private.is_school_identity(u.id)
        and exists(select 1 from public.members m where m.normalized_email=lower(btrim(u.email))
          and m.account_state in ('invited','active') and (m.auth_user_id is null or m.auth_user_id=u.id))));
  return v_email;
end
$function$;

-- Seat-backed grant still live (SECURITY INVOKER, as before).
create or replace function app_private.tedx_seat_grant_live(p_grant public.role_assignments)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
begin
  return not exists (select 1 from app_private.tedx_positions p where p.role_id = p_grant.role_id)
  or exists (
    select 1 from app_private.tedx_seat_grants g
    join app_private.tedx_seats s on s.id = g.seat_id
    join app_private.tedx_positions p on p.role_id = s.role_id
    where g.grant_id = p_grant.id and s.role_id = p_grant.role_id and s.term_id = p_grant.term_id
      and s.membership_id = p_grant.term_membership_id and not s.revoked
      and s.starts_at <= statement_timestamp() and s.ends_at > statement_timestamp()
      and (p.unit_id is null or exists (
        select 1 from public.unit_memberships d join public.org_units u on u.id = d.unit_id
        where d.id = s.deployment_id and d.unit_id = p.unit_id and d.term_membership_id = s.membership_id
          and d.status = 'active' and u.archived_at is null
          and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp()
      ))
  );
end
$function$;

-- Assignment base liveness (same query; plan cached).
create or replace function app_private.access_base_live(p_assignment uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
 return exists(select 1 from public.role_assignments a join public.roles r on r.id=a.role_id join public.term_memberships tm on tm.id=a.term_membership_id join public.members m on m.id=tm.member_id join public.terms t on t.id=a.term_id join public.organizations o on o.id=tm.organization_id
 where a.id=p_assignment and app_private.tedx_seat_grant_live(a) and a.term_id=tm.term_id and r.term_id=a.term_id and r.state='active'and a.status='active'and a.effective_from<=statement_timestamp()and a.effective_to>statement_timestamp()
 and tm.membership_kind='core'and tm.status='active'and tm.joined_at<=statement_timestamp()and tm.ends_at>statement_timestamp()and m.account_state='active'and app_private.is_school_identity(m.auth_user_id)and app_private.verified_google_email(m.auth_user_id)=m.normalized_email
 and t.state in('active','frozen')and o.state='active'and(statement_timestamp()at time zone'Asia/Manila')::date between t.starts_on and t.closes_on
 and(a.scope_type<>'unit'or exists(select 1 from public.unit_memberships d join public.org_units u on u.id=d.unit_id where d.term_membership_id=tm.id and d.unit_id=a.unit_id and d.status='active'and d.effective_from<=statement_timestamp()and d.effective_to>statement_timestamp()and u.archived_at is null))
 and(a.scope_type<>'work'or exists(select 1 from public.work_items w where w.id=a.work_id and w.term_id=a.term_id and w.archived_at is null)));
end
$function$;

-- Custody root (same query; plan cached).
create or replace function app_private.access_custody_root(p_assignment uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
 return exists(select 1 from public.verified_app_custodians v join public.role_assignments a on a.id=v.assignment_id join public.roles r on r.id=a.role_id
 where v.assignment_id=p_assignment and v.independent_root and v.assignment_version=a.version and v.role_version=r.version and v.revoked_at is null and v.verified_at<=statement_timestamp()and v.effective_to>statement_timestamp()and a.scope_type='term'and app_private.access_base_live(a.id)
 and v.verified_by<>a.term_membership_id and exists(select 1 from public.term_memberships verifier where verifier.id=v.verified_by and verifier.term_id=a.term_id)
 and(select count(*)from public.role_permissions rp where rp.role_id=a.role_id)=2
 and not exists(select 1 from unnest(array['admin.configure','roles.manage'])cap where not exists(select 1 from public.role_permissions rp where rp.role_id=a.role_id and rp.capability=cap and rp.allowed_scope='term')));
end
$function$;

-- Tell the planner these checks are expensive so cheap filters (term, membership, status,
-- dates) run first wherever effective_role_assignments or the helpers appear in a WHERE clause.
alter function app_private.access_lineage_current(uuid, uuid[]) cost 10000;
alter function app_private.access_base_live(uuid) cost 2000;
alter function app_private.access_custody_root(uuid) cost 2000;
alter function app_private.tedx_seat_grant_live(public.role_assignments) cost 500;
alter function public.current_term_membership(uuid) cost 500;
alter function public.has_capability(uuid, text, uuid) cost 1000;

-- "Assignments of this membership" is the lookup every check starts from; the existing index
-- leads with organization_id, which the checks don't filter on.
create index if not exists role_assignments_membership_term_idx
  on public.role_assignments (term_membership_id, term_id);
