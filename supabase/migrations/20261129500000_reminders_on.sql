-- Switch reminders on: published reminder settings (Admin > Notifications > Reminder settings) now take
-- effect. Every reminder run (dispatch-notifications, called every 15 minutes by the Apps Script time
-- trigger and by the GitHub workflow) first reserves the next day of reminders from each active term's
-- latest published rule through public.reserve_notification_window, which existed but nothing called.
-- The built-in due/overdue pass runs after it. Both use one reminder key per item and day, so the
-- built-in pass skips anything a rule already scheduled: no double reminders. With no published rule,
-- behaviour is unchanged.
begin;

-- Never raises: a bad rule logs a warning and the built-in reminders still run.
create function app_private.apply_published_reminder_rules() returns integer
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  t record;
  r jsonb;
  after uuid;
  pages integer;
  n integer := 0;
begin
  for t in
    select c.term_id, (select v.id from public.presentation_versions v where v.control_id = c.work_item_id
      order by v.version desc limit 1) as version_id
    from public.presentation_controls c join public.terms tm on tm.id = c.term_id and tm.state = 'active'
    where c.kind = 'notification' and c.target_kind = 'term' and c.target_id = c.term_id
  loop
    continue when t.version_id is null;
    after := null; pages := 0;
    begin
      loop
        r := public.reserve_notification_window(t.term_id, t.version_id, statement_timestamp(),
          statement_timestamp() + interval '1 day', after, 100);
        n := n + coalesce((r->>'reserved')::integer, 0);
        after := (r->>'nextAfter')::uuid;
        pages := pages + 1;
        exit when after is null or pages >= 20;
      end loop;
    exception when others then
      raise warning using message = 'reminder_rules_failed', detail = sqlstate;
    end;
  end loop;
  return n;
end
$$;

-- Keep the current pipeline untouched and run the published rules first.
alter function public.enqueue_notification_reminders(integer) set schema app_private;
alter function app_private.enqueue_notification_reminders(integer) rename to enqueue_notification_reminders_before_rules;
create function public.enqueue_notification_reminders(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return app_private.apply_published_reminder_rules() + app_private.enqueue_notification_reminders_before_rules(p_limit);
end
$$;

revoke all on function app_private.apply_published_reminder_rules(),
  app_private.enqueue_notification_reminders_before_rules(integer) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_notification_reminders(integer) from public, anon, authenticated;
grant execute on function public.enqueue_notification_reminders(integer) to service_role;

commit;
