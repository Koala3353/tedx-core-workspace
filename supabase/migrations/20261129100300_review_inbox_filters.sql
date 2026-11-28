-- Review inbox: server-side search and a committee filter.
-- list_review_inbox(p_term_id,p_view,p_page) becomes list_review_inbox(...,p_filters default '{}').
-- The old function is dropped in the same change, so existing calls without p_filters resolve
-- to the new one and PostgREST never sees two candidates. The read-audit wrapper from
-- 20261109182925 is rebuilt around the new inner reader.
--
-- Visibility is unchanged: rows still come only from app_private.review_inbox_rows (requests the
-- caller manages or is assigned to review), behind the same roster and workspace.read checks.
-- Search reads only the fields each row already shows the caller (title as shown, which is the
-- request type for managers who are not reviewers; tracking id; service; requester; service
-- committee name), so it cannot reveal a hidden title.
--
-- p_filters: {"q": text, "units": [uuid]}  (units = the committee receiving the request)
-- Lane counts and total reflect the search and filter. Adds unfilteredTotal (this lane with no
-- search/filter) and facets.units (counts per receiving committee for this lane, ignoring the
-- committee filter).
begin;

do $$begin
  if to_regprocedure('app_private.p46_read_list_review_inbox(uuid,text,integer)') is null
    or position('p46_read_list_review_inbox' in pg_get_functiondef('public.list_review_inbox(uuid,text,integer)'::regprocedure))=0 then
    raise exception using errcode='55000',message='list_review_inbox_read_audit_missing';
  end if;
end$$;

drop function public.list_review_inbox(uuid,text,integer);
drop function app_private.p46_read_list_review_inbox(uuid,text,integer);

create function app_private.p46_read_list_review_inbox(p_term_id uuid,p_view text default 'all',p_page integer default 1,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;marked jsonb;filtered jsonb;q text;units uuid[];begin
 if p_view is null or p_view not in('all','unassigned','assigned','aging','revision')or p_page is null or p_page not between 1 and 10000 then raise exception using errcode='22023',message='command_validation_failed';end if;
 q:=app_private.list_filter_query(coalesce(p_filters,'{}'::jsonb));
 units:=app_private.list_filter_units(coalesce(p_filters,'{}'::jsonb));
 if public.current_term_membership(p_term_id)is null or not public.has_capability(p_term_id,'workspace.read')then return null;end if;
 select coalesce(jsonb_agg(v),'[]')into rows from app_private.review_inbox_rows(p_term_id)v;
 -- Each visible row gains private match flags (dropped before returning) from its receiving committee.
 select coalesce(jsonb_agg(x.v||jsonb_build_object('_unitId',x.unit_id,'_unitName',x.unit_name,
   '_q',(q is null or app_private.list_search_match(concat_ws(' ',x.v->>'title',x.v->>'trackingId',x.v->>'serviceLabel',x.v->>'owner',x.unit_name),q)),
   '_u',(units is null or x.unit_id=any(units)))),'[]')
 into marked from(select v,r.receiving_unit_id unit_id,u.name unit_name from jsonb_array_elements(rows)v
   left join public.requests r on r.work_item_id=(v->>'id')::uuid left join public.org_units u on u.id=r.receiving_unit_id)x;
 select coalesce(jsonb_agg(v-array['_unitId','_unitName','_q','_u'] order by v->>'submittedAt',v->>'id'),'[]')into filtered from jsonb_array_elements(marked)v
  where (v->>'_q')::boolean and (v->>'_u')::boolean and (p_view='all'or v->>'lane'=p_view or(p_view='aging'and(v->>'aging')::boolean));
 return jsonb_build_object('page',p_page,'total',jsonb_array_length(filtered),
 'unfilteredTotal',(select count(*)from jsonb_array_elements(rows)v where p_view='all'or v->>'lane'=p_view or(p_view='aging'and(v->>'aging')::boolean)),
 'counts',jsonb_build_object(
  'all',(select count(*)from jsonb_array_elements(marked)v where(v->>'_q')::boolean and(v->>'_u')::boolean),
  'unassigned',(select count(*)from jsonb_array_elements(marked)v where(v->>'_q')::boolean and(v->>'_u')::boolean and v->>'lane'='unassigned'),
  'assigned',(select count(*)from jsonb_array_elements(marked)v where(v->>'_q')::boolean and(v->>'_u')::boolean and v->>'lane'='assigned'),
  'aging',(select count(*)from jsonb_array_elements(marked)v where(v->>'_q')::boolean and(v->>'_u')::boolean and(v->>'aging')::boolean),
  'revision',(select count(*)from jsonb_array_elements(marked)v where(v->>'_q')::boolean and(v->>'_u')::boolean and v->>'lane'='revision')),
 'facets',jsonb_build_object('units',coalesce((select jsonb_agg(jsonb_build_object('id',unit_id,'name',unit_name,'count',n)order by unit_name,unit_id)from(
   select v->>'_unitId' unit_id,min(v->>'_unitName') unit_name,count(*) n from jsonb_array_elements(marked)v
   where(v->>'_q')::boolean and v->>'_unitId' is not null and(p_view='all'or v->>'lane'=p_view or(p_view='aging'and(v->>'aging')::boolean))group by 1)f),'[]'::jsonb)),
 'items',coalesce((select jsonb_agg(v order by ord)from jsonb_array_elements(filtered)with ordinality f(v,ord)where ord>(p_page-1)*20 and ord<=p_page*20),'[]'));
end$$;
revoke all on function app_private.p46_read_list_review_inbox(uuid,text,integer,jsonb) from public,anon,authenticated,service_role;

create function public.list_review_inbox(p_term_id uuid,p_view text default 'all',p_page integer default 1,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=app_private.p46_read_list_review_inbox(p_term_id,p_view,p_page,p_filters);
 perform app_private.record_content_read('list_review_inbox',p_term_id,null::uuid,result is not null);
 return result;
end$$;
revoke all on function public.list_review_inbox(uuid,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_review_inbox(uuid,text,integer,jsonb) to authenticated;
update public.restricted_read_endpoints set argument_types='p_term_id uuid, p_view text, p_page integer, p_filters jsonb' where endpoint='list_review_inbox';

commit;
