-- Approve the Apps Script sender for email reminders. NOT a migration: run it by hand in the
-- Supabase SQL editor after scripts/setup-reminders.sh, once a test email has arrived.
--
-- Two different admins take part (app_private.email_sender_approvals requires approved_by <> verified_by):
--   verifier: deployed the Apps Script relay and confirmed the health check and a test email
--   approver: a second admin who reviewed that evidence
-- Both must be current core members of the term with an admin.configure role and a school identity;
-- otherwise app_private.email_approval_live() treats the row as not live and nothing is sent.
--
-- Fill in the five values in the "input" block. sender and domain_id must equal the
-- EMAIL_FROM_ADDRESS and EMAIL_PROVIDER_DOMAIN_ID that setup-reminders.sh printed.
begin;

do $$
declare
  -- input ---------------------------------------------------------------------------------
  v_term_id uuid := '00000000-0000-0000-0000-000000000000';         -- public.terms.id (EMAIL_TERM_ID)
  v_sender text := lower('relay-account@example.edu');                  -- EMAIL_FROM_ADDRESS
  v_domain_id uuid := '00000000-0000-0000-0000-000000000000';       -- EMAIL_PROVIDER_DOMAIN_ID
  v_verifier_email text := lower('verifier@student.ateneo.edu');
  v_approver_email text := lower('approver@student.ateneo.edu');
  v_daily_cap integer := 1500;  -- Google Workspace MailApp quota; use 100 for a consumer Gmail account
  -- ----------------------------------------------------------------------------------------
  t public.terms;
  v_verified_by uuid;
  v_approved_by uuid;
begin
  select * into t from public.terms where id = v_term_id and state = 'active';
  if t.id is null then raise exception 'Term % is not an active term', v_term_id; end if;

  select tm.id into v_verified_by
  from public.term_memberships tm
  join public.members m on m.id = tm.member_id and m.organization_id = t.organization_id
  where tm.term_id = t.id and m.normalized_email = v_verifier_email;

  select tm.id into v_approved_by
  from public.term_memberships tm
  join public.members m on m.id = tm.member_id and m.organization_id = t.organization_id
  where tm.term_id = t.id and m.normalized_email = v_approver_email;

  if v_verified_by is null or v_approved_by is null then
    raise exception 'Both admins must have a membership in this term';
  end if;
  if v_verified_by = v_approved_by then
    raise exception 'The verifier and the approver must be two different people';
  end if;
  if exists (
    select 1 from unnest(array[v_verified_by, v_approved_by]) member(id)
    where app_private.email_current_school_address(member.id) is null
       or not exists (
         select 1 from app_private.effective_role_assignments a
         join public.role_permissions p on p.role_id = a.role_id and p.allowed_scope = a.scope_type
         where a.term_membership_id = member.id and a.term_id = t.id and p.capability = 'admin.configure'
           and app_private.access_assignment_live(a.id))
  ) then
    raise exception 'Both people must be current core members with an admin.configure role';
  end if;

  insert into app_private.email_sender_approvals as s (
    term_id, sender, domain_id, verified_by, approved_by, evidence_reference,
    dns_verified_at, delivery_verified_at, quota_verified_at, approval_expires_at, daily_cap)
  values (
    t.id, v_sender, v_domain_id, v_verified_by, v_approved_by,
    'Apps Script relay: health check and test email confirmed by ' || v_verifier_email
      || '; approved by ' || v_approver_email || ' on ' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'),
    now(), now(), now(),
    least(now() + interval '180 days', ((t.closes_on + 1)::timestamp at time zone 'Asia/Manila')),
    v_daily_cap)
  on conflict (term_id) do update set
    sender = excluded.sender, domain_id = excluded.domain_id,
    verified_by = excluded.verified_by, approved_by = excluded.approved_by,
    evidence_reference = excluded.evidence_reference,
    dns_verified_at = excluded.dns_verified_at, delivery_verified_at = excluded.delivery_verified_at,
    quota_verified_at = excluded.quota_verified_at, approval_expires_at = excluded.approval_expires_at,
    daily_cap = excluded.daily_cap, domain_checked_at = null, quota_blocked_at = null, revoked_at = null;
end;
$$;

-- Should return live = true. The first email-adapter run then records the health check
-- (domain_checked_at) and members can turn email reminders on.
select s.term_id, s.sender, s.daily_cap, s.approval_expires_at,
       app_private.email_approval_live(s, statement_timestamp()) as live
from app_private.email_sender_approvals s;

commit;

-- To stop all reminder email for the term later:
--   update app_private.email_sender_approvals set revoked_at = now() where term_id = '<term uuid>';
