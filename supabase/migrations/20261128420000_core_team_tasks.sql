-- "Entire core team" tasks: a full admin (admin.configure and roles.manage) creates one task per
-- active core member in a single call. Each task goes through the normal create path
-- (app_private.task_command -> task_command_p10: check_task_fields, check_task_assignment,
-- revisions, receipts), with the assignee set per member and no lead committee, which is the
-- per-unit restriction full admins already bypass. Members who cannot hold a task yet (invited,
-- not signed in) are counted as skipped. Idempotent per p_request_id: each member's task uses a
-- key derived from the request id, and the whole call stores its own receipt.
begin;

create function public.create_task_for_core_team(p_term_id uuid, p_data jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.term_memberships; payload jsonb; receipt jsonb; person record; data jsonb;
  created integer := 0; skipped integer := 0;
begin
  actor := app_private.request_actor(p_term_id, true);
  if not app_private.full_admin(p_term_id) then
    raise exception using errcode = '42501', message = 'command_permission_denied';
  end if;
  if p_request_id is null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  -- One shared body; per-person fields are set below and cannot be supplied by the caller.
  data := (p_data - 'assigneeId' - 'assignedUnitId' - 'leadUnitId' - 'collaborators')
    || jsonb_build_object('leadUnitId', null, 'assignedUnitId', null, 'collaborators', '[]'::jsonb);
  perform app_private.check_task_fields(data);
  payload := jsonb_build_array(p_term_id, data);
  receipt := app_private.begin_work_command('create_task_for_core_team', p_request_id, payload);
  if receipt is not null then return receipt; end if;

  for person in
    select m.id member_id, m.account_state = 'active' and m.auth_user_id is not null ready
    from public.term_memberships tm join public.members m on m.id = tm.member_id
    where tm.term_id = p_term_id and tm.membership_kind = 'core' and tm.status = 'active'
      and tm.joined_at <= statement_timestamp() and tm.ends_at > statement_timestamp()
      and m.account_state in ('active', 'invited')
    order by m.display_name, m.id
  loop
    if not person.ready then skipped := skipped + 1; continue; end if;
    perform app_private.task_command('create_task', p_term_id, null,
      data || jsonb_build_object('assigneeId', person.member_id::text), null,
      md5(p_request_id::text || ':core_team:' || person.member_id::text)::uuid);
    created := created + 1;
  end loop;
  return app_private.notification_receipt(p_term_id, 'create_task_for_core_team', p_request_id, payload,
    jsonb_build_object('created', created, 'skipped', skipped));
end;
$$;

revoke all on function public.create_task_for_core_team(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_task_for_core_team(uuid, jsonb, uuid) to authenticated;

commit;
