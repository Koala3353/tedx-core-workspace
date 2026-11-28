-- Deliverables: server-side search, several committees at once, and a sort order.
-- list_deliverables(... ten arguments ...) gains an eleventh, p_filters jsonb default '{}'.
-- The old ten-argument function is dropped in the same change, so existing calls without
-- p_filters resolve to the new one and PostgREST never sees two candidates. The read-audit
-- wrapper from 20261109182925 is rebuilt around the new inner reader.
--
-- Visibility is unchanged: `base` is the exact set from the previous reader (term, not archived,
-- can_access_work(...,'summary')), and the phase/owner/blocked/overdue/mine/review/unit filters
-- are copied as they were. Search and the new filters only narrow that set; the filter options
-- (phases, owners, units) still come from `base`, so nothing outside the caller's view is named.
--
-- p_filters: {"q": text, "units": [uuid], "sort": "due" | "title" | "updated" | "committee"}
--  * q matches title, reference (DEL-012), owner name and the lead/supporting committee names.
--  * units keeps a deliverable led by or supported by any of the listed committees.
--  * sort: due (default, soonest first), title (A-Z), updated (most recent first),
--    committee (lead committee A-Z, then due). Ties always fall back to due date, then id.
-- Adds to the result: sort, unfilteredTotal (no filters at all) and facets.units (counts per
-- committee with every filter except the committee ones).
begin;

do $$begin
  if to_regprocedure('app_private.p46_read_list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer)') is null
    or position('p46_read_list_deliverables' in pg_get_functiondef('public.list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer)'::regprocedure))=0 then
    raise exception using errcode='55000',message='list_deliverables_read_audit_missing';
  end if;
end$$;

drop function public.list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer);
drop function app_private.p46_read_list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer);

create function app_private.p46_read_list_deliverables(p_term_id uuid,p_phase text default null,p_unit_id uuid default null,p_owner_id uuid default null,
  p_blocked boolean default false,p_overdue boolean default false,p_involves_my_unit boolean default false,p_review_pending boolean default false,
  p_page integer default 1,p_page_size integer default 20,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;q text;units uuid[];sort text;begin
  if p_page is null or p_page not between 1 and 10000 or p_page_size is null or p_page_size not between 1 and 50
    or (p_phase is not null and length(p_phase)>80) then raise exception using errcode='22023',message='deliverables_invalid_filter'; end if;
  q:=app_private.list_filter_query(coalesce(p_filters,'{}'::jsonb));
  units:=app_private.list_filter_units(coalesce(p_filters,'{}'::jsonb));
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb)->'sort') not in ('string','null') then raise exception using errcode='22023',message='deliverables_invalid_filter';end if;
  sort:=coalesce(nullif(coalesce(p_filters,'{}'::jsonb)->>'sort',''),'due');
  if sort not in ('due','title','updated','committee') then raise exception using errcode='22023',message='deliverables_invalid_filter';end if;
  with base as materialized (
    select w.id,w.title,w.owner_member_id,w.owner_display_name,w.lead_unit_id,w.due_at,w.due_on,d.phase_key,d.is_blocked,
      app_private.deliverable_summary(w,d) as summary
    from public.work_items w join public.deliverables d on d.work_item_id=w.id
    where w.term_id=p_term_id and w.archived_at is null and public.can_access_work(w.id,'summary')
  ), marked as materialized (
    select b.*,lu.name as lead_unit_name,
      (select coalesce(array_agg(du.unit_id),'{}') from public.deliverable_units du where du.work_item_id=b.id) as supporting_ids,
      ((p_phase is null or b.phase_key=p_phase)
      and (p_owner_id is null or b.owner_member_id=p_owner_id)
      and (not coalesce(p_blocked,false) or(b.summary->>'blocked')::boolean)
      and (not coalesce(p_overdue,false) or (b.summary->>'overdue')::boolean)
      and (not coalesce(p_review_pending,false) or b.summary->>'readiness'='ready_for_acceptance'or(b.summary->>'reviewRequired')::boolean or b.summary->'gates'->>'finance'='pending'or b.summary->'gates'->>'publicity'='pending')
      and (not coalesce(p_involves_my_unit,false) or exists(select 1 from public.unit_memberships um join public.org_units u on u.id=um.unit_id and u.archived_at is null
        where um.term_membership_id=public.current_term_membership(p_term_id) and um.status='active' and um.effective_from<=statement_timestamp() and um.effective_to>statement_timestamp()
          and (um.unit_id=b.lead_unit_id or exists(select 1 from public.deliverable_units du where du.work_item_id=b.id and du.unit_id=um.unit_id))))
      and (q is null or app_private.list_search_match(concat_ws(' ',b.title,b.summary->'reference'->>'value',b.owner_display_name,lu.name,
        (select string_agg(u.name,' ') from public.deliverable_units du join public.org_units u on u.id=du.unit_id where du.work_item_id=b.id)),q))) as match_rest,
      (p_unit_id is null or b.lead_unit_id=p_unit_id or exists(select 1 from public.deliverable_units du where du.work_item_id=b.id and du.unit_id=p_unit_id)) as match_unit,
      (units is null or b.lead_unit_id=any(units) or exists(select 1 from public.deliverable_units du where du.work_item_id=b.id and du.unit_id=any(units))) as match_units
    from base b left join public.org_units lu on lu.id=b.lead_unit_id
  ), filtered as (
    select * from marked where match_rest and match_unit and match_units
  ), ranked as (
    select f.*,row_number() over (order by
      case when sort='title' then lower(f.title) end,
      case when sort='committee' then lower(f.lead_unit_name) end nulls last,
      case when sort='updated' then (f.summary->>'updatedAt')::timestamptz end desc nulls last,
      coalesce(f.due_at,(f.due_on+1)::timestamp at time zone 'Asia/Manila') nulls last,f.id) as n
    from filtered f
  ), page as (select * from ranked where n>(p_page-1)*p_page_size and n<=p_page*p_page_size)
  select jsonb_build_object('items',coalesce((select jsonb_agg(summary order by n) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,'sort',sort,
    'unfilteredTotal',(select count(*) from base),
    'facets',jsonb_build_object('units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'count',x.n) order by u.name,u.id)
      from (select unit_id,count(distinct m.id) n from marked m cross join lateral unnest(array[m.lead_unit_id]||m.supporting_ids) unit_id
        where m.match_rest and unit_id is not null group by unit_id) x join public.org_units u on u.id=x.unit_id),'[]'::jsonb)),
    'options',jsonb_build_object(
      'phases',coalesce((select jsonb_agg(phase_key order by phase_key) from(select distinct phase_key from base where phase_key is not null)x),'[]'::jsonb),
      'owners',coalesce((select jsonb_agg(jsonb_build_object('id',owner_member_id,'name',name) order by name,owner_member_id)
        from(select owner_member_id,min(owner_display_name) as name from base group by owner_member_id)x),'[]'::jsonb),
      'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) order by u.name,u.id) from public.org_units u where u.term_id=p_term_id and exists(
        select 1 from base b where b.lead_unit_id=u.id or exists(select 1 from public.deliverable_units du where du.work_item_id=b.id and du.unit_id=u.id))),'[]'::jsonb)))
  into result;
  return result;
end $$;
revoke all on function app_private.p46_read_list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer,jsonb) from public,anon,authenticated,service_role;

create function public.list_deliverables(p_term_id uuid,p_phase text default null,p_unit_id uuid default null,p_owner_id uuid default null,
  p_blocked boolean default false,p_overdue boolean default false,p_involves_my_unit boolean default false,p_review_pending boolean default false,
  p_page integer default 1,p_page_size integer default 20,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
  result:=app_private.p46_read_list_deliverables(p_term_id,p_phase,p_unit_id,p_owner_id,p_blocked,p_overdue,p_involves_my_unit,p_review_pending,p_page,p_page_size,p_filters);
  perform app_private.record_content_read('list_deliverables',p_term_id,null::uuid,result is not null);
  return result;
end$$;
revoke all on function public.list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_deliverables(uuid,text,uuid,uuid,boolean,boolean,boolean,boolean,integer,integer,jsonb) to authenticated;
update public.restricted_read_endpoints
  set argument_types='p_term_id uuid, p_phase text, p_unit_id uuid, p_owner_id uuid, p_blocked boolean, p_overdue boolean, p_involves_my_unit boolean, p_review_pending boolean, p_page integer, p_page_size integer, p_filters jsonb'
  where endpoint='list_deliverables';

commit;
