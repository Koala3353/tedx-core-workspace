-- Primer calendar milestones for the active term. NOT a migration: run once by hand in the SQL editor.
--
-- 1. Set v_admin_email to a core member who holds admin.configure in the active term (a calendar
--    "core" event needs it). The events are created through public.save_calendar_event acting as that
--    member, so the normal validation, version history, audit row and Google Calendar sync all apply.
-- 2. Run. Milestones already on the calendar (same title and start date, not cancelled) are skipped,
--    so re-running is safe. The NOTICE output lists what was added or skipped.
do $$
declare
  v_org_slug constant text := 'tedx-ateneo-de-manila-u';
  v_admin_email constant text := 'REPLACE_ME@student.ateneo.edu';
  term public.terms;
  admin_user uuid;
  milestone record;
  result jsonb;
begin
  select t.* into term from public.terms t join public.organizations o on o.id = t.organization_id
    where o.slug = v_org_slug and t.state = 'active';
  if not found then raise exception 'No active term for %', v_org_slug; end if;

  select m.auth_user_id into admin_user from public.members m
    where m.organization_id = term.organization_id and m.normalized_email = lower(btrim(v_admin_email))
      and m.account_state = 'active' and m.auth_user_id is not null;
  if admin_user is null then raise exception 'Set v_admin_email to a signed-in admin of this workspace'; end if;

  -- Act as the admin for this transaction only.
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user, 'role', 'authenticated')::text, true);
  if not public.has_capability(term.id, 'admin.configure') then
    raise exception '% does not hold admin.configure in the active term', v_admin_email;
  end if;

  -- end_on is exclusive (the day after the last day), matching calendar_events.
  for milestone in select * from (values
    ('Wave 1 heads onboarding', date '2026-12-08', date '2026-12-09'),
    ('Core applications', date '2027-01-09', date '2027-01-23'),
    ('Wave 1.5 results', date '2027-01-20', date '2027-01-21'),
    ('Core heads GA', date '2027-01-22', date '2027-01-23'),
    ('Core team results', date '2027-01-25', date '2027-01-26'),
    ('Core-wide GA', date '2027-01-28', date '2027-01-29'),
    ('Online contest', date '2027-02-28', date '2027-03-13'),
    ('TEDify', date '2027-03-20', date '2027-03-21'),
    ('Dry run', date '2027-04-16', date '2027-04-17'),
    ('TEDx event day', date '2027-04-17', date '2027-04-18')
  ) v(title, start_on, end_on) order by start_on, title loop
    if exists (
      select 1 from public.calendar_events e join public.work_items w on w.id = e.work_item_id
      where w.term_id = term.id and w.archived_at is null and e.state <> 'cancelled'
        and lower(e.title) = lower(milestone.title)
        and coalesce(e.start_on, (e.starts_at at time zone 'Asia/Manila')::date) = milestone.start_on
    ) then
      raise notice 'Skipped (already on the calendar): % %', milestone.start_on, milestone.title;
      continue;
    end if;
    if milestone.start_on < term.starts_on or milestone.end_on - 1 > term.closes_on then
      raise notice 'Skipped (outside the term dates): % %', milestone.start_on, milestone.title;
      continue;
    end if;
    result := public.save_calendar_event(term.id, null, jsonb_build_object(
      'title', milestone.title, 'description', 'Primer milestone', 'location', '',
      'visibility', 'core', 'unitId', null, 'allDay', true,
      'startOn', to_char(milestone.start_on, 'YYYY-MM-DD'), 'endOn', to_char(milestone.end_on, 'YYYY-MM-DD'),
      'startsAt', null, 'endsAt', null, 'state', 'confirmed', 'coreSafe', true,
      'reason', 'Primer calendar milestone'), 0, gen_random_uuid());
    raise notice 'Added: % % (%)', milestone.start_on, milestone.title, result->>'workItemId';
  end loop;
end;
$$;
