-- Default deliverable readiness policy (owner decision, 2026-11-26).
-- readiness_transition raised 22023 because no deliverable_readiness_policies row was ever written.
-- Now every deliverable without a policy gets a default one: any current head of the lead committee
-- accepts, and full admins (admin.configure and roles.manage, the PM preset) can also accept. The owner
-- still cannot accept their own deliverable. Explicit policies keep their exact rules.
--  * app_private.readiness_default_policies marks the default rows (one per deliverable).
--  * New deliverables get the default policy from a trigger; existing ones are backfilled here, and
--    readiness_transition creates it on first use if no acceptor existed earlier.
--  * readiness_authority also accepts a live full-admin assignment, so acceptance by a PM is
--    recorded and verified like a head's.
begin;

create table app_private.readiness_default_policies (
  policy_id uuid primary key references public.deliverable_readiness_policies(id),
  work_item_id uuid not null unique references public.deliverables(work_item_id),
  term_id uuid not null references public.terms(id),
  created_at timestamptz not null default statement_timestamp()
);
alter table app_private.readiness_default_policies enable row level security;
alter table app_private.readiness_default_policies force row level security;
revoke all on app_private.readiness_default_policies from public, anon, authenticated, service_role;

alter function app_private.readiness_authority(uuid,integer,uuid,uuid) rename to readiness_authority_before_default;
create function app_private.readiness_authority(authority uuid, expected integer, term uuid, unit uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.readiness_authority_before_default(authority, expected, term, unit), (
    select a.term_membership_id from app_private.effective_role_assignments a
    join public.roles role on role.id = a.role_id and role.state = 'active'
    join public.role_permissions configure on configure.role_id = role.id and configure.capability = 'admin.configure' and configure.allowed_scope = 'term'
    join public.role_permissions manage on manage.role_id = role.id and manage.capability = 'roles.manage' and manage.allowed_scope = 'term'
    join public.term_memberships tm on tm.id = a.term_membership_id join public.members person on person.id = tm.member_id
    join public.terms t on t.id = a.term_id and t.state = 'active' join public.organizations o on o.id = t.organization_id and o.state = 'active'
    where a.id = authority and a.version = expected and a.term_id = term and a.scope_type = 'term' and a.status = 'active'
      and a.effective_from <= statement_timestamp() and a.effective_to > statement_timestamp()
      and tm.status = 'active' and tm.membership_kind = 'core' and tm.joined_at <= statement_timestamp() and tm.ends_at > statement_timestamp()
      and person.account_state = 'active' and person.auth_user_id is not null
      and (statement_timestamp() at time zone 'Asia/Manila')::date between t.starts_on and t.closes_on
    limit 1))
$$;

create function app_private.readiness_is_default(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_policy is not null and exists (select 1 from app_private.readiness_default_policies where policy_id = p_policy)
$$;

-- The caller's acceptance authority for a default policy: their head assignment for the lead
-- committee, otherwise their full-admin assignment.
create function app_private.readiness_default_acceptor(w public.work_items, p_member uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from app_private.effective_role_assignments a
  where a.term_membership_id = p_member and a.term_id = w.term_id and (a.unit_id = w.lead_unit_id or a.scope_type = 'term')
    and app_private.readiness_authority(a.id, a.version, w.term_id, w.lead_unit_id) is not null
  order by (a.scope_type = 'unit') desc, a.id limit 1
$$;

create or replace function app_private.readiness_policy(w public.work_items) returns public.deliverable_readiness_policies
language sql stable security definer set search_path = '' as $$
  select p from public.deliverable_readiness_policies p
  join public.term_memberships confirmer on confirmer.id = p.confirmed_by and confirmer.term_id = w.term_id and confirmer.organization_id = w.organization_id
  where p.work_item_id = w.id and p.version = (select max(version) from public.deliverable_readiness_policies where work_item_id = w.id)
    and p.effective_from <= statement_timestamp() and p.effective_to > statement_timestamp()
    and case when app_private.readiness_is_default(p.id) then exists (
        select 1 from app_private.effective_role_assignments a join public.term_memberships tm on tm.id = a.term_membership_id
        where a.term_id = w.term_id and tm.member_id <> w.owner_member_id and (a.unit_id = w.lead_unit_id or a.scope_type = 'term')
          and app_private.readiness_authority(a.id, a.version, w.term_id, w.lead_unit_id) is not null)
      else app_private.readiness_authority(p.acceptor_authority_id, p.acceptor_authority_version, w.term_id, w.lead_unit_id) is not null
        and exists (select 1 from public.term_memberships tm where tm.id = app_private.readiness_authority(p.acceptor_authority_id,
          p.acceptor_authority_version, w.term_id, w.lead_unit_id) and tm.member_id <> w.owner_member_id) end
  limit 1
$$;

create function app_private.ensure_readiness_default_policy(p_work_item uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w public.work_items; t public.terms; pin uuid; pin_version integer; pin_member uuid; policy uuid;
begin
  select * into w from public.work_items where id = p_work_item and kind = 'deliverable';
  if w.id is null or exists (select 1 from public.deliverable_readiness_policies where work_item_id = w.id) then return null; end if;
  select a.id, a.version, a.term_membership_id into pin, pin_version, pin_member
    from app_private.effective_role_assignments a join public.term_memberships tm on tm.id = a.term_membership_id
    where a.term_id = w.term_id and tm.member_id <> w.owner_member_id and (a.unit_id = w.lead_unit_id or a.scope_type = 'term')
      and app_private.readiness_authority(a.id, a.version, w.term_id, w.lead_unit_id) is not null
    order by (a.scope_type = 'unit') desc, a.id limit 1;
  if pin is null then return null; end if;
  select * into t from public.terms where id = w.term_id;
  insert into public.deliverable_readiness_policies(work_item_id, version, acceptor_authority_id, acceptor_authority_version,
    external_required, official_reference, confirmed_by, effective_from, effective_to)
    values (w.id, 1, pin, pin_version, false, 'Default: a head of the lead committee accepts. Full admins can also accept.', pin_member,
      least(statement_timestamp(), t.starts_on::timestamp at time zone 'Asia/Manila'), (t.closes_on + 1)::timestamp at time zone 'Asia/Manila')
    returning id into policy;
  insert into app_private.readiness_default_policies(policy_id, work_item_id, term_id) values (policy, w.id, w.term_id);
  insert into app_private.single_admin_actions(term_id, action, target_id, detail)
    values (w.term_id, 'readiness_default_policy', w.id, jsonb_build_object('policyId', policy));
  return policy;
end;
$$;

create function app_private.readiness_default_on_create() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.ensure_readiness_default_policy(new.work_item_id);
  return null;
end;
$$;
create trigger readiness_default_policy after insert on public.deliverables
  for each row execute function app_private.readiness_default_on_create();

-- Acceptance for default policies: a lead-committee head or a full admin, never the owner.
CREATE OR REPLACE FUNCTION app_private.readiness_transition(p_work_item_id uuid, p_kind text, p_evidence text, p_reason text, p_expected_version integer, p_criteria_revision integer, p_fingerprint text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w public.work_items;d public.deliverables;p public.deliverable_readiness_policies;m public.term_memberships;s jsonb;payload jsonb;result jsonb;prior public.deliverable_readiness_events;event uuid;target text;command text;role uuid;role_version integer;begin
 select *into w from public.work_items where id=p_work_item_id and kind='deliverable'for update;m:=app_private.request_actor(w.term_id,true);
 if w.id is null or w.archived_at is not null or not(public.can_access_work(w.id,'edit')or app_private.full_admin(w.term_id))then raise exception using errcode='42501',message='command_permission_denied';end if;
 perform app_private.readiness_lock(w.term_id);m:=app_private.request_actor(w.term_id,true);select *into d from public.deliverables where work_item_id=w.id;perform app_private.ensure_readiness_default_policy(w.id);p:=app_private.readiness_policy(w);
 if p_kind='accepted'then
 if app_private.readiness_is_default(p.id)then role:=app_private.readiness_default_acceptor(w,m.id);select version into role_version from public.role_assignments where id=role;if role is null or m.member_id=w.owner_member_id then raise exception using errcode='42501',message='command_permission_denied';end if;
 else if m.id is distinct from app_private.readiness_authority(p.acceptor_authority_id,p.acceptor_authority_version,w.term_id,w.lead_unit_id)or m.member_id=w.owner_member_id then raise exception using errcode='42501',message='command_permission_denied';end if;role:=p.acceptor_authority_id;role_version:=p.acceptor_authority_version;end if;
 elsif p_kind='submitted'then if m.member_id<>w.owner_member_id then raise exception using errcode='42501',message='command_permission_denied';end if;
 elsif p_kind='reopened'then if m.member_id<>w.owner_member_id and m.id is distinct from app_private.readiness_authority(p.acceptor_authority_id,p.acceptor_authority_version,w.term_id,w.lead_unit_id)and not(app_private.readiness_is_default(p.id)and app_private.readiness_default_acceptor(w,m.id)is not null)then raise exception using errcode='42501',message='command_permission_denied';end if;
 else raise exception using errcode='22023',message='command_validation_failed';end if;
 command:=case p_kind when 'accepted'then 'accept_deliverable'when 'submitted'then 'submit_deliverable'else 'reopen_deliverable'end;payload:=jsonb_build_array(p_work_item_id,p_evidence,p_reason,p_expected_version,p_criteria_revision,p_fingerprint);
 result:=app_private.begin_work_command(command,p_request_id,payload);if result is not null then return result;end if;
 if w.version is distinct from p_expected_version or d.criteria_revision is distinct from p_criteria_revision then raise exception using errcode='40001',message='command_stale_version';end if;
 s:=app_private.readiness_snapshot(w);if p_fingerprint is distinct from s->>'fingerprint'then raise exception using errcode='40001',message='command_stale_version';end if;
 if p.id is null or p_reason is null or length(btrim(p_reason))not between 1 and 2000 or p_evidence is null or length(btrim(p_evidence))not between 1 and 4000 then raise exception using errcode='22023',message='command_validation_failed';end if;
 select *into prior from public.deliverable_readiness_events where work_item_id=w.id order by sequence desc limit 1;
 if p_kind='submitted'then
 if d.workflow_state not in('draft','in_progress')or not(s->>'ready')::boolean then raise exception using errcode='55000',message='command_dependency_blocked';end if;target:='submitted';
 elsif p_kind='accepted'then
 if d.workflow_state<>'submitted'or prior.kind is distinct from 'submitted'or prior.fingerprint is distinct from s->>'fingerprint'or prior.criteria_revision<>d.criteria_revision or prior.evidence is distinct from d.final_evidence or not(s->>'ready')::boolean then raise exception using errcode='55000',message='command_dependency_blocked';end if;target:='accepted';
 else if d.workflow_state not in('accepted','submitted')then raise exception using errcode='55000',message='command_dependency_blocked';end if;target:='in_progress';end if;
 insert into public.deliverable_readiness_events(work_item_id,kind,policy_id,criteria_revision,fingerprint,submission_id,actor_id,authority_id,authority_version,evidence,reason)values(w.id,p_kind,p.id,d.criteria_revision,s->>'fingerprint',case when p_kind='accepted'then prior.id end,auth.uid(),role,role_version,btrim(p_evidence),p_reason)returning id into event;
 perform set_config('app.readiness_accept',w.id::text,true);update public.work_items set status_id=app_private.deliverable_status(w.organization_id,w.term_id,target)where id=w.id returning *into w;
 update public.deliverables set workflow_state=target,final_evidence=case when p_kind='submitted'then btrim(p_evidence)when p_kind='reopened'then null else final_evidence end where work_item_id=w.id;
 perform app_private.snapshot_deliverable(w,p_reason,case when p_kind='accepted'then p_evidence end);
 return app_private.finish_work_command(w,command,p_request_id,payload,jsonb_build_object('workItemId',w.id,'version',w.version,'eventId',event,'state',target),'["deliverable_readiness","acceptance_evidence"]');end$function$;

alter function public.read_deliverable_readiness(uuid) rename to read_deliverable_readiness_before_default;
alter function public.read_deliverable_readiness_before_default(uuid) set schema app_private;
create function public.read_deliverable_readiness(p_work_item_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; w public.work_items; d public.deliverables; p public.deliverable_readiness_policies; m uuid; s jsonb;
begin
  r := app_private.read_deliverable_readiness_before_default(p_work_item_id);
  if r is null then return null; end if;
  select * into w from public.work_items where id = p_work_item_id;
  p := app_private.readiness_policy(w);
  m := public.current_term_membership(w.term_id);
  if p.id is null or not app_private.readiness_is_default(p.id) or m is null or w.archived_at is not null
    or not (public.can_access_work(w.id, 'edit') or app_private.full_admin(w.term_id))
    or exists (select 1 from public.term_memberships where id = m and member_id = w.owner_member_id)
    or app_private.readiness_default_acceptor(w, m) is null then
    return r;
  end if;
  select * into d from public.deliverables where work_item_id = w.id;
  s := app_private.readiness_snapshot(w);
  return r || jsonb_build_object(
    'fingerprint', s->>'fingerprint', 'submittedEvidence', d.final_evidence,
    'canAccept', d.workflow_state = 'submitted' and not (s->>'reviewRequired')::boolean and (s->>'ready')::boolean,
    'canReopen', d.workflow_state in ('accepted', 'submitted'), 'canDeclare', true);
end;
$$;

do $$
declare x uuid;
begin
  for x in select d.work_item_id from public.deliverables d join public.work_items w on w.id = d.work_item_id
    where w.archived_at is null and not exists (select 1 from public.deliverable_readiness_policies p where p.work_item_id = d.work_item_id)
  loop
    perform app_private.ensure_readiness_default_policy(x);
  end loop;
end $$;

revoke all on function app_private.readiness_authority_before_default(uuid,integer,uuid,uuid), app_private.readiness_authority(uuid,integer,uuid,uuid),
  app_private.readiness_is_default(uuid), app_private.readiness_default_acceptor(public.work_items,uuid), app_private.readiness_policy(public.work_items),
  app_private.ensure_readiness_default_policy(uuid), app_private.readiness_default_on_create(),
  app_private.readiness_transition(uuid,text,text,text,integer,integer,text,uuid),
  app_private.read_deliverable_readiness_before_default(uuid), public.read_deliverable_readiness(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_deliverable_readiness(uuid) to authenticated;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.readiness_default_policies','operational','term',array['policy_id'],
  format('select app_private.disposition_key(%L,array[x.policy_id::text]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.readiness_default_policies x where x.term_id=$1',
    'app_private.readiness_default_policies','operational','operational'),
  app_private.disposition_structure('app_private.readiness_default_policies'),false
on conflict(source_key) do update set category=excluded.category,scope_kind=excluded.scope_kind,key_columns=excluded.key_columns,
  query_sql=excluded.query_sql,structure_hash=excluded.structure_hash,preserve=excluded.preserve;

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode='55000',message='privacy_disposition_catalog_changed',
      detail='A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
