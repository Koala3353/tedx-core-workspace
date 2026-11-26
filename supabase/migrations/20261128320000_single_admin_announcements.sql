-- Single-admin announcements (owner decision, 2026-11-26). One PM is enough:
--  * full admins (admin.configure and roles.manage, the PM preset) can post to the whole workspace
--    ("Core team") without a second admin's approval;
--  * a full admin can allow another person to post to an audience in one step
--    (public.set_announcement_publisher), and stop it again. The publisher row keeps approved_by and
--    app_private.single_admin_actions keeps who and when;
--  * people allowed this way can post to that audience even without a committee head seat.
-- Existing publisher rows and their rules are unchanged.
begin;

alter function app_private.presentation_actor(uuid,text,text,uuid,boolean) rename to presentation_actor_before_single_admin;

create function app_private.bulletin_single_admin_allowed(p_term uuid, p_member uuid, p_target_kind text, p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.announcement_publishers a
    join public.term_memberships approver on approver.id = a.approved_by and approver.term_id = p_term and approver.membership_kind = 'core'
    where a.term_id = p_term and a.membership_id = p_member and a.target_kind = p_target_kind and a.target_id = p_target and a.revoked_at is null
      and exists (select 1 from app_private.single_admin_actions s where s.term_id = p_term and s.action = 'publisher_allowed'
        and s.target_id = p_member and s.actor_membership_id = a.approved_by
        and s.detail->>'targetKind' = p_target_kind and s.detail->>'targetId' = p_target::text))
$$;

create function app_private.presentation_actor(p_term uuid, p_kind text, p_target_kind text, p_target uuid, p_write boolean default false)
returns public.term_memberships language plpgsql stable security definer set search_path = '' as $$
declare m public.term_memberships;
begin
  if p_kind is distinct from 'bulletin' then
    return app_private.presentation_actor_before_single_admin(p_term, p_kind, p_target_kind, p_target, p_write);
  end if;
  m := app_private.request_actor(p_term, p_write);
  if p_target_kind = 'term' and p_target = p_term and app_private.full_admin(p_term) then return m; end if;
  if p_target_kind in ('term', 'unit') and p_target is not null
    and (p_target_kind <> 'term' or p_target = p_term)
    and (p_target_kind <> 'unit' or exists (select 1 from public.org_units where id = p_target and term_id = p_term and archived_at is null))
    and app_private.bulletin_single_admin_allowed(p_term, m.id, p_target_kind, p_target) then
    return m;
  end if;
  return app_private.presentation_actor_before_single_admin(p_term, p_kind, p_target_kind, p_target, p_write);
end;
$$;

create or replace function public.read_announcement_publishing_options(p_term_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.term_memberships;r record;targets jsonb:='[]';begin
 m:=app_private.request_actor(p_term_id);
 for r in select distinct x.target_kind,x.target_id,x.name from(
   select a.target_kind,a.target_id,case when a.target_kind='term'then 'Core team'else u.name end as name from public.announcement_publishers a left join public.org_units u on u.id=a.target_id
    where a.term_id=p_term_id and a.membership_id=m.id and a.revoked_at is null
   union all select 'term',p_term_id,'Core team' where app_private.full_admin(p_term_id))x order by x.target_kind,x.target_id loop
  begin perform app_private.presentation_actor(p_term_id,'bulletin',r.target_kind,r.target_id,true);
   targets:=targets||jsonb_build_array(jsonb_build_object('kind',r.target_kind,'id',r.target_id,'name',r.name));
  exception when insufficient_privilege then continue;end;
 end loop;
 if targets='[]'::jsonb then return jsonb_build_object('targets',targets,'attachments','[]'::jsonb,'guests','[]'::jsonb);end if;
 return jsonb_build_object('targets',targets,
 'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.filename,'workTitle',w.title)order by a.id)from public.assets a join public.work_items w on w.id=a.origin_work_item_id
  where w.term_id=p_term_id and w.archived_at is null and a.state='finalized'and a.kind='upload'and public.can_access_work(w.id,'detail')),'[]'),
 'guests',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.email,'expiresAt',i.expires_at)order by i.id)from public.guest_invitations i where i.term_id=p_term_id and i.sponsor_id=m.id and i.revoked_at is null and i.expires_at>statement_timestamp()and i.redeemed_by is not null and i.email=app_private.verified_google_email(i.redeemed_by)and app_private.active_guest_sponsor(i.sponsor_id)),'[]'));
end$$;

create function app_private.announcement_publishers_json(p_term uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'publishers', coalesce((select jsonb_agg(jsonb_build_object(
        'membershipId', a.membership_id, 'name', person.display_name, 'targetKind', a.target_kind, 'targetId', a.target_id,
        'audience', case when a.target_kind = 'term' then 'Core team' else u.name end,
        'allowedBy', approver_person.display_name,
        'allowedAt', (select max(s.recorded_at) from app_private.single_admin_actions s where s.term_id = p_term and s.action = 'publisher_allowed'
          and s.target_id = a.membership_id and s.detail->>'targetKind' = a.target_kind and s.detail->>'targetId' = a.target_id::text))
        order by person.display_name, a.target_kind, u.name)
      from public.announcement_publishers a
      join public.term_memberships tm on tm.id = a.membership_id join public.members person on person.id = tm.member_id
      join public.term_memberships approver on approver.id = a.approved_by join public.members approver_person on approver_person.id = approver.member_id
      left join public.org_units u on u.id = a.target_id
      where a.term_id = p_term and a.revoked_at is null), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('membershipId', tm.id, 'name', person.display_name) order by person.display_name, tm.id)
      from public.term_memberships tm join public.members person on person.id = tm.member_id
      where tm.term_id = p_term and tm.membership_kind = 'core' and tm.status = 'active' and person.account_state = 'active'
        and tm.joined_at <= statement_timestamp() and tm.ends_at > statement_timestamp()), '[]'::jsonb),
    'audiences', jsonb_build_array(jsonb_build_object('kind', 'term', 'id', p_term, 'name', 'Core team'))
      || coalesce((select jsonb_agg(jsonb_build_object('kind', 'unit', 'id', u.id, 'name', u.name) order by u.name, u.id)
        from public.org_units u where u.term_id = p_term and u.archived_at is null), '[]'::jsonb))
$$;

create function public.read_announcement_publishers(p_term_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.request_actor(p_term_id);
  if not app_private.full_admin(p_term_id) then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  return app_private.announcement_publishers_json(p_term_id);
end;
$$;

create function public.set_announcement_publisher(p_term_id uuid, p_membership_id uuid, p_target_kind text, p_target_id uuid,
  p_allow boolean, p_reason text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.term_memberships; payload jsonb; receipt jsonb; changed integer := 0;
begin
  m := app_private.request_actor(p_term_id, true);
  if not app_private.full_admin(p_term_id) then raise exception using errcode = '42501', message = 'command_permission_denied'; end if;
  if p_allow is null or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
    or p_target_kind is null or p_target_kind not in ('term', 'unit') or p_target_id is null
    or (p_target_kind = 'term' and p_target_id <> p_term_id)
    or (p_target_kind = 'unit' and not exists (select 1 from public.org_units where id = p_target_id and term_id = p_term_id and archived_at is null))
    or not exists (select 1 from public.term_memberships tm join public.members person on person.id = tm.member_id
      where tm.id = p_membership_id and tm.term_id = p_term_id and tm.membership_kind = 'core' and tm.status = 'active' and person.account_state = 'active')
    or (p_allow and p_membership_id = m.id) then
    raise exception using errcode = '22023', message = 'command_validation_failed';
  end if;
  payload := jsonb_build_array(p_term_id, p_membership_id, p_target_kind, p_target_id, p_allow, btrim(p_reason));
  receipt := app_private.begin_work_command('set_announcement_publisher', p_request_id, payload);
  if receipt is not null then return receipt; end if;
  if p_allow then
    insert into public.announcement_publishers(term_id, membership_id, target_kind, target_id, approved_by)
      values (p_term_id, p_membership_id, p_target_kind, p_target_id, m.id)
      on conflict (term_id, membership_id, target_kind, target_id) do update set approved_by = excluded.approved_by, revoked_at = null;
    changed := 1;
  else
    update public.announcement_publishers set revoked_at = statement_timestamp()
      where term_id = p_term_id and membership_id = p_membership_id and target_kind = p_target_kind and target_id = p_target_id and revoked_at is null;
    get diagnostics changed = row_count;
  end if;
  if changed > 0 then
    insert into app_private.single_admin_actions(term_id, actor_membership_id, actor_user_id, action, target_id, detail, reason)
      values (p_term_id, m.id, auth.uid(), case when p_allow then 'publisher_allowed' else 'publisher_stopped' end, p_membership_id,
        jsonb_build_object('targetKind', p_target_kind, 'targetId', p_target_id), btrim(p_reason));
  end if;
  receipt := app_private.announcement_publishers_json(p_term_id);
  insert into public.idempotency_keys(actor_id, command, client_key, organization_id, term_id, payload_hash, result_reference)
    values (auth.uid(), 'set_announcement_publisher', p_request_id, m.organization_id, p_term_id,
      encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'), receipt);
  return receipt;
end;
$$;

revoke all on function app_private.presentation_actor_before_single_admin(uuid,text,text,uuid,boolean),
  app_private.presentation_actor(uuid,text,text,uuid,boolean), app_private.bulletin_single_admin_allowed(uuid,uuid,text,uuid),
  app_private.announcement_publishers_json(uuid), public.read_announcement_publishing_options(uuid),
  public.read_announcement_publishers(uuid), public.set_announcement_publisher(uuid,uuid,text,uuid,boolean,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_announcement_publishing_options(uuid), public.read_announcement_publishers(uuid),
  public.set_announcement_publisher(uuid,uuid,text,uuid,boolean,text,uuid) to authenticated;

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode='55000',message='privacy_disposition_catalog_changed',
      detail='A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
