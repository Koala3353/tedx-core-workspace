-- My finance plans: server-side search and a status filter.
-- list_finance_cases(p_term_id,p_page) becomes list_finance_cases(p_term_id,p_page,p_filters default '{}').
-- The old function is dropped in the same change, so existing calls without p_filters resolve
-- to the new one and PostgREST never sees two candidates. The read-audit wrapper from
-- 20261109182925 is rebuilt around the new inner reader.
--
-- Visibility is unchanged: request_actor, then only the caller's own FIN requests in the term that
-- are not archived and pass can_access_work(...,'detail'). Search and the status filter only narrow
-- that set. There is no committee filter: every plan here is the caller's own FIN plan.
--
-- p_filters: {"q": text (title or FIN-012), "states": [request state]}
-- Adds unfilteredTotal (all of the caller's plans) and facets.states (counts ignoring the status filter).
begin;

do $$begin
  if to_regprocedure('app_private.p46_read_list_finance_cases(uuid,integer)') is null
    or position('p46_read_list_finance_cases' in pg_get_functiondef('public.list_finance_cases(uuid,integer)'::regprocedure))=0 then
    raise exception using errcode='55000',message='list_finance_cases_read_audit_missing';
  end if;
end$$;

drop function public.list_finance_cases(uuid,integer);
drop function app_private.p46_read_list_finance_cases(uuid,integer);

create function app_private.p46_read_list_finance_cases(p_term_id uuid,p_page integer default 1,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.term_memberships;result jsonb;q text;states text[];begin
 m:=app_private.request_actor(p_term_id);
 if p_page is null or p_page not between 1 and 10000 then raise exception using errcode='22023',message='command_validation_failed';end if;
 q:=app_private.list_filter_query(coalesce(p_filters,'{}'::jsonb));
 states:=app_private.list_filter_values(coalesce(p_filters,'{}'::jsonb),'states',array['draft','revision_draft','paused','in_review','needs_revision','approved','rejected','completed','cancelled']);
 with mine as materialized(
  select w.id,w.title,w.updated_at,r.request_state,r.tracking_id,r.current_revision,
   (q is null or app_private.list_search_match(concat_ws(' ',w.title,r.tracking_id),q)) as match_q
  from public.requests r join public.request_types t on t.id=r.request_type_id join public.work_items w on w.id=r.work_item_id
  where r.term_id=p_term_id and t.governed_kind='fin'and w.owner_member_id=m.member_id and w.archived_at is null and public.can_access_work(w.id,'detail')
 ),filtered as(select * from mine where match_q and(states is null or request_state=any(states)))
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'state',x.request_state,'trackingId',x.tracking_id,'revision',x.current_revision)order by x.updated_at desc,x.id)
    from(select * from filtered order by updated_at desc,id limit 20 offset(p_page-1)*20)x),'[]'),
  'total',(select count(*)from filtered),'page',p_page,'pageSize',20,
  'unfilteredTotal',(select count(*)from mine),
  'facets',jsonb_build_object('states',coalesce((select jsonb_object_agg(request_state,n)from(select request_state,count(*)n from mine where match_q group by 1)s),'{}'::jsonb)))
 into result;
 return result;
end$$;
revoke all on function app_private.p46_read_list_finance_cases(uuid,integer,jsonb) from public,anon,authenticated,service_role;

create function public.list_finance_cases(p_term_id uuid,p_page integer default 1,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=app_private.p46_read_list_finance_cases(p_term_id,p_page,p_filters);
 perform app_private.record_content_read('list_finance_cases',p_term_id,null::uuid,result is not null);
 return result;
end$$;
revoke all on function public.list_finance_cases(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_cases(uuid,integer,jsonb) to authenticated;
update public.restricted_read_endpoints set argument_types='p_term_id uuid, p_page integer, p_filters jsonb' where endpoint='list_finance_cases';

commit;
