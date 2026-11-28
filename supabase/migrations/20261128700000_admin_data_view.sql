-- Admin "Data" page: a read-only, spreadsheet-style look at the workspace's operational records.
--  * Full admins only (admin.configure and roles.manage), checked on every call.
--  * Fixed, curated datasets with readable columns, never raw tables. Finance, privacy, PRISM/feedback,
--    private profiles, guest tokens and restricted work stay out: those keep their own role-gated screens.
--  * Read only: no writes, and the function is stable.
begin;

create function public.read_admin_dataset(p_term_id uuid, p_dataset text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cols jsonb;
  rows jsonb;
  cap constant integer := 5000;
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
begin
  perform app_private.request_actor(p_term_id, false);
  if not app_private.full_admin(p_term_id) then
    raise exception using errcode = '42501', message = 'command_permission_denied';
  end if;

  if p_dataset = 'people' then
    cols := '[{"key":"name","label":"Name","type":"text"},{"key":"email","label":"Email","type":"text"},
      {"key":"committee","label":"Committee","type":"text"},{"key":"position","label":"Position","type":"text"},
      {"key":"membership","label":"Membership","type":"text"},{"key":"status","label":"Status","type":"text"},
      {"key":"signedIn","label":"Signed in","type":"bool"},{"key":"addedAt","label":"Added","type":"datetime"}]';
    select jsonb_agg(r order by r->>'name') into rows from (
      select jsonb_build_object('name', m.display_name, 'email', m.normalized_email,
        'committee', (select string_agg(u.name, ', ' order by u.name) from public.unit_memberships um
          join public.org_units u on u.id = um.unit_id
          where um.term_membership_id = tm.id and um.status = 'active' and u.archived_at is null),
        'position', (select string_agg(ro.name, ', ' order by ro.name) from app_private.tedx_seats s
          join public.roles ro on ro.id = s.role_id
          where s.membership_id = tm.id and not s.revoked and s.ends_at > statement_timestamp()),
        'membership', tm.membership_kind, 'status', tm.status, 'signedIn', m.auth_user_id is not null,
        'addedAt', tm.created_at) r
      from public.term_memberships tm join public.members m on m.id = tm.member_id
      where tm.term_id = p_term_id
      limit cap) x;

  elsif p_dataset = 'committees' then
    cols := '[{"key":"code","label":"Code","type":"text"},{"key":"name","label":"Committee","type":"text"},
      {"key":"type","label":"Type","type":"text"},{"key":"members","label":"Members","type":"number"},
      {"key":"archived","label":"Archived","type":"bool"}]';
    select jsonb_agg(r order by r->>'name') into rows from (
      select jsonb_build_object('code', u.code, 'name', u.name,
        'type', case when u.review_service then 'Review service' when u.delivery_committee then 'Committee' else 'Other' end,
        'members', (select count(*) from public.unit_memberships um where um.unit_id = u.id and um.status = 'active'),
        'archived', u.archived_at is not null) r
      from public.org_units u where u.term_id = p_term_id limit cap) x;

  elsif p_dataset = 'positions' then
    cols := '[{"key":"position","label":"Position","type":"text"},{"key":"committee","label":"Committee","type":"text"},
      {"key":"tier","label":"Tier","type":"text"},{"key":"admin","label":"Admin","type":"bool"},
      {"key":"holders","label":"Held by","type":"text"},{"key":"count","label":"People","type":"number"},
      {"key":"state","label":"State","type":"text"}]';
    select jsonb_agg(r order by r->>'committee' nulls first, r->>'position') into rows from (
      select jsonb_build_object('position', ro.name, 'committee', u.name, 'tier', initcap(p.tier), 'admin', p.administrator,
        'holders', (select string_agg(m.display_name, ', ' order by m.display_name) from app_private.tedx_seats s
          join public.term_memberships tm on tm.id = s.membership_id join public.members m on m.id = tm.member_id
          where s.role_id = p.role_id and not s.revoked and s.ends_at > statement_timestamp()),
        'count', (select count(distinct s.membership_id) from app_private.tedx_seats s
          where s.role_id = p.role_id and not s.revoked and s.ends_at > statement_timestamp()),
        'state', ro.state) r
      from app_private.tedx_positions p join public.roles ro on ro.id = p.role_id
        left join public.org_units u on u.id = p.unit_id
      where p.term_id = p_term_id limit cap) x;

  elsif p_dataset in ('tasks', 'deliverables') then
    cols := '[{"key":"ref","label":"Ref","type":"text"},{"key":"title","label":"Title","type":"text"},
      {"key":"committee","label":"Committee","type":"text"},{"key":"owner","label":"Owner","type":"text"},
      {"key":"state","label":"State","type":"text"},{"key":"start","label":"Planned start","type":"date"},
      {"key":"due","label":"Due","type":"date"},{"key":"originalDue","label":"First due date","type":"date"},
      {"key":"overdue","label":"Overdue","type":"bool"},{"key":"blocked","label":"Blocked","type":"bool"},
      {"key":"archived","label":"Archived","type":"bool"},{"key":"updatedAt","label":"Updated","type":"datetime"}]';
    select jsonb_agg(r order by r->>'due' nulls last, r->>'title') into rows from (
      select jsonb_build_object('ref', wr.reference_text, 'title', w.title, 'committee', u.name,
        'owner', coalesce(t.assignee_name, w.owner_display_name),
        'state', initcap(replace(coalesce(t.workflow_state, d.workflow_state, ''), '_', ' ')),
        'start', w.planned_start_on,
        'due', coalesce(w.due_on, (w.due_at at time zone 'Asia/Manila')::date),
        'originalDue', coalesce(w.original_due_on, (w.original_due_at at time zone 'Asia/Manila')::date),
        'overdue', w.archived_at is null and coalesce(t.workflow_state, d.workflow_state, '') not in ('done', 'accepted', 'cancelled')
          and coalesce(w.due_at < statement_timestamp(), w.due_on < today, false),
        'blocked', coalesce(t.workflow_state = 'blocked', d.is_blocked, false),
        'archived', w.archived_at is not null, 'updatedAt', w.updated_at) r
      from public.work_items w
        left join public.tasks t on t.work_item_id = w.id
        left join public.deliverables d on d.work_item_id = w.id
        left join public.org_units u on u.id = w.lead_unit_id
        left join public.work_references wr on wr.work_item_id = w.id
      where w.term_id = p_term_id and w.classification = 'ordinary'
        and w.kind = case p_dataset when 'tasks' then 'task' else 'deliverable' end
      limit cap) x;

  elsif p_dataset = 'calendar' then
    cols := '[{"key":"title","label":"Event","type":"text"},{"key":"starts","label":"Starts","type":"text"},
      {"key":"ends","label":"Ends","type":"text"},{"key":"allDay","label":"All day","type":"bool"},
      {"key":"visibility","label":"Who sees it","type":"text"},{"key":"location","label":"Location","type":"text"},
      {"key":"state","label":"State","type":"text"}]';
    select jsonb_agg(r order by r->>'starts') into rows from (
      select jsonb_build_object('title', e.title,
        'starts', case when e.all_day then e.start_on::text else to_char(e.starts_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') end,
        'ends', case when e.all_day then (e.end_on - 1)::text else to_char(e.ends_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') end,
        'allDay', e.all_day, 'visibility', case e.visibility when 'core' then 'All core' else 'Committee' end,
        'location', e.location, 'state', initcap(e.state)) r
      from public.calendar_events e join public.work_items w on w.id = e.work_item_id
      where w.term_id = p_term_id and e.visibility in ('core', 'unit') and w.classification = 'ordinary'
      limit cap) x;

  elsif p_dataset = 'activity' then
    cols := '[{"key":"at","label":"When","type":"datetime"},{"key":"who","label":"Who","type":"text"},
      {"key":"action","label":"Action","type":"text"},{"key":"item","label":"Item","type":"text"}]';
    select jsonb_agg(r order by r->>'at' desc) into rows from (
      select jsonb_build_object('at', a.occurred_at, 'who', a.actor_display_name, 'action', replace(a.action, '_', ' '),
        'item', w.title) r
      from public.audit_events a left join public.work_items w on w.id = a.work_item_id and w.classification = 'ordinary'
      where a.term_id = p_term_id
      order by a.occurred_at desc limit 1000) x;

  else
    raise exception using errcode = '22023', message = 'command_invalid';
  end if;

  return jsonb_build_object('dataset', p_dataset, 'columns', cols, 'rows', coalesce(rows, '[]'::jsonb),
    'truncated', jsonb_array_length(coalesce(rows, '[]'::jsonb)) >= case p_dataset when 'activity' then 1000 else cap end,
    'readAt', statement_timestamp());
end;
$$;
revoke all on function public.read_admin_dataset(uuid, text) from public, anon;
grant execute on function public.read_admin_dataset(uuid, text) to authenticated;

commit;
