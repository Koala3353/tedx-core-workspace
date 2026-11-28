-- Server-side search and filters for the paged lists (tasks, deliverables, inbox, finance plans,
-- reminder recipients), plus the viewer's own committees for the "My committee" default.
--  * Search only narrows rows a list already decided the caller may see. Every list keeps its
--    existing visibility checks unchanged and filters the permitted rows afterwards.
--  * Search is case- and accent-insensitive (app_private.search_text, the packaged unaccent
--    dictionary from 20261030005300) and matches every word anywhere in the searchable fields.
--  * Filters travel in one optional p_filters jsonb argument so existing named-argument calls
--    keep resolving to exactly one function (no PostgREST overload ambiguity).
begin;

do $$begin
  if to_regprocedure('app_private.search_text(text)') is null then
    raise exception using errcode='55000',message='list_search_text_missing';
  end if;
end$$;

-- True when every word of the query appears somewhere in the haystack (any order).
create function app_private.list_search_match(p_haystack text,p_query text)returns boolean
language sql immutable set search_path='' as $$
  select coalesce(bool_and(position(w in coalesce(app_private.search_text(p_haystack),''))>0),true)
  from regexp_split_to_table(btrim(coalesce(app_private.search_text(p_query),'')),'\s+') w
  where w<>''
$$;

-- p_filters.q: trimmed search text, or null when empty. At most 200 characters.
create function app_private.list_filter_query(p_filters jsonb)returns text
language plpgsql immutable set search_path='' as $$
declare q text;begin
  if p_filters is null then return null;end if;
  if jsonb_typeof(p_filters)<>'object' then raise exception using errcode='22023',message='list_invalid_filter';end if;
  if p_filters ? 'q' and jsonb_typeof(p_filters->'q') not in ('string','null') then raise exception using errcode='22023',message='list_invalid_filter';end if;
  q:=btrim(coalesce(p_filters->>'q',''));
  if length(q)>200 then raise exception using errcode='22023',message='list_invalid_filter';end if;
  return nullif(q,'');
end$$;

-- p_filters.units: up to 50 committee ids, or null when absent or empty.
create function app_private.list_filter_units(p_filters jsonb)returns uuid[]
language plpgsql immutable set search_path='' as $$
declare v jsonb;begin
  if p_filters is null then return null;end if;
  if jsonb_typeof(p_filters)<>'object' then raise exception using errcode='22023',message='list_invalid_filter';end if;
  v:=p_filters->'units';
  if v is null or jsonb_typeof(v)='null' then return null;end if;
  if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>50 or exists(select 1 from jsonb_array_elements(v)e
    where jsonb_typeof(e)<>'string' or (e#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='list_invalid_filter';
  end if;
  if jsonb_array_length(v)=0 then return null;end if;
  return (select array_agg(distinct (e#>>'{}')::uuid) from jsonb_array_elements(v)e);
end$$;

-- p_filters.<key>: up to 20 values, each one of p_allowed, or null when absent or empty.
create function app_private.list_filter_values(p_filters jsonb,p_key text,p_allowed text[])returns text[]
language plpgsql immutable set search_path='' as $$
declare v jsonb;begin
  if p_filters is null then return null;end if;
  if jsonb_typeof(p_filters)<>'object' then raise exception using errcode='22023',message='list_invalid_filter';end if;
  v:=p_filters->p_key;
  if v is null or jsonb_typeof(v)='null' then return null;end if;
  if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 or exists(select 1 from jsonb_array_elements(v)e
    where jsonb_typeof(e)<>'string' or not ((e#>>'{}')=any(p_allowed))) then
    raise exception using errcode='22023',message='list_invalid_filter';
  end if;
  if jsonb_array_length(v)=0 then return null;end if;
  return (select array_agg(distinct e#>>'{}') from jsonb_array_elements(v)e);
end$$;

revoke all on function app_private.list_search_match(text,text),app_private.list_filter_query(jsonb),
  app_private.list_filter_units(jsonb),app_private.list_filter_values(jsonb,text,text[])
  from public,anon,authenticated,service_role;

-- The caller's own active committees this term, and whether they manage (head) each one.
-- Only the caller's own memberships; guests and people off the roster get an empty list.
create function public.read_my_units(p_term_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m uuid;begin
  m:=public.current_term_membership(p_term_id);
  if m is null then return jsonb_build_object('units','[]'::jsonb);end if;
  return jsonb_build_object('units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,
      'head',coalesce(public.has_capability(p_term_id,'committee.manage',u.id),false)) order by u.name,u.id)
    from public.org_units u where u.term_id=p_term_id and u.archived_at is null and exists(
      select 1 from public.unit_memberships um where um.unit_id=u.id and um.term_membership_id=m and um.status='active'
        and um.effective_from<=statement_timestamp() and um.effective_to>statement_timestamp())),'[]'::jsonb));
end$$;
revoke all on function public.read_my_units(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_my_units(uuid) to authenticated;

commit;
