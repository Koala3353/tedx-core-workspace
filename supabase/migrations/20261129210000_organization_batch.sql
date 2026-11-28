-- Batch organization changes: publish several placement / roster / seat changes at once.
--  * Each item is the same payload the single commands take, and is applied through the single
--    functions themselves (publish_organization_change, save_tedx_seat), so validation, blocking
--    rules, organization_changes rows, audit_events, outbox jobs and seat history are identical.
--      {"kind":"organization","action":"deployment_save","values":{...}}
--      {"kind":"seat","seatId":uuid|null,"expectedVersion":int|null,"membershipId":uuid,"roleId":uuid,
--       "from":timestamptz,"to":timestamptz,"remove":bool}
--  * Items run in order inside one transaction, so a later item sees earlier ones (end a placement,
--    then start the new one).
--  * All or nothing. Every item is tried; if any fails, everything is rolled back and the caller gets
--    a per-item report ({ok:false, errors:[{index,code,message}]}) instead of an exception.
--  * preview_organization_batch runs the same sequence and always rolls it back. It returns the
--    per-item impact plus a batch fingerprint of the starting structure and payload; publishing
--    checks that fingerprint and the organization version, like the single publish does.
--  * Same permission as the single commands: organization_actor (admin.configure + roles.manage),
--    active term for writes.
begin;

create function app_private.organization_batch_apply(p_term_id uuid, p_items jsonb, p_reason text, p_request_id uuid, p_simulate boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; idx bigint; kind text; impact jsonb; receipt jsonb; key uuid;
  results jsonb := '[]'::jsonb; errors jsonb := '[]'::jsonb;
  start_version integer; fingerprint text;
begin
  select coalesce(wi.version, 0) into start_version
    from public.organization_control c join public.work_items wi on wi.id = c.work_item_id where c.term_id = p_term_id;
  start_version := coalesce(start_version, 0);
  -- Fingerprint of the starting structure plus the whole payload (generated ids make later states unrepeatable).
  fingerprint := app_private.organization_fingerprint(p_term_id, 'organization_batch', p_items);
  for item, idx in select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
    kind := case when jsonb_typeof(item) = 'object' then coalesce(item->>'kind', 'organization') end;
    key := case when p_simulate then gen_random_uuid() else md5(p_request_id::text || ':' || idx::text)::uuid end;
    impact := null;
    begin
      if kind = 'organization' then
        if item->>'action' is null or jsonb_typeof(item->'values') is distinct from 'object' then
          raise exception using errcode = '22023', message = 'command_validation_failed';
        end if;
        impact := public.preview_organization_change(p_term_id, item->>'action', item->'values');
        if (impact->>'blocked')::boolean then
          raise exception using errcode = '55000', message = 'command_dependency_blocked';
        end if;
        receipt := public.publish_organization_change(p_term_id, item->>'action', item->'values',
          (impact->>'version')::integer, impact->>'fingerprint', p_reason, key);
      elsif kind = 'seat' then
        receipt := public.save_tedx_seat(p_term_id, nullif(item->>'seatId', '')::uuid, (item->>'expectedVersion')::integer,
          (item->>'membershipId')::uuid, (item->>'roleId')::uuid, (item->>'from')::timestamptz, (item->>'to')::timestamptz,
          coalesce((item->>'remove')::boolean, false), p_reason, key);
      else
        raise exception using errcode = '22023', message = 'command_validation_failed';
      end if;
      results := results || jsonb_build_array(jsonb_build_object('index', idx - 1, 'kind', kind, 'ok', true,
        'id', receipt->>'id', 'impact', impact));
    exception when others then
      -- The failed item's own work is undone by this block; the caller decides about the rest.
      errors := errors || jsonb_build_array(jsonb_build_object('index', idx - 1, 'code', sqlstate, 'message', sqlerrm));
      results := results || jsonb_build_array(jsonb_build_object('index', idx - 1, 'kind', kind, 'ok', false,
        'code', sqlstate, 'message', sqlerrm, 'impact', impact));
    end;
  end loop;
  return jsonb_build_object('version', start_version, 'fingerprint', fingerprint, 'items', results, 'errors', errors);
end;
$$;
revoke all on function app_private.organization_batch_apply(uuid, jsonb, text, uuid, boolean) from public, anon, authenticated, service_role;

create function public.preview_organization_batch(p_term_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare report jsonb;
begin
  perform app_private.readiness_lock(p_term_id);
  perform app_private.organization_actor(p_term_id, true);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  begin
    report := app_private.organization_batch_apply(p_term_id, p_items, 'Batch preview', null, true);
    raise exception using errcode = 'P0001', message = 'organization_batch_rollback';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'organization_batch_rollback' then raise; end if;
  end;
  perform app_private.record_content_read('preview_organization_change', p_term_id, null::uuid, true);
  return report || jsonb_build_object('blocked', jsonb_array_length(report->'errors') > 0);
end;
$$;
revoke all on function public.preview_organization_batch(uuid, jsonb) from public, anon;
grant execute on function public.preview_organization_batch(uuid, jsonb) to authenticated;

create function public.publish_organization_batch(p_term_id uuid, p_items jsonb, p_expected_version integer,
  p_fingerprint text, p_reason text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.term_memberships; payload jsonb; receipt jsonb; report jsonb; failed boolean := false; final_version integer;
begin
  perform app_private.readiness_lock(p_term_id);
  actor := app_private.organization_actor(p_term_id, true);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100
    or p_expected_version is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  payload := jsonb_build_array(p_term_id, p_items, p_expected_version, p_fingerprint, btrim(p_reason));
  receipt := app_private.begin_work_command('publish_organization_batch', p_request_id, payload);
  if receipt is not null then return receipt; end if;
  begin
    report := app_private.organization_batch_apply(p_term_id, p_items, btrim(p_reason), p_request_id, false);
    if jsonb_array_length(report->'errors') > 0 or (report->>'version')::integer <> p_expected_version
      or report->>'fingerprint' <> p_fingerprint then
      raise exception using errcode = 'P0001', message = 'organization_batch_rollback';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'organization_batch_rollback' then raise; end if;
    failed := true;
  end;
  if failed then
    -- Nothing was kept. Report each item so the admin can fix the rows that failed.
    return jsonb_build_object('ok', false, 'stale', jsonb_array_length(report->'errors') = 0,
      'errors', report->'errors',
      'items', (select coalesce(jsonb_agg(i - 'impact' order by (i->>'index')::integer), '[]'::jsonb) from jsonb_array_elements(report->'items') i));
  end if;
  select wi.version into final_version
    from public.organization_control c join public.work_items wi on wi.id = c.work_item_id where c.term_id = p_term_id;
  receipt := jsonb_build_object('ok', true, 'version', coalesce(final_version, 0), 'count', jsonb_array_length(p_items),
    'ids', (select coalesce(jsonb_agg(i->'id' order by (i->>'index')::integer), '[]'::jsonb) from jsonb_array_elements(report->'items') i));
  insert into public.idempotency_keys(actor_id, command, client_key, organization_id, term_id, payload_hash, result_reference)
    values(auth.uid(), 'publish_organization_batch', p_request_id, actor.organization_id, p_term_id,
      encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'), receipt);
  return receipt;
end;
$$;
revoke all on function public.publish_organization_batch(uuid, jsonb, integer, text, text, uuid) from public, anon;
grant execute on function public.publish_organization_batch(uuid, jsonb, integer, text, text, uuid) to authenticated;

commit;
