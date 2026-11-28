-- Members can change their own display name from Settings.
--  * Core members only, active term only, own row only (current_term_membership), like the profile
--    commands in app_private.change_profile.
--  * The name is trimmed; 1 to 120 characters; no control characters or line/paragraph separators.
--  * Versioned on members.version (stamped by stamp_identity_row) and idempotent per request id:
--    the same request id with the same payload returns the current name, a different payload is
--    rejected. Each change is recorded in profile_commands (command 'display_name'), which is where
--    profile commands are audited.
--  * Historical snapshots (work_items.owner_display_name, audit_events.actor_display_name,
--    profile_commands.actor_display_name and similar) keep the name used at the time on purpose.
--  * read_own_profile gains 'nameVersion' (members.version) for the expected version.
begin;

alter table public.profile_commands drop constraint profile_commands_command_check;
alter table public.profile_commands add constraint profile_commands_command_check
  check (command = any (array['values'::text, 'visibility'::text, 'display_name'::text]));

-- The registry fingerprints table structure (constraints included); refresh it for the widened check.
update app_private.disposition_sources set structure_hash = app_private.disposition_structure(source_key)
  where source_key = 'public.profile_commands';

create function public.set_own_display_name(p_term_id uuid, p_display_name text, p_expected_version integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tm public.term_memberships; person public.members; previous public.profile_commands;
  clean text := btrim(coalesce(p_display_name, '')); fingerprint text; new_version integer;
begin
  select * into tm from public.term_memberships where id = public.current_term_membership(p_term_id) and membership_kind = 'core';
  if not found then raise exception using errcode = '42501', message = 'profile_permission_denied'; end if;
  select * into person from public.members where id = tm.member_id for update;
  if tm.id is distinct from public.current_term_membership(p_term_id) or person.account_state <> 'active'
    or not exists(select 1 from public.terms where id = p_term_id and state = 'active') then
    raise exception using errcode = '42501', message = 'profile_permission_denied';
  end if;
  if p_request_id is null or p_expected_version is null or p_expected_version < 1 or p_display_name is null then
    raise exception using errcode = '22023', message = 'profile_invalid_input';
  end if;
  if char_length(clean) not between 1 and 120 or clean ~ '[\u0001-\u001f\u007f-\u009f  ]' then
    raise exception using errcode = '22023', message = 'profile_invalid_name';
  end if;
  fingerprint := encode(sha256(convert_to(jsonb_build_array(p_term_id, 'display_name', clean, p_expected_version)::text, 'UTF8')), 'hex');
  select * into previous from public.profile_commands where member_id = person.id and request_id = p_request_id;
  if found then
    if previous.fingerprint <> fingerprint then raise exception using errcode = '22023', message = 'profile_request_conflict'; end if;
    return jsonb_build_object('displayName', person.display_name, 'nameVersion', person.version);
  end if;
  if person.version <> p_expected_version then raise exception using errcode = '40001', message = 'profile_version_conflict'; end if;
  if person.display_name = clean then
    return jsonb_build_object('displayName', person.display_name, 'nameVersion', person.version);
  end if;
  update public.members set display_name = clean where id = person.id returning version into new_version;
  insert into public.profile_commands(member_id, request_id, actor_id, command, fingerprint, result_version, actor_display_name)
    values(person.id, p_request_id, auth.uid(), 'display_name', fingerprint, new_version, person.display_name);
  return jsonb_build_object('displayName', clean, 'nameVersion', new_version);
end;
$$;
revoke all on function public.set_own_display_name(uuid, text, integer, uuid) from public, anon;
grant execute on function public.set_own_display_name(uuid, text, integer, uuid) to authenticated;

-- Same as 20261128400000_profile_contacts.sql plus nameVersion.
create or replace function public.read_own_profile(p_term_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'memberId', tm.member_id, 'displayName', m.display_name, 'nameVersion', m.version,
    'version', coalesce(p.version,0),
    'skills',p.skills,'pronunciation',p.pronunciation,'affiliation',tm.affiliation_tag,
    'shareSkills',coalesce(p.share_skills,false),'sharePronunciation',coalesce(p.share_pronunciation,false),'shareAffiliation',coalesce(p.share_affiliation,false),
    'course', p.course, 'yearLevel', p.year_level,
    'phone', p.phone, 'externalContact', p.external_contact,
    'shareCourse', coalesce(p.share_course,false),
    'shareYearLevel', coalesce(p.share_year_level,false),
    'sharePhone', coalesce(p.share_phone,false),
    'shareExternalContact', coalesce(p.share_external_contact,false),
    'messenger', p.messenger, 'telegram', p.telegram,
    'messengerUrl', case when p.messenger is not null then 'https://m.me/'||p.messenger end,
    'telegramUrl', case when p.telegram is not null then 'https://t.me/'||p.telegram end,
    'shareMessenger', coalesce(p.share_messenger,true),
    'shareTelegram', coalesce(p.share_telegram,true)
  ) from public.term_memberships tm
  join public.members m on m.id=tm.member_id and m.organization_id=tm.organization_id
  left join public.private_profiles p on p.member_id=tm.member_id and p.organization_id=tm.organization_id
  where tm.id=public.current_term_membership(p_term_id)
    and tm.membership_kind='core'
$$;

commit;
