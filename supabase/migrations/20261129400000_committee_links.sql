-- Committee quick links (owner request, 2026-11-28): "allow committee heads to dump links in their
-- committee page so the people within their committee have quick access to links."
--
-- Who can do what (per term, per committee):
--  * read:  people with an active deployment in that committee (public.unit_memberships), the
--           committee's heads (committee.manage scoped to the unit) and full admins
--           (admin.configure and roles.manage). Other core members do not see another committee's links.
--  * write (add, edit, pin, reorder, remove): the committee's heads and full admins.
-- The table lives in app_private with RLS forced and every privilege revoked; the only way in is
-- the SECURITY DEFINER functions below. Commands are idempotent per request id
-- (app_private.portal_command_prior/finish) and edits check the row version. Removing archives
-- (archived_at), so nothing is hard-deleted. A committee keeps at most 50 live links.
-- URLs are https only, at most 2000 characters, printable ASCII (clients send the URL()
-- normalised form, which punycodes hosts and percent-encodes the rest), no credentials in the host.
-- Like other portal commands (TEDify sessions, speakers) these rows carry created_by/updated_by
-- instead of public.audit_events, which is keyed to work items.
begin;

create table app_private.committee_links (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  unit_id uuid not null references public.org_units(id),
  title text not null check(title = btrim(title) and length(title) between 1 and 120),
  url text not null check(length(url) between 12 and 2000 and url ~ '^https://'),
  note text check(note is null or (note = btrim(note) and length(note) between 1 and 280)),
  pinned boolean not null default false,
  position integer not null default 0 check(position >= 0),
  archived_at timestamptz,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.term_memberships(id),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.term_memberships(id)
);
create index committee_links_unit on app_private.committee_links(term_id, unit_id, pinned desc, position) where archived_at is null;
create index committee_links_unit_fk on app_private.committee_links(unit_id);
create index committee_links_created_by on app_private.committee_links(created_by);
create index committee_links_updated_by on app_private.committee_links(updated_by);
alter table app_private.committee_links enable row level security;
alter table app_private.committee_links force row level security;
revoke all on app_private.committee_links from public, anon, authenticated, service_role;
create trigger turnover_freeze_guard before insert or update or delete on app_private.committee_links
  for each row execute function app_private.turnover_frozen_guard();

-- The committee is live in this term.
create function app_private.committee_link_unit(p_term uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.org_units u where u.id = p_unit and u.term_id = p_term and u.archived_at is null)
$$;

-- Heads of the committee and full admins.
create function app_private.committee_link_manager(p_term uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.committee_link_unit(p_term, p_unit)
    and (coalesce(public.has_capability(p_term, 'committee.manage', p_unit), false) or app_private.full_admin(p_term))
$$;

-- Managers plus anyone currently deployed in the committee.
create function app_private.committee_link_reader(p_term uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.committee_link_manager(p_term, p_unit) or (app_private.committee_link_unit(p_term, p_unit) and exists(
    select 1 from public.unit_memberships d
    where d.term_membership_id = public.current_term_membership(p_term) and d.term_id = p_term and d.unit_id = p_unit
      and d.status = 'active' and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp()))
$$;

create function app_private.committee_link_json(l app_private.committee_links) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', l.id, 'version', l.version, 'title', l.title, 'url', l.url, 'note', l.note,
    'pinned', l.pinned, 'position', l.position, 'createdAt', l.created_at, 'updatedAt', l.updated_at)
$$;

create function app_private.committee_links_json(p_term uuid, p_unit uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('unitId', p_unit, 'limit', 50,
    'canManage', app_private.committee_link_manager(p_term, p_unit),
    'links', coalesce((select jsonb_agg(app_private.committee_link_json(l) order by l.pinned desc, l.position, l.created_at, l.id)
      from app_private.committee_links l where l.term_id = p_term and l.unit_id = p_unit and l.archived_at is null), '[]'::jsonb),
    'refreshedAt', statement_timestamp())
$$;

-- https only, printable ASCII, a dotted host without credentials, optional port, then path/query/fragment.
create function app_private.committee_link_url(p_url text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_url, ''), E' \t\r\n');
begin
  if v ~* '^https://' then v := 'https://' || substr(v, 9); end if;
  if length(v) > 2000 or v !~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][!-~]*)?$' then
    return null;
  end if;
  return v;
end;
$$;

-- Links for one committee. Denied (42501) for people outside it.
create function public.read_committee_links(p_term_id uuid, p_unit_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.request_actor(p_term_id, false);
  if not app_private.committee_link_reader(p_term_id, p_unit_id) then
    raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  return app_private.committee_links_json(p_term_id, p_unit_id);
end;
$$;

-- The committees the signed-in person is deployed in, with up to p_limit links each (pinned first).
create function public.read_my_committee_links(p_term_id uuid, p_limit integer default 5) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.term_memberships; n integer := least(greatest(coalesce(p_limit, 5), 1), 50);
begin
  m := app_private.request_actor(p_term_id, false);
  return jsonb_build_object('units', coalesce((select jsonb_agg(jsonb_build_object('unitId', u.id, 'code', u.code, 'name', u.name,
      'canManage', app_private.committee_link_manager(p_term_id, u.id),
      'total', (select count(*) from app_private.committee_links l where l.term_id = p_term_id and l.unit_id = u.id and l.archived_at is null),
      'links', coalesce((select jsonb_agg(app_private.committee_link_json(x) order by x.pinned desc, x.position, x.created_at, x.id)
        from (select l.* from app_private.committee_links l where l.term_id = p_term_id and l.unit_id = u.id and l.archived_at is null
          order by l.pinned desc, l.position, l.created_at, l.id limit n) x), '[]'::jsonb)) order by u.name, u.id)
    from public.org_units u
    where u.term_id = p_term_id and u.archived_at is null and exists(select 1 from public.unit_memberships d
      where d.term_membership_id = m.id and d.term_id = p_term_id and d.unit_id = u.id and d.status = 'active'
        and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp())), '[]'::jsonb));
end;
$$;

-- Add (p_link_id null) or edit a link. p_values: {title, url, note?, pinned?, archived?}.
-- Edits need p_expected_version; "archived": true removes the link from the list.
create function public.save_committee_link(p_term_id uuid, p_unit_id uuid, p_link_id uuid, p_values jsonb,
  p_expected_version integer, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.term_memberships; l app_private.committee_links; prior jsonb; payload jsonb;
  v_title text; v_url text; v_note text; v_pinned boolean; archive boolean; live integer;
begin
  actor := app_private.request_actor(p_term_id, true);
  if not app_private.committee_link_manager(p_term_id, p_unit_id) or app_private.disposition_replay_required(p_term_id) then
    raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  payload := jsonb_build_array(p_unit_id, p_link_id, p_values, p_expected_version);
  prior := app_private.portal_command_prior(p_term_id, 'save_committee_link', p_request_id, payload);
  if prior is not null then return prior; end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object'
    or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('title', 'url', 'note', 'pinned', 'archived'))
    or (p_values ? 'pinned' and jsonb_typeof(p_values->'pinned') <> 'boolean')
    or (p_values ? 'archived' and jsonb_typeof(p_values->'archived') <> 'boolean')
    or (p_values ? 'note' and jsonb_typeof(p_values->'note') not in ('string', 'null'))
    or jsonb_typeof(p_values->'title') is distinct from 'string' or jsonb_typeof(p_values->'url') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'command_validation_failed'; end if;
  v_title := btrim(p_values->>'title', E' \t\r\n');
  v_url := app_private.committee_link_url(p_values->>'url');
  v_note := nullif(btrim(coalesce(p_values->>'note', ''), E' \t\r\n'), '');
  v_pinned := coalesce((p_values->>'pinned')::boolean, false);
  archive := coalesce((p_values->>'archived')::boolean, false);
  if coalesce(length(v_title), 0) not between 1 and 120 or v_url is null or coalesce(length(v_note), 0) > 280 then
    raise exception using errcode = '22023', message = 'command_validation_failed'; end if;
  -- One writer per committee at a time, so the 50-link limit and positions stay exact.
  perform pg_advisory_xact_lock(hashtextextended('committee_links:' || p_unit_id::text, 0));
  if p_link_id is null then
    if archive or p_expected_version is not null then raise exception using errcode = '22023', message = 'command_validation_failed'; end if;
    select count(*) into live from app_private.committee_links where term_id = p_term_id and unit_id = p_unit_id and archived_at is null;
    if live >= 50 then raise exception using errcode = '22023', message = 'command_quota_limit'; end if;
    insert into app_private.committee_links(term_id, unit_id, title, url, note, pinned, position, created_by, updated_by)
      values (p_term_id, p_unit_id, v_title, v_url, v_note, v_pinned,
        coalesce((select max(position) + 1 from app_private.committee_links where term_id = p_term_id and unit_id = p_unit_id and archived_at is null), 0),
        actor.id, actor.id)
      returning * into l;
  else
    select * into l from app_private.committee_links where id = p_link_id and term_id = p_term_id and unit_id = p_unit_id and archived_at is null for update;
    if not found then raise exception using errcode = '40001', message = 'command_stale_version'; end if;
    if l.version is distinct from p_expected_version then raise exception using errcode = '40001', message = 'command_stale_version'; end if;
    update app_private.committee_links set title = v_title, url = v_url, note = v_note, pinned = v_pinned,
      archived_at = case when archive then statement_timestamp() end,
      version = version + 1, updated_at = statement_timestamp(), updated_by = actor.id
      where id = l.id returning * into l;
  end if;
  return app_private.portal_command_finish(p_term_id, 'save_committee_link', p_request_id, payload,
    app_private.committee_link_json(l) || jsonb_build_object('archived', l.archived_at is not null));
end;
$$;

-- Set the order of a committee's links. p_order must list every live link exactly once
-- (otherwise the list changed under the caller: 40001). Returns the whole list.
create function public.reorder_committee_links(p_term_id uuid, p_unit_id uuid, p_order uuid[], p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.term_memberships; prior jsonb; payload jsonb;
begin
  actor := app_private.request_actor(p_term_id, true);
  if not app_private.committee_link_manager(p_term_id, p_unit_id) or app_private.disposition_replay_required(p_term_id) then
    raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  payload := jsonb_build_array(p_unit_id, to_jsonb(p_order));
  prior := app_private.portal_command_prior(p_term_id, 'reorder_committee_links', p_request_id, payload);
  if prior is not null then return prior; end if;
  if p_order is null or cardinality(p_order) > 50 or array_position(p_order, null) is not null
    or cardinality(p_order) <> (select count(distinct x) from unnest(p_order) x) then
    raise exception using errcode = '22023', message = 'command_validation_failed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('committee_links:' || p_unit_id::text, 0));
  if exists(select 1 from app_private.committee_links l where l.term_id = p_term_id and l.unit_id = p_unit_id and l.archived_at is null and l.id <> all(p_order))
    or exists(select 1 from unnest(p_order) x where not exists(select 1 from app_private.committee_links l
      where l.id = x and l.term_id = p_term_id and l.unit_id = p_unit_id and l.archived_at is null)) then
    raise exception using errcode = '40001', message = 'command_stale_version'; end if;
  update app_private.committee_links l set position = o.n - 1, version = l.version + 1, updated_at = statement_timestamp(), updated_by = actor.id
    from unnest(p_order) with ordinality o(id, n)
    where l.id = o.id and l.position is distinct from (o.n - 1)::integer;
  return app_private.portal_command_finish(p_term_id, 'reorder_committee_links', p_request_id, payload,
    app_private.committee_links_json(p_term_id, p_unit_id));
end;
$$;

revoke all on function app_private.committee_link_unit(uuid, uuid), app_private.committee_link_manager(uuid, uuid),
  app_private.committee_link_reader(uuid, uuid), app_private.committee_link_json(app_private.committee_links),
  app_private.committee_links_json(uuid, uuid), app_private.committee_link_url(text),
  public.read_committee_links(uuid, uuid), public.read_my_committee_links(uuid, integer),
  public.save_committee_link(uuid, uuid, uuid, jsonb, integer, uuid), public.reorder_committee_links(uuid, uuid, uuid[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_committee_links(uuid, uuid), public.read_my_committee_links(uuid, integer),
  public.save_committee_link(uuid, uuid, uuid, jsonb, integer, uuid), public.reorder_committee_links(uuid, uuid, uuid[], uuid)
  to authenticated;

insert into app_private.disposition_sources(source_key, category, scope_kind, key_columns, query_sql, structure_hash, preserve)
values ('app_private.committee_links', 'operational', 'term', array['id'],
  'select app_private.disposition_key(''app_private.committee_links'',array[x.id::text]) target_hash,
    ''operational'' category,null::uuid root_id,app_private.retention_is_held($1,''operational'',x.id,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.committee_links x where x.term_id=$1',
  app_private.disposition_structure('app_private.committee_links'), false);

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode = '55000', message = 'privacy_disposition_catalog_changed',
      detail = 'A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
