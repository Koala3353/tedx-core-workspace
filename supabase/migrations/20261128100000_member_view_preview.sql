-- "View as a member" for full administrators (admin.configure and roles.manage, the same bar as
-- save_tedx_seat). An administrator picks a core member and sees that member's Today, Work or
-- notifications exactly as the existing read RPCs return them for that member.
--
-- How the preview runs: inside a subtransaction the function sets the transaction-local JWT claims
-- to the member's auth user (the pattern from app_private.telegram_as_member), calls one existing
-- read RPC, keeps the JSON in a variable and then always raises to roll the subtransaction back.
-- The rollback undoes the claims and any row the read wrote, so nothing the preview does persists.
-- (A read-only transaction is not used: the readers record a restricted_access_events row, which
-- would name the member as the reader. The rollback drops that row; member_view_audit below
-- records the real reader.) The caller's saved claims are then set again explicitly on every path. Only the Today, Work and notification readers are reachable;
-- no evaluation, finance-private or privacy-request reader is called.
--
-- Every call writes one row to app_private.member_view_audit. Additive only.
begin;

create table app_private.member_view_audit (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id),
  viewer_membership_id uuid not null references public.term_memberships(id),
  target_membership_id uuid not null references public.term_memberships(id),
  view text not null check(view in ('today','work','notifications')),
  outcome text not null check(outcome in ('shown','not_signed_in_yet','unavailable')),
  target_is_admin boolean not null default false,
  at timestamptz not null default statement_timestamp()
);
create index member_view_audit_term_at on app_private.member_view_audit(term_id,at desc);
create index member_view_audit_viewer on app_private.member_view_audit(viewer_membership_id);
create index member_view_audit_target on app_private.member_view_audit(target_membership_id);

alter table app_private.member_view_audit enable row level security;
alter table app_private.member_view_audit force row level security;
revoke all on app_private.member_view_audit from public,anon,authenticated,service_role;

-- Core members of the term with their committee and position, for the preview picker.
create function public.read_member_directory_for_preview(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer public.term_memberships; people jsonb;
begin
  viewer:=app_private.organization_actor(p_term_id,false);
  with roster as materialized(
    select tm.id membership_id,m.display_name,m.account_state,m.auth_user_id
    from public.term_memberships tm join public.members m on m.id=tm.member_id
    where tm.term_id=p_term_id and tm.membership_kind='core' and tm.status in ('active','pending')),
  seat as(
    select distinct on (s.membership_id) s.membership_id,r.name role_name,u.code unit_code,u.name unit_name
    from app_private.tedx_seats s join app_private.tedx_positions p on p.role_id=s.role_id join public.roles r on r.id=s.role_id
      left join public.org_units u on u.id=p.unit_id
    where s.term_id=p_term_id and not s.revoked and s.ends_at>statement_timestamp()
    order by s.membership_id,case p.tier when 'leadership' then 0 when 'head' then 1 else 2 end,s.starts_at,s.id),
  unit as(
    select distinct on (d.term_membership_id) d.term_membership_id membership_id,u.code unit_code,u.name unit_name
    from public.unit_memberships d join public.org_units u on u.id=d.unit_id and u.archived_at is null
    where d.term_id=p_term_id and d.status='active' and d.effective_to>statement_timestamp()
    order by d.term_membership_id,case d.deployment_type when 'head' then 0 else 1 end,d.effective_from,d.id)
  select coalesce(jsonb_agg(jsonb_build_object('membershipId',r.membership_id,'name',r.display_name,
      'committee',coalesce(seat.unit_name,unit.unit_name),'committeeCode',coalesce(seat.unit_code,unit.unit_code),
      'position',seat.role_name,'signedIn',r.auth_user_id is not null and r.account_state='active',
      'isSelf',r.membership_id=viewer.id)
    order by coalesce(seat.unit_name,unit.unit_name) nulls last,r.display_name,r.membership_id),'[]'::jsonb)
  into people
  from roster r left join seat on seat.membership_id=r.membership_id left join unit on unit.membership_id=r.membership_id;
  return jsonb_build_object('members',people);
end;
$$;

create function public.preview_member_view(p_term_id uuid,p_membership_id uuid,p_view text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  viewer public.term_memberships; target public.term_memberships; target_name text; subject uuid;
  result jsonb; target_admin boolean:=false; failed text;
  saved_sub text:=current_setting('request.jwt.claim.sub',true);
  saved_role text:=current_setting('request.jwt.claim.role',true);
  saved_claims text:=current_setting('request.jwt.claims',true);
begin
  viewer:=app_private.organization_actor(p_term_id,false);
  if p_view is null or p_view not in ('today','work','notifications') or p_membership_id is null then
    raise exception using errcode='22023',message='command_validation_failed';
  end if;
  select tm.* into target from public.term_memberships tm
    where tm.id=p_membership_id and tm.term_id=p_term_id and tm.membership_kind='core';
  if target.id is null then raise exception using errcode='22023',message='command_validation_failed'; end if;
  select m.display_name,case when m.account_state='active' then m.auth_user_id end into target_name,subject
    from public.members m where m.id=target.member_id;

  if subject is null then
    insert into app_private.member_view_audit(term_id,viewer_membership_id,target_membership_id,view,outcome)
      values(p_term_id,viewer.id,target.id,p_view,'not_signed_in_yet');
    return jsonb_build_object('state','not_signed_in_yet','view',p_view,
      'member',jsonb_build_object('membershipId',target.id,'name',target_name));
  end if;

  begin
    -- Nothing written in this block survives: it always ends in the rollback below.
    perform set_config('request.jwt.claim.sub',subject::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
    target_admin:=public.has_capability(p_term_id,'admin.configure') and public.has_capability(p_term_id,'roles.manage');
    result:=case p_view
      when 'today' then public.read_overview(p_term_id)
      when 'work' then public.read_owned_tasks(p_term_id,1)
      else public.read_notification_groups(p_term_id,1) end;
    -- Always roll the block back: the claims and every row written here revert.
    raise exception using errcode='P0001',message='member_preview_done';
  exception when others then
    if sqlerrm is distinct from 'member_preview_done' then failed:=sqlstate; result:=null; end if;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(saved_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(saved_role,''),true);
  perform set_config('request.jwt.claims',coalesce(saved_claims,''),true);

  insert into app_private.member_view_audit(term_id,viewer_membership_id,target_membership_id,view,outcome,target_is_admin)
    values(p_term_id,viewer.id,target.id,p_view,case when failed is null then 'shown' else 'unavailable' end,coalesce(target_admin,false));
  if failed is not null then
    return jsonb_build_object('state','unavailable','view',p_view,'code',failed,
      'member',jsonb_build_object('membershipId',target.id,'name',target_name));
  end if;
  return jsonb_build_object('state','ok','view',p_view,'targetIsAdmin',coalesce(target_admin,false),
    'member',jsonb_build_object('membershipId',target.id,'name',target_name),'data',result);
end;
$$;

revoke all on function public.read_member_directory_for_preview(uuid),public.preview_member_view(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.read_member_directory_for_preview(uuid),public.preview_member_view(uuid,uuid,text)
  to authenticated;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'term',key_columns,
  format('select app_private.disposition_key(%L,array[%s]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.%I x %s',
    'app_private.'||source,
    (select string_agg(format('x.%I::text',k),',' order by o) from unnest(key_columns) with ordinality u(k,o)),
    category,category,source,scope_sql),
  app_private.disposition_structure('app_private.'||source),false
from (values
  ('member_view_audit','security',array['id'],'where x.term_id=$1')
) definitions(source,category,key_columns,scope_sql)
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
