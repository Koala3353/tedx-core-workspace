-- Single-admin "Open service" for request services (owner decision, 2026-11-26).
-- A full admin (admin.configure and roles.manage) opens or closes a request service alone once its
-- receiving committee, two contacts and lead time are set. Opening:
--  * binds FIN and MCD services to the FIN and MCD units when still unbound;
--  * publishes a one-step review workflow when the current one cannot run (the seeded templates have
--    no reviewer and no final outcome), pinned to a reviewer of the receiving committee;
--  * for FIN and MCD, records the reviewer designations (the chosen reviewer plus every other FIN or
--    MCD member as alternates) and the single-step policy those review modules require;
--  * for FIN, records the finance privacy category when it is missing (owner: the FIN reviewer,
--    approved by the admin);
--  * sets authority_confirmed and live_enabled, and re-pins drafts created while the service was
--    closed so they can be submitted.
-- Every change is recorded in app_private.single_admin_actions (who, when, what).
begin;

-- Unit-scoped review authority of one member, before any FIN or MCD designation exists.
create function app_private.service_authority(p_term uuid, p_member uuid, p_unit uuid, p_capability text) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from app_private.effective_role_assignments a
  join public.roles role on role.id = a.role_id and role.state = 'active'
  join public.role_permissions rp on rp.role_id = role.id and rp.capability = p_capability and rp.allowed_scope = 'unit'
  join public.term_memberships tm on tm.id = a.term_membership_id
  join public.members person on person.id = tm.member_id
  join public.org_units u on u.id = a.unit_id and u.archived_at is null and u.review_service
  where a.term_id = p_term and a.term_membership_id = p_member and a.unit_id = p_unit and a.scope_type = 'unit'
    and a.status = 'active' and a.effective_from <= statement_timestamp() and a.effective_to > statement_timestamp()
    and tm.status = 'active' and tm.membership_kind = 'core' and tm.joined_at <= statement_timestamp()
    and tm.ends_at > statement_timestamp() and person.account_state = 'active' and person.auth_user_id is not null
    and exists (select 1 from public.unit_memberships d where d.term_membership_id = tm.id and d.unit_id = p_unit
      and d.status = 'active' and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp())
  order by a.id limit 1
$$;

create function app_private.service_capability(t public.request_types) returns text
language sql immutable set search_path = '' as $$
  select case t.governed_kind when 'fin' then 'finance.review' when 'mcd' then 'mcd.review' else 'department.review' end
$$;

-- Reviewer pinned in the workflow: a contact of the receiving committee with review authority.
-- Order: primary contact, backup contact, then committee heads.
create function app_private.service_reviewer(t public.request_types) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.member from (
    select t.primary_contact_id as member, 1 as rank
    union all select t.backup_contact_id, 2
    union all select d.term_membership_id, 3 from public.unit_memberships d
      where d.unit_id = t.receiving_unit_id and d.deployment_type = 'head' and d.status = 'active'
        and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp()
  ) c
  where c.member is not null and app_private.request_contact_active(t, c.member)
    and case when t.governed_kind = 'general'
      then app_private.workflow_role(t.term_id, c.member, t.receiving_unit_id) is not null
      else app_private.service_authority(t.term_id, c.member, t.receiving_unit_id, app_private.service_capability(t)) is not null end
  order by c.rank, c.member limit 1
$$;

create function app_private.service_open_problems(t public.request_types) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare problems text[] := '{}';
begin
  if t.receiving_unit_id is null or not exists (select 1 from public.org_units u where u.id = t.receiving_unit_id and u.archived_at is null) then
    problems := problems || 'committee'::text;
  elsif not exists (select 1 from public.org_units u where u.id = t.receiving_unit_id and u.review_service) then
    problems := problems || 'review_service'::text;
  end if;
  if t.primary_contact_id is null or t.backup_contact_id is null or t.primary_contact_id = t.backup_contact_id
    or not app_private.request_contact_active(t, t.primary_contact_id) or not app_private.request_contact_active(t, t.backup_contact_id) then
    problems := problems || 'contacts'::text;
  end if;
  if t.lead_time_days is null then problems := problems || 'lead_time'::text; end if;
  if not exists (select 1 from public.form_versions f where f.id = t.form_version_id and f.state = 'published') then
    problems := problems || 'form'::text;
  end if;
  if cardinality(problems) = 0 and app_private.service_reviewer(t) is null then problems := problems || 'reviewer'::text; end if;
  if t.governed_kind = 'fin' and not app_private.sensitive_category_ready(t.term_id, 'finance')
    and exists (select 1 from public.privacy_sensitive_categories c where c.term_id = t.term_id and c.category = 'finance') then
    problems := problems || 'finance_privacy'::text;
  end if;
  return problems;
end;
$$;

-- The current workflow can run as is: every stage has a live reviewer and the last stage decides.
create function app_private.service_workflow_usable(t public.request_types) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; s jsonb; idx integer := 0; total integer; person text;
begin
  select definition_json into v from public.workflow_versions where id = t.workflow_version_id and state = 'published';
  if v is null then return false; end if;
  total := jsonb_array_length(v->'stages');
  if t.governed_kind <> 'general' then
    s := v->'stages'->0;
    return total = 1 and s->>'review' = 'one' and s->>'outcome' = 'approved' and jsonb_array_length(s->'reviewers') = 1
      and app_private.request_contact_active(t, (s->'reviewers'->>0)::uuid)
      and app_private.service_authority(t.term_id, (s->'reviewers'->>0)::uuid, t.receiving_unit_id, app_private.service_capability(t)) is not null;
  end if;
  for s in select value from jsonb_array_elements(v->'stages') loop
    idx := idx + 1;
    if s->>'review' not in ('one', 'all') or jsonb_array_length(s->'reviewers') = 0
      or (idx < total and s->>'outcome' <> 'pending') or (idx = total and s->>'outcome' = 'pending') then return false; end if;
    for person in select value from jsonb_array_elements_text(s->'reviewers') loop
      if app_private.workflow_role(t.term_id, person::uuid, t.receiving_unit_id) is null
        or not app_private.request_contact_active(t, person::uuid) then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create function app_private.service_setup_json(t public.request_types) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'typeId', t.id, 'open', t.live_enabled and t.authority_confirmed,
    'problems', to_jsonb(app_private.service_open_problems(t)),
    'reviewerName', (select person.display_name from public.term_memberships tm join public.members person on person.id = tm.member_id
      where tm.id = app_private.service_reviewer(t)),
    'lastChange', (select jsonb_build_object('action', a.action, 'by', person.display_name, 'at', a.recorded_at)
      from app_private.single_admin_actions a
      left join public.term_memberships tm on tm.id = a.actor_membership_id left join public.members person on person.id = tm.member_id
      where a.target_id = t.id and a.action in ('service_opened', 'service_closed') order by a.recorded_at desc limit 1))
$$;

create function public.read_request_service_setup(p_type_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.request_types;
begin
  select * into t from public.request_types where id = p_type_id and archived_at is null;
  if not found then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  perform app_private.request_actor(t.term_id);
  if not app_private.full_admin(t.term_id) then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  return app_private.service_setup_json(t);
end;
$$;

create function public.set_request_service_open(p_type_id uuid, p_open boolean, p_reason text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.request_types;
  m public.term_memberships;
  problems text[];
  payload jsonb;
  receipt jsonb;
  reviewer uuid;
  primary_authority uuid;
  alternate record;
  term_end timestamptz;
  unit_name text;
  workflow_id uuid;
  policy_id uuid;
  n integer;
  privacy_owner uuid;
  reference text;
  repinned integer := 0;
begin
  select * into t from public.request_types where id = p_type_id and archived_at is null;
  if not found then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  perform app_private.readiness_lock(t.term_id);
  m := app_private.request_actor(t.term_id, true);
  if not app_private.full_admin(t.term_id) then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  if p_open is null or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  payload := jsonb_build_array(p_type_id, p_open, btrim(p_reason));
  receipt := app_private.begin_work_command('set_request_service_open', p_request_id, payload);
  if receipt is not null then return receipt; end if;
  select * into t from public.request_types where id = p_type_id for update;
  select ((closes_on + 1)::timestamp at time zone 'Asia/Manila') into term_end from public.terms where id = t.term_id;
  reference := 'Opened in Service setup by ' || (select display_name from public.members where id = m.member_id) || ': ' || btrim(p_reason);

  if not p_open then
    if t.live_enabled then
      update public.request_types set live_enabled = false where id = t.id returning * into t;
      insert into app_private.single_admin_actions(term_id, actor_membership_id, actor_user_id, action, target_id, reason)
        values (t.term_id, m.id, auth.uid(), 'service_closed', t.id, btrim(p_reason));
    end if;
  else
    -- Protected services always route to their own review unit.
    if t.governed_kind <> 'general' and t.receiving_unit_id is null
      and not exists (select 1 from public.requests r where r.request_type_id = t.id and r.current_revision > 0) then
      update public.request_types set receiving_unit_id = (select u.id from public.org_units u where u.term_id = t.term_id
        and u.archived_at is null and u.code = case t.governed_kind when 'fin' then 'FIN' else 'MCD' end)
        where id = t.id returning * into t;
    end if;
    problems := app_private.service_open_problems(t);
    if cardinality(problems) > 0 then
      return app_private.service_setup_json(t) || jsonb_build_object('changed', false);
    end if;

    -- Workflow: keep a runnable one, otherwise publish a one-step review pinned to the reviewer.
    if app_private.service_workflow_usable(t) then
      reviewer := case when t.governed_kind = 'general' then app_private.service_reviewer(t)
        else ((select definition_json from public.workflow_versions where id = t.workflow_version_id)->'stages'->0->'reviewers'->>0)::uuid end;
    else
      reviewer := app_private.service_reviewer(t);
      select coalesce(max(version), 0) + 1 into n from public.workflow_versions where request_type_id = t.id;
      insert into public.workflow_versions(request_type_id, version, state, published_at, definition_json)
        values (t.id, n, 'published', statement_timestamp(), jsonb_build_object('schemaVersion', 1, 'stages', jsonb_build_array(
          jsonb_build_object('key', 'review', 'label', case t.governed_kind when 'fin' then 'FIN review' when 'mcd' then 'MCD review' else 'Committee review' end,
            'review', 'one', 'reviewers', jsonb_build_array(reviewer), 'outcome', 'approved', 'revisionStage', 'review',
            'entryFields', '[]'::jsonb, 'reminderDays', 3))))
        returning id into workflow_id;
      update public.request_types set workflow_version_id = workflow_id where id = t.id returning * into t;
    end if;

    if t.governed_kind in ('fin', 'mcd') then
      primary_authority := app_private.service_authority(t.term_id, reviewer, t.receiving_unit_id, app_private.service_capability(t));
      if t.governed_kind = 'fin' then
        insert into public.finance_authority_designations(authority_id, authority_version, alternate_for_id, official_reference, confirmed_by, effective_from, effective_to)
          select a.id, a.version, null, reference, m.id, statement_timestamp(), least(term_end, a.effective_to) from public.role_assignments a where a.id = primary_authority
          on conflict (authority_id) do update set authority_version = excluded.authority_version, alternate_for_id = null,
            official_reference = excluded.official_reference, confirmed_by = excluded.confirmed_by,
            effective_from = excluded.effective_from, effective_to = excluded.effective_to;
      else
        insert into public.publicity_authority_designations(authority_id, authority_version, alternate_for_id, official_reference, confirmed_by, effective_from, effective_to)
          select a.id, a.version, null, reference, m.id, statement_timestamp(), least(term_end, a.effective_to) from public.role_assignments a where a.id = primary_authority
          on conflict (authority_id) do update set authority_version = excluded.authority_version, alternate_for_id = null,
            official_reference = excluded.official_reference, confirmed_by = excluded.confirmed_by,
            effective_from = excluded.effective_from, effective_to = excluded.effective_to;
      end if;
      -- Every other member of the review unit with the same authority reviews as an alternate.
      for alternate in
        select distinct on (d.term_membership_id) d.term_membership_id as member,
          app_private.service_authority(t.term_id, d.term_membership_id, t.receiving_unit_id, app_private.service_capability(t)) as authority
        from public.unit_memberships d
        where d.unit_id = t.receiving_unit_id and d.status = 'active' and d.term_membership_id <> reviewer
          and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp()
      loop
        if alternate.authority is null then continue; end if;
        if t.governed_kind = 'fin' then
          insert into public.finance_authority_designations(authority_id, authority_version, alternate_for_id, official_reference, confirmed_by, effective_from, effective_to)
            select a.id, a.version, primary_authority, reference, m.id, statement_timestamp(), least(term_end, a.effective_to) from public.role_assignments a where a.id = alternate.authority
            on conflict (authority_id) do update set authority_version = excluded.authority_version, alternate_for_id = excluded.alternate_for_id,
              official_reference = excluded.official_reference, confirmed_by = excluded.confirmed_by,
              effective_from = excluded.effective_from, effective_to = excluded.effective_to;
        else
          insert into public.publicity_authority_designations(authority_id, authority_version, alternate_for_id, official_reference, confirmed_by, effective_from, effective_to)
            select a.id, a.version, primary_authority, reference, m.id, statement_timestamp(), least(term_end, a.effective_to) from public.role_assignments a where a.id = alternate.authority
            on conflict (authority_id) do update set authority_version = excluded.authority_version, alternate_for_id = excluded.alternate_for_id,
              official_reference = excluded.official_reference, confirmed_by = excluded.confirmed_by,
              effective_from = excluded.effective_from, effective_to = excluded.effective_to;
        end if;
      end loop;
      if t.governed_kind = 'fin' then
        select coalesce(max(version), 0) + 1 into n from public.finance_authorization_policies where request_type_id = t.id and workflow_version_id = t.workflow_version_id;
        insert into public.finance_authorization_policies(organization_id, term_id, request_type_id, workflow_version_id, version, stage_key,
          primary_authority_id, external_requirement, official_reference, confirmed_by, effective_from, effective_to)
          values (t.organization_id, t.term_id, t.id, t.workflow_version_id, n,
            (select definition_json->'stages'->0->>'key' from public.workflow_versions where id = t.workflow_version_id),
            primary_authority, 'not_required', reference, m.id, statement_timestamp(), term_end)
          returning id into policy_id;
      else
        select coalesce(max(version), 0) + 1 into n from public.publicity_review_policies where request_type_id = t.id and workflow_version_id = t.workflow_version_id;
        insert into public.publicity_review_policies(organization_id, term_id, request_type_id, workflow_version_id, version, stage_key,
          primary_authority_id, official_reference, confirmed_by, effective_from, effective_to)
          values (t.organization_id, t.term_id, t.id, t.workflow_version_id, n,
            (select definition_json->'stages'->0->>'key' from public.workflow_versions where id = t.workflow_version_id),
            primary_authority, reference, m.id, statement_timestamp(), term_end)
          returning id into policy_id;
      end if;
    end if;

    -- FIN collects restricted money details, which needs the finance privacy category.
    if t.governed_kind = 'fin' and not app_private.sensitive_category_ready(t.term_id, 'finance') then
      select c.member into privacy_owner from (
        select reviewer as member, 1 as rank
        union all select d.term_membership_id, 2 from public.unit_memberships d
          where d.unit_id = t.receiving_unit_id and d.status = 'active'
            and d.effective_from <= statement_timestamp() and d.effective_to > statement_timestamp()
      ) c join public.term_memberships tm on tm.id = c.member join public.members person on person.id = tm.member_id
      where tm.member_id <> m.member_id and person.auth_user_id is not null and person.account_state = 'active'
      order by c.rank, c.member limit 1;
      if privacy_owner is null then
        raise exception using errcode = '55000', message = 'finance_privacy_owner_required';
      end if;
      insert into public.privacy_sensitive_categories(term_id, category, owner_membership_id, basis_reference, retention_reference,
        retention_definition, max_emergency_minutes, approved_by, expires_at)
        values (t.term_id, 'finance', privacy_owner,
          'FIN reviews budget, expense, reimbursement and fundraising requests for this term.',
          'Kept for the term, then reviewed for archive.',
          jsonb_build_object('version', 1, 'rules', jsonb_build_array(jsonb_build_object('category', 'finance',
            'owner', 'FIN reviewer', 'basis', 'Needed to review and account for event money.', 'days', 365, 'action', 'archive_review'))),
          15, m.id, term_end)
        on conflict (term_id, category) do nothing;
      insert into app_private.single_admin_actions(term_id, actor_membership_id, actor_user_id, action, target_id, detail, reason)
        values (t.term_id, m.id, auth.uid(), 'finance_privacy_recorded', t.id, jsonb_build_object('ownerMembershipId', privacy_owner), btrim(p_reason));
    end if;

    update public.request_types set authority_confirmed = true, live_enabled = true where id = t.id returning * into t;
    insert into app_private.single_admin_actions(term_id, actor_membership_id, actor_user_id, action, target_id, detail, reason)
      values (t.term_id, m.id, auth.uid(), 'service_opened', t.id, jsonb_build_object('txid', txid_current()::text,
        'workflowVersionId', t.workflow_version_id, 'reviewerMembershipId', reviewer, 'policyId', policy_id), btrim(p_reason));

    -- Drafts started while the service was closed follow the service as it is now.
    select u.name into unit_name from public.org_units u where u.id = t.receiving_unit_id;
    update public.requests r set workflow_version_id = t.workflow_version_id, receiving_unit_id = t.receiving_unit_id, service_label = unit_name
      where r.request_type_id = t.id and r.request_state = 'draft' and r.current_revision = 0 and r.tracking_id is null
        and (r.workflow_version_id is distinct from t.workflow_version_id or r.receiving_unit_id is distinct from t.receiving_unit_id
          or r.service_label is distinct from unit_name);
    get diagnostics repinned = row_count;
  end if;

  receipt := app_private.service_setup_json(t) || jsonb_build_object('changed', true, 'draftsUpdated', repinned);
  insert into public.idempotency_keys(actor_id, command, client_key, organization_id, term_id, payload_hash, result_reference)
    values (auth.uid(), 'set_request_service_open', p_request_id, t.organization_id, t.term_id,
      encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'), receipt);
  return receipt;
end;
$$;

-- Drafts may follow the service routing only inside the "Open service" command that recorded it.
create or replace function app_private.request_spine_guard()returns trigger language plpgsql set search_path='' as $$
declare allowed_form boolean:=false;allowed_route boolean:=false;begin
 if tg_op='DELETE'then if old.request_type_id is not null then raise exception using errcode='55000',message='command_submitted_immutable';end if;return old;end if;
 if new.form_version_id is distinct from old.form_version_id then
  allowed_form:=old.request_state='draft'and new.request_state='draft'and old.current_revision=0 and new.current_revision=0 and old.tracking_id is null and new.tracking_id is null
   and not exists(select 1 from public.request_revisions where request_id=old.work_item_id)
   and exists(select 1 from public.request_form_migrations e where e.request_id=old.work_item_id and e.source_form_version_id=old.form_version_id and e.target_form_version_id=new.form_version_id and e.workflow_version_id=old.workflow_version_id and e.actor_id=auth.uid()and e.transition_txid=txid_current()and e.expected_work_version=(select version from public.work_items where id=old.work_item_id));
 end if;
 if old.request_type_id is not null and(new.workflow_version_id is distinct from old.workflow_version_id or new.receiving_unit_id is distinct from old.receiving_unit_id or new.service_label is distinct from old.service_label)then
  allowed_route:=old.request_state='draft'and new.request_state='draft'and old.current_revision=0 and new.current_revision=0 and old.tracking_id is null and new.tracking_id is null
   and new.request_type_id=old.request_type_id and new.form_version_id is not distinct from old.form_version_id
   and not exists(select 1 from public.request_revisions where request_id=old.work_item_id)
   and exists(select 1 from public.request_types t where t.id=old.request_type_id and t.live_enabled and t.workflow_version_id=new.workflow_version_id and t.receiving_unit_id=new.receiving_unit_id)
   and exists(select 1 from app_private.single_admin_actions a where a.action='service_opened'and a.target_id=old.request_type_id and a.actor_user_id=auth.uid()and a.detail->>'txid'=txid_current()::text);
 end if;
 if old.request_type_id is not null and(new.request_type_id is distinct from old.request_type_id or(new.form_version_id is distinct from old.form_version_id and not allowed_form)or(new.workflow_version_id<>old.workflow_version_id and not allowed_route)or(new.receiving_unit_id is distinct from old.receiving_unit_id and not allowed_route)or new.payload_classification<>old.payload_classification or new.type_label<>old.type_label or(new.service_label is distinct from old.service_label and not allowed_route)or old.tracking_id is not null and(new.tracking_id is distinct from old.tracking_id or new.tracking_counter_id is distinct from old.tracking_counter_id or new.sequence_no is distinct from old.sequence_no or new.tracking_prefix_snapshot is distinct from old.tracking_prefix_snapshot or new.original_requested_on is distinct from old.original_requested_on))then raise exception using errcode='55000',message='command_submitted_immutable';end if;return new;
end$$;

-- FIN and MCD services count as ready once their confirmed single-step policy exists.
create or replace function app_private.request_service_ready(t public.request_types) returns boolean
language sql stable security definer set search_path='' as $$
 select t.live_enabled and t.authority_confirmed and t.archived_at is null
 and exists(select 1 from public.terms where id=t.term_id and state='active')
 and exists(select 1 from public.org_units where id=t.receiving_unit_id and term_id=t.term_id and archived_at is null and review_service)
 and app_private.request_contact_active(t,t.primary_contact_id) and app_private.request_contact_active(t,t.backup_contact_id)
 and exists(select 1 from public.form_versions where id=t.form_version_id and state='published') and exists(select 1 from public.workflow_versions where id=t.workflow_version_id and state='published')
 and not exists(select 1 from public.workflow_versions v cross join lateral jsonb_array_elements(v.definition_json->'stages') s where v.id=t.workflow_version_id and (
  (s->>'review'<>'none' and jsonb_array_length(s->'reviewers')=0)
  or exists(select 1 from jsonb_array_elements_text(s->'reviewers') r where not app_private.request_contact_active(t,r::uuid))
  or exists(select 1 from jsonb_array_elements_text(s->'entryFields') k where not exists(select 1 from public.form_versions f cross join lateral jsonb_array_elements(f.schema_json->'fields') field where f.id=t.form_version_id and field->>'key'=k))))
 and(t.governed_kind='general'
  or(t.governed_kind='fin'and exists(select 1 from public.finance_authorization_policies p where p.request_type_id=t.id and p.workflow_version_id=t.workflow_version_id and p.effective_from<=statement_timestamp()and p.effective_to>statement_timestamp()))
  or(t.governed_kind='mcd'and exists(select 1 from public.publicity_review_policies p where p.request_type_id=t.id and p.workflow_version_id=t.workflow_version_id and p.effective_from<=statement_timestamp()and p.effective_to>statement_timestamp())))
$$;

revoke all on function app_private.service_authority(uuid,uuid,uuid,text), app_private.service_capability(public.request_types),
  app_private.service_reviewer(public.request_types), app_private.service_open_problems(public.request_types),
  app_private.service_workflow_usable(public.request_types), app_private.service_setup_json(public.request_types),
  app_private.request_spine_guard(), app_private.request_service_ready(public.request_types),
  public.read_request_service_setup(uuid), public.set_request_service_open(uuid,boolean,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_request_service_setup(uuid), public.set_request_service_open(uuid,boolean,text,uuid) to authenticated;

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode='55000',message='privacy_disposition_catalog_changed',
      detail='A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
