-- Reminder recipient preview: server-side search and a committee filter, plus totals.
-- preview_notification_recipients(p_draft_id,p_expected_version,p_after) gains p_filters default '{}'.
-- The old function is dropped in the same change, so existing calls without p_filters resolve
-- to the new one and PostgREST never sees two candidates. The read-audit wrapper from
-- 20261109182925 is rebuilt around the new inner reader.
--
-- Access is unchanged: the draft must be the caller's own notification draft, presentation_actor
-- must pass, the version and base-version stale checks are identical, and rows are still only
-- pending work the caller can open in detail (can_access_work(...,'detail')) with a recipient.
-- Paging stays keyset by work id (p_after); search and the committee filter only narrow the rows.
--
-- p_filters: {"q": text (recipient name, title or reference), "units": [uuid]}
--  units keeps work led by, or (for tasks) assigned to, any of the listed committees.
-- Adds total (matching rows) and unfilteredTotal (all rows) for "12 of 340".
-- The template text now matches the wording the admin screen shows for this template
-- ("... to see what you can do next."); nothing is sent from this preview.
begin;

do $$begin
  if to_regprocedure('app_private.p46_read_preview_notification_recipients(uuid,integer,uuid)') is null
    or position('p46_read_preview_notification_recipients' in pg_get_functiondef('public.preview_notification_recipients(uuid,integer,uuid)'::regprocedure))=0 then
    raise exception using errcode='55000',message='recipient_preview_read_audit_missing';
  end if;
end$$;

drop function public.preview_notification_recipients(uuid,integer,uuid);
drop function app_private.p46_read_preview_notification_recipients(uuid,integer,uuid);

create function app_private.p46_read_preview_notification_recipients(p_draft_id uuid,p_expected_version integer,p_after uuid default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.presentation_drafts;items jsonb;cursor uuid;current_version integer;q text;units uuid[];matching integer;everyone integer;begin
 select *into d from public.presentation_drafts where id=p_draft_id and kind='notification'and actor_id=auth.uid();
 if d.id is null then raise exception using errcode='42501',message='command_permission_denied';end if;
 perform app_private.presentation_actor(d.term_id,d.kind,d.target_kind,d.target_id);
 if d.version is distinct from p_expected_version then raise exception using errcode='40001',message='command_stale_version';end if;
 select coalesce(max(v.version),0)into current_version from public.presentation_controls c join public.presentation_versions v on v.control_id=c.work_item_id
 where c.term_id=d.term_id and c.kind='notification'and c.target_kind='term'and c.target_id=d.term_id;
 if d.published_version_id is not null or d.base_version<>current_version then raise exception using errcode='40001',message='command_stale_version';end if;
 perform app_private.validate_presentation('notification',d.definition);
 q:=app_private.list_filter_query(coalesce(p_filters,'{}'::jsonb));
 units:=app_private.list_filter_units(coalesce(p_filters,'{}'::jsonb));
 with allowed as materialized(select w.*,app_private.notification_assignee(w)recipient from public.work_items w
 where w.term_id=d.term_id and app_private.notification_pending(w)and public.can_access_work(w.id,'detail')),
 named as materialized(select a.*,m.display_name recipient_name from allowed a join public.term_memberships tm on tm.id=a.recipient join public.members m on m.id=tm.member_id),
 matched as materialized(select n.* from named n left join public.tasks t on t.work_item_id=n.id
  where (units is null or n.lead_unit_id=any(units) or t.assigned_unit_id=any(units))
   and (q is null or app_private.list_search_match(concat_ws(' ',n.recipient_name,n.title,(select r.reference_text from public.work_references r where r.work_item_id=n.id)),q))),
 page as materialized(select *from matched where p_after is null or id>p_after order by id limit 21),shown as(select *from page order by id limit 20)
 select coalesce((select jsonb_agg(jsonb_build_object('workId',s.id,'name',s.recipient_name,'title',s.title,
 'href',case s.kind when 'task'then '/tasks/'else '/deliverables/'end||s.id,'dueOn',coalesce(s.due_on,(s.due_at at time zone'Asia/Manila')::date),
 'action',case s.kind when 'task'then 'Open task and update progress'else 'Open deliverable and check submission'end)order by s.id)
 from shown s),'[]'),
 case when(select count(*)from page)>20 then(select id from shown order by id desc limit 1)end,
 (select count(*)from matched),(select count(*)from named)
 into items,cursor,matching,everyone;
 return jsonb_build_object('items',items,'nextAfter',cursor,'total',matching,'unfilteredTotal',everyone,'sends',false,'externalAvailable',false,
 'template','You have an update. Open your workspace to see what you can do next.');
end$$;
revoke all on function app_private.p46_read_preview_notification_recipients(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.preview_notification_recipients(p_draft_id uuid,p_expected_version integer,p_after uuid default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=app_private.p46_read_preview_notification_recipients(p_draft_id,p_expected_version,p_after,p_filters);
 perform app_private.record_content_read('preview_notification_recipients',null::uuid,p_draft_id,result is not null);
 return result;
end$$;
revoke all on function public.preview_notification_recipients(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_notification_recipients(uuid,integer,uuid,jsonb) to authenticated;
update public.restricted_read_endpoints set argument_types='p_draft_id uuid, p_expected_version integer, p_after uuid, p_filters jsonb' where endpoint='preview_notification_recipients';

commit;
