-- Coordination board: one read-only snapshot for the war room, "Who do I ask" and committee pages.
-- Returns the term's live committees with their people (heads first) and ready request services,
-- every deliverable the caller can see with checklist progress, and open asks between committees.
-- Additive only: one new function, no table or data changes.
begin;

create function public.read_coordination_board(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  directory boolean;
  admin boolean;
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
  result jsonb;
begin
  if p_term_id is null or not public.has_capability(p_term_id, 'workspace.read') then
    raise exception using errcode = '42501', message = 'command_permission_denied';
  end if;
  directory := public.has_capability(p_term_id, 'directory.read');
  admin := public.has_capability(p_term_id, 'admin.configure');

  with visible_people as materialized (
    -- read_directory already applies the directory.read check and active-membership rules.
    select d.member_id, d.display_name, tm.id as membership_id,
      case when m.normalized_email like '%@student.ateneo.edu' then m.normalized_email end as contact
    from public.read_directory(p_term_id) d
    join public.members m on m.id = d.member_id
    join public.term_memberships tm on tm.member_id = d.member_id and tm.term_id = p_term_id
    where directory
  ), deployments as materialized (
    select um.unit_id, p.member_id, p.display_name, p.contact,
      min(case um.deployment_type when 'head' then 0 when 'primary_contact' then 1 when 'backup_contact' then 2 else 3 end) as rank
    from visible_people p
    join public.unit_memberships um on um.term_membership_id = p.membership_id
    where um.status = 'active' and um.effective_from <= statement_timestamp() and um.effective_to > statement_timestamp()
    group by um.unit_id, p.member_id, p.display_name, p.contact
  ), units as (
    select u.* from public.org_units u where u.term_id = p_term_id and u.archived_at is null
  ), work as materialized (
    select w.id, w.title, w.lead_unit_id, w.owner_member_id, w.owner_display_name, w.due_on, w.due_at,
      d.phase_key, d.workflow_state, d.is_blocked
    from public.work_items w join public.deliverables d on d.work_item_id = w.id
    where w.term_id = p_term_id and w.kind = 'deliverable' and w.archived_at is null
      and d.workflow_state <> 'cancelled' and public.can_access_work(w.id, 'summary')
    order by coalesce(w.due_on, (w.due_at at time zone 'Asia/Manila')::date) nulls last, w.id
    limit 500
  )
  select jsonb_build_object(
    'today', today,
    'refreshedAt', statement_timestamp(),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'code', u.code, 'name', u.name, 'delivery', u.delivery_committee,
        'canNudge', admin or public.has_capability(p_term_id, 'committee.manage', u.id),
        'people', coalesce((select jsonb_agg(jsonb_build_object('id', x.member_id, 'name', x.display_name,
            'contact', x.contact, 'role', case x.rank when 0 then 'head' when 1 then 'primary_contact' when 2 then 'backup_contact' else 'member' end)
            order by x.rank, x.display_name, x.member_id)
          from deployments x where x.unit_id = u.id), '[]'::jsonb),
        'services', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'need', t.need) order by t.label, t.id)
          from public.request_types t
          where t.term_id = p_term_id and t.receiving_unit_id = u.id and app_private.request_route_ready(t)), '[]'::jsonb)
      ) order by u.name, u.id) from units u), '[]'::jsonb),
    'deliverables', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'unitId', w.lead_unit_id,
        'supportingUnitIds', coalesce((select jsonb_agg(du.unit_id order by du.unit_id) from public.deliverable_units du
          where du.work_item_id = w.id and du.unit_id is distinct from w.lead_unit_id), '[]'::jsonb),
        'ownerId', w.owner_member_id, 'ownerName', w.owner_display_name,
        'ownerContact', (select p.contact from visible_people p where p.member_id = w.owner_member_id),
        'dueOn', coalesce(w.due_on, (w.due_at at time zone 'Asia/Manila')::date), 'dueAt', w.due_at,
        'phase', w.phase_key, 'state', w.workflow_state, 'blocked', w.is_blocked,
        'tasksDone', c.done, 'tasksTotal', c.total,
        -- Waiting on another committee: a required step owned elsewhere is unfinished, a package
        -- handed to this deliverable is still waiting, or an ask for help is not yet agreed.
        'waiting', exists(
            select 1 from public.work_items tw
            join public.task_dependencies dep on dep.successor_task_id = tw.id
            join public.work_items pw on pw.id = dep.predecessor_task_id
            join public.tasks pt on pt.work_item_id = pw.id
            left join public.work_items pp on pp.id = pw.parent_work_item_id
            where tw.parent_work_item_id = w.id and tw.archived_at is null and dep.removed_at is null and dep.required
              and dep.dependency_type = 'finish_to_start' and (pt.workflow_state <> 'done' or pw.archived_at is not null)
              and coalesce(pt.assigned_unit_id, pw.lead_unit_id, pp.lead_unit_id) is distinct from w.lead_unit_id
          ) or exists(
            select 1 from public.handoffs h join public.work_items tw on tw.id = h.next_task_id
            where tw.parent_work_item_id = w.id and h.state in ('proposed', 'changes_requested')
          ) or exists(
            select 1 from public.synergy_agreements s where s.parent_work_item_id = w.id and s.state in ('proposed', 'countered')
          )
      ) order by coalesce(w.due_on, (w.due_at at time zone 'Asia/Manila')::date) nulls last, w.id)
      from work w
      cross join lateral (
        select (count(*) filter (where t.workflow_state = 'done'))::integer as done, count(*)::integer as total
        from public.work_items tw join public.tasks t on t.work_item_id = tw.id
        where tw.parent_work_item_id = w.id and tw.archived_at is null and t.workflow_state <> 'cancelled'
      ) c), '[]'::jsonb),
    'asks', coalesce((select jsonb_agg(q.item order by q.due_on nulls last, q.id) from (
        select s.id, r.due_on, jsonb_build_object('id', s.id, 'kind', 'agreement', 'fromUnitId', s.requester_unit_id,
          'toUnitId', s.receiver_unit_id, 'title', r.output, 'dueOn', r.due_on, 'state', s.state,
          'href', '/working-together/' || s.id) as item
        from public.synergy_agreements s
        join public.agreement_revisions r on r.agreement_id = s.id and r.revision = s.current_revision
        where s.term_id = p_term_id and public.can_access_work(s.parent_work_item_id, 'summary')
          and (s.state in ('proposed', 'countered') or (s.state = 'accepted' and exists(
            select 1 from public.contributions c join public.tasks t on t.work_item_id = c.work_item_id
            join public.work_items cw on cw.id = c.work_item_id
            where c.agreement_id = s.id and cw.archived_at is null and t.workflow_state not in ('done', 'cancelled'))))
        union all
        select h.id, hr.due_on, jsonb_build_object('id', h.id, 'kind', 'handoff',
          'fromUnitId', coalesce(st.assigned_unit_id, sw.lead_unit_id, pw.lead_unit_id), 'toUnitId', h.receiver_unit_id,
          'title', hr.output, 'dueOn', hr.due_on, 'state', h.state, 'href', '/working-together/handoffs/' || h.id)
        from public.handoffs h
        join public.handoff_revisions hr on hr.handoff_id = h.id and hr.revision = h.current_revision
        join public.work_items sw on sw.id = h.source_task_id
        join public.tasks st on st.work_item_id = sw.id
        left join public.work_items pw on pw.id = sw.parent_work_item_id
        where h.term_id = p_term_id and h.state in ('proposed', 'changes_requested')
          and public.can_access_work(h.source_task_id, 'summary')
        limit 300
      ) q), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.read_coordination_board(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_coordination_board(uuid) to authenticated;

commit;
