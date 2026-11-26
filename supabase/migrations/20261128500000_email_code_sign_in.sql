begin;
-- Email one-time-code sign-in, for students whose Google Workspace admin blocks the Google consent
-- screen. The roster gate is unchanged: a code only proves the student controls the mailbox, and every
-- caller still requires an active roster member whose normalized_email equals that address.
--
-- Proof accepted for an email-provider identity (provider 'email', created by signInWithOtp):
--   * auth.users.email_confirmed_at is set (Auth sets it only after the code or link is verified;
--     the project MUST keep "Confirm email" on, see the ops note in the build report), and
--   * the identity's own email equals the account email, and
--   * the identity does not report email_verified=false (Auth flips it to true on confirmation;
--     the confirmation timestamp is the authoritative proof), and
--   * the address is @student.ateneo.edu.
-- The Google branch is copied unchanged from 20261024000300_google_auth.sql.

create or replace function app_private.is_school_identity(p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from auth.users u join auth.identities i on i.user_id=u.id
    where u.id=p_user_id and u.email_confirmed_at is not null
      and lower(btrim(u.email)) ~ '^[^@[:space:]]+@student[.]ateneo[.]edu$'
      and lower(btrim(i.identity_data->>'email'))=lower(btrim(u.email))
      and ((i.provider='google' and i.identity_data->'email_verified'='true'::jsonb)
        or (i.provider='email' and coalesce(i.identity_data->'email_verified','true'::jsonb)='true'::jsonb)))
$$;
revoke all on function app_private.is_school_identity(uuid) from public,anon,authenticated,service_role;

-- verified_google_email is the "which address did this person prove" helper used by both core and guest
-- paths. Core paths pair it with is_school_identity and the roster, so it must also return the address
-- for a code-verified school identity, or explain_access and the directory would drop these members.
-- Guest paths must not widen: the email branch only answers for a school identity whose address is on the
-- roster (an invited or active member). Anyone else, including every non-roster guest, is Google-only as before.
create or replace function app_private.verified_google_email(p_user uuid) returns text
language sql stable set search_path='' as $$
  select lower(btrim(u.email)) from auth.users u where u.id=p_user and u.email_confirmed_at is not null
    and (exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'
        and i.identity_data->'email_verified'='true'::jsonb
        and lower(btrim(i.identity_data->>'email'))=lower(btrim(u.email)))
      or (app_private.is_school_identity(u.id)
        and exists(select 1 from public.members m where m.normalized_email=lower(btrim(u.email))
          and m.account_state in ('invited','active') and (m.auth_user_id is null or m.auth_user_id=u.id))))
$$;
revoke all on function app_private.verified_google_email(uuid) from public,anon,authenticated,service_role;
commit;
