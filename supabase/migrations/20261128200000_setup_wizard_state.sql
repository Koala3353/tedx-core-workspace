-- First-run setup wizard: where each core member is in the wizard and when they finished or
-- skipped it. Additive: two defaulted/nullable columns on app_private.member_client_state, a new
-- record_setup_state RPC, and client_state_json (behind read_client_state and record_client_state)
-- gains setupStep, setupDone, committee and position. Existing keys and signatures are unchanged.
begin;

alter table app_private.member_client_state
  add column setup_step integer not null default 0 check(setup_step between 0 and 20),
  add column setup_done_at timestamptz check(setup_done_at is null or isfinite(setup_done_at));
update app_private.disposition_sources set structure_hash=app_private.disposition_structure(source_key)
  where source_key='app_private.member_client_state';

-- Same keys as before plus the wizard state, and the caller's committee and position for the
-- welcome step (seat first, then active committee deployment; null when neither exists).
create or replace function app_private.client_state_json(p_membership uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('installed',coalesce(s.installed_at is not null,false),'tutorialStep',coalesce(s.tutorial_step,0),
    'tutorialDone',coalesce(s.tutorial_done_at is not null,false),'tutorialVersion',coalesce(s.tutorial_version,0),
    'nudge',(select n.kind from app_private.member_nudges n where n.term_membership_id=p_membership and n.kind<>'sign_in'
      and n.created_at>statement_timestamp()-interval '7 days' and app_private.member_nudge_open(p_membership,n.kind)
      order by n.created_at desc,n.id limit 1),
    'setupStep',coalesce(s.setup_step,0),'setupDone',coalesce(s.setup_done_at is not null,false),
    'committee',coalesce(seat.unit_name,unit.unit_name),'position',seat.role_name)
  from (select 1) one
    left join app_private.member_client_state s on s.term_membership_id=p_membership
    left join lateral (
      select r.name role_name,u.name unit_name
      from app_private.tedx_seats ts join app_private.tedx_positions p on p.role_id=ts.role_id
        join public.roles r on r.id=ts.role_id left join public.org_units u on u.id=p.unit_id
      where ts.membership_id=p_membership and not ts.revoked and ts.ends_at>statement_timestamp()
      order by case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end,ts.starts_at,ts.id limit 1) seat on true
    left join lateral (
      select u.name unit_name
      from public.unit_memberships d join public.org_units u on u.id=d.unit_id and u.archived_at is null
      where d.term_membership_id=p_membership and d.status='active' and d.effective_to>statement_timestamp()
      order by case d.deployment_type when 'head' then 0 else 1 end,d.effective_from,d.id limit 1) unit on true;
$$;

-- Saves wizard progress for the caller. p_done true stamps the first finish (kept on later calls);
-- p_done false clears it so "Set up again" can reopen the wizard. Also stamps last_active_at.
create function public.record_setup_state(p_step integer default null,p_done boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.term_memberships; now_at timestamptz:=statement_timestamp();
begin
  m:=app_private.client_state_actor();
  if p_step is not null and p_step not between 0 and 20 then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  insert into app_private.member_client_state as s(term_membership_id,setup_step,setup_done_at,last_active_at,updated_at)
    values(m.id,coalesce(p_step,0),case when p_done then now_at end,now_at,now_at)
    on conflict(term_membership_id) do update set
      setup_step=coalesce(p_step,s.setup_step),
      setup_done_at=case when p_done is null then s.setup_done_at when p_done then coalesce(s.setup_done_at,now_at) end,
      last_active_at=now_at,updated_at=now_at;
  return app_private.client_state_json(m.id);
end;
$$;

revoke all on function app_private.client_state_json(uuid),public.record_setup_state(integer,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.record_setup_state(integer,boolean) to authenticated;

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode='55000',message='privacy_disposition_catalog_changed',
      detail='A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
