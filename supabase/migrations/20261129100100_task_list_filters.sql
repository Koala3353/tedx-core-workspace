-- My tasks: server-side search, committee and status filters.
-- read_tasks(p_term_id,p_view,p_page) becomes read_tasks(p_term_id,p_view,p_page,p_filters default '{}').
-- The old three-argument function is dropped in the same change, so existing calls (named or
-- positional, without p_filters) resolve to the new one and PostgREST never sees two candidates.
-- The read-audit wrapper from 20261109182925 is rebuilt around the new inner reader.
--
-- Visibility is unchanged: the `permitted` set is the exact query from the previous reader
-- (term, not archived, caller on the roster, can_access_work(...,'detail'), and the view's rule).
-- Search and filters only narrow that set. Search reads only fields the caller is shown
-- (title, reference, assignee name, owner name, committee names).
--
-- p_filters: {"q": text, "units": [uuid], "states": [task state]}
-- Adds to the result: unfilteredTotal (the view without search/filters) and
-- facets.units / facets.states (counts for the chips, each ignoring its own filter).
begin;

do $$begin
  if to_regprocedure('app_private.p46_read_read_tasks(uuid,text,integer)') is null
    or position('p46_read_read_tasks' in pg_get_functiondef('public.read_tasks(uuid,text,integer)'::regprocedure))=0 then
    raise exception using errcode='55000',message='read_tasks_read_audit_missing';
  end if;
end$$;

drop function public.read_tasks(uuid,text,integer);
drop function app_private.p46_read_read_tasks(uuid,text,integer);

create function app_private.p46_read_read_tasks(p_term_id uuid,p_view text default 'assigned',p_page integer default 1,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member uuid;result jsonb;q text;units uuid[];states text[];begin
 if p_view not in ('assigned','created','watching','overdue','unit') or p_view is null or p_page is null or p_page not between 1 and 10000 then raise exception using errcode='22023',message='command_validation_failed';end if;
 q:=app_private.list_filter_query(coalesce(p_filters,'{}'::jsonb));
 units:=app_private.list_filter_units(coalesce(p_filters,'{}'::jsonb));
 states:=app_private.list_filter_values(coalesce(p_filters,'{}'::jsonb),'states',array['todo','in_progress','blocked','ready_for_review','done','cancelled']);
 select member_id into member from public.term_memberships where id=public.current_term_membership(p_term_id);
 with permitted as materialized(select w.id,w.due_on,w.due_at,w.owner_display_name,w.lead_unit_id,t.assigned_unit_id,public.read_task(w.id)-array['body','checklist','evidence','parentId'] as item from public.work_items w join public.tasks t on t.work_item_id=w.id
 where w.term_id=p_term_id and w.archived_at is null and member is not null and public.can_access_work(w.id,'detail') and
 case p_view when 'assigned' then t.assignee_id=member when 'created' then w.created_by=auth.uid()
 when 'watching' then exists(select 1 from public.task_collaborators c where c.work_item_id=w.id and c.member_id=member) or exists(select 1 from public.record_grants g where g.work_item_id=w.id and app_private.work_grant_matches(g))
 when 'unit' then app_private.task_manager(w) else t.workflow_state not in ('done','cancelled') and (t.assignee_id=member or w.owner_member_id=member or app_private.task_participant(w.id)) and coalesce(w.due_at<statement_timestamp(),w.due_on<(statement_timestamp() at time zone 'Asia/Manila')::date,false) end),
 marked as materialized(select p.*,
   (q is null or app_private.list_search_match(concat_ws(' ',p.item->>'title',p.item->'reference'->>'value',p.item->>'assigneeName',p.owner_display_name,
     (select string_agg(u.name,' ') from public.org_units u where u.id in (p.lead_unit_id,p.assigned_unit_id))),q)) as match_q,
   (units is null or p.lead_unit_id=any(units) or p.assigned_unit_id=any(units)) as match_unit,
   (states is null or p.item->>'state'=any(states)) as match_state
  from permitted p),
 filtered as(select * from marked where match_q and match_unit and match_state),
 page as(select * from filtered order by coalesce(due_at,(due_on+1)::timestamp at time zone 'Asia/Manila') nulls last,id limit 20 offset(p_page-1)*20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(item order by coalesce(due_at,(due_on+1)::timestamp at time zone 'Asia/Manila') nulls last,id)from page),'[]'),
  'total',(select count(*)from filtered),'page',p_page,'unfilteredTotal',(select count(*)from permitted),
  'facets',jsonb_build_object(
   'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'count',x.n) order by u.name,u.id)
     from (select unit_id,count(distinct m.id) n from marked m cross join lateral unnest(array[m.lead_unit_id,m.assigned_unit_id]) unit_id
       where m.match_q and m.match_state and unit_id is not null group by unit_id) x join public.org_units u on u.id=x.unit_id),'[]'::jsonb),
   'states',coalesce((select jsonb_object_agg(s,n) from (select item->>'state' s,count(*) n from marked where match_q and match_unit and item->>'state' is not null group by 1) x),'{}'::jsonb)))
 into result;return result;end$$;
revoke all on function app_private.p46_read_read_tasks(uuid,text,integer,jsonb) from public,anon,authenticated,service_role;

create function public.read_tasks(p_term_id uuid,p_view text default 'assigned',p_page integer default 1,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=app_private.p46_read_read_tasks(p_term_id,p_view,p_page,p_filters);
 perform app_private.record_content_read('read_tasks',p_term_id,null::uuid,result is not null);
 return result;
end$$;
revoke all on function public.read_tasks(uuid,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_tasks(uuid,text,integer,jsonb) to authenticated;
update public.restricted_read_endpoints set argument_types='p_term_id uuid, p_view text, p_page integer, p_filters jsonb' where endpoint='read_tasks';

commit;
