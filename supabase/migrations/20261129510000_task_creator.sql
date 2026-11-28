-- A task's owner is always its assignee (work_items.owner_member_id must equal tasks.assignee_id), so the
-- task page's "Owner" just repeated the assignee. Add who created the task, so the page can say
-- "Created by" instead. Same function body as before plus one field; access checks and the read audit in
-- public.read_task are unchanged.
begin;

create or replace function app_private.p46_read_read_task(p_work_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; creator text;
begin
  v := app_private.read_task_p36(p_work_item_id);
  if v is null then return null; end if;
  select m.display_name into creator from public.work_items w
    join public.members m on m.auth_user_id = w.created_by and m.organization_id = w.organization_id
    where w.id = p_work_item_id
    limit 1;
  return v || jsonb_build_object('reference', app_private.work_reference(p_work_item_id), 'createdByName', creator);
end
$$;

commit;
