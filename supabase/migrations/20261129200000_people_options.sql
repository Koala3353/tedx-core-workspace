-- People options for pickers: one list per term with committee and position, so every person
-- picker can group by committee and show who is who.
--  * Visibility is exactly the member directory's: public.read_directory (directory.read, active
--    core members inside their term dates with an active account). Nobody outside it is returned.
--  * Committees are the person's current, non-archived placements (head placements first).
--  * Position and tier come from the person's highest current role seat, the same pick
--    read_team_setup makes (leadership, then head, then core).
--  * Read only; callers keep their own narrower option lists and use this only to label them.
begin;

create function public.read_people_options(p_term_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with roster as materialized (
    select tm.id membership_id, m.id member_id, m.display_name,
      (m.auth_user_id is not null and m.account_state = 'active') signed_in
    from public.read_directory(p_term_id) d
    join public.members m on m.id = d.member_id
    join public.term_memberships tm on tm.member_id = m.id and tm.term_id = p_term_id
      and tm.membership_kind = 'core' and tm.status = 'active'),
  seat as (
    select distinct on (s.membership_id) s.membership_id, r.name position, p.tier
    from app_private.tedx_seats s
    join roster x on x.membership_id = s.membership_id
    join app_private.tedx_positions p on p.role_id = s.role_id
    join public.roles r on r.id = s.role_id
    where s.term_id = p_term_id and not s.revoked and s.ends_at > statement_timestamp()
    order by s.membership_id, case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end, s.starts_at, s.id),
  placement as (
    select distinct on (um.term_membership_id, u.id) um.term_membership_id membership_id, u.id unit_id, u.code, u.name,
      (um.deployment_type = 'head') head
    from public.unit_memberships um
    join roster x on x.membership_id = um.term_membership_id
    join public.org_units u on u.id = um.unit_id and u.archived_at is null
    where um.term_id = p_term_id and um.status = 'active'
      and um.effective_from <= statement_timestamp() and um.effective_to > statement_timestamp()
    order by um.term_membership_id, u.id, (um.deployment_type = 'head') desc),
  units as (
    select membership_id,
      jsonb_agg(code order by head desc, name, unit_id) codes,
      jsonb_agg(name order by head desc, name, unit_id) names
    from placement group by membership_id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'membershipId', r.membership_id, 'memberId', r.member_id, 'name', r.display_name,
      'committeeCodes', coalesce(units.codes, '[]'::jsonb), 'committeeNames', coalesce(units.names, '[]'::jsonb),
      'position', seat.position, 'tier', seat.tier, 'signedIn', r.signed_in)
    order by r.display_name, r.membership_id), '[]'::jsonb)
  from roster r
  left join seat on seat.membership_id = r.membership_id
  left join units on units.membership_id = r.membership_id
$$;

revoke all on function public.read_people_options(uuid) from public, anon;
grant execute on function public.read_people_options(uuid) to authenticated;

commit;
