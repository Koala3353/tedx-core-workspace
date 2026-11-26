#!/usr/bin/env bash
# One-time (and re-runnable) setup for scheduled reminders and Apps Script email delivery.
# Run it yourself from the app folder:  bash scripts/setup-reminders.sh
#
# Needs: openssl, gh (logged in, with admin access to the repository), pnpm install done,
# and `pnpm exec supabase login` done. It will:
#   1. optionally apply pending migrations (supabase db push)
#   2. generate fresh dispatch and HMAC secrets locally
#   3. store them as GitHub Actions secrets and Supabase function secrets
#   4. deploy dispatch-notifications, email-adapter and dispatch-telegram
#   5. print the Apps Script HMAC secret once, for Script properties
# Secrets are never passed on a command line or echoed, except the single HMAC print at the end.
set -euo pipefail

REPO="Koala3353/tedx-core-workspace"
PROJECT_REF="wyurosneoxfqqrrvstke"
DEFAULT_ORIGIN="https://koala3353.github.io"
DEFAULT_BASE_PATH="/tedx-core-workspace/"

cd "$(dirname "$0")/.."

for tool in openssl gh pnpm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

ask() { # ask VAR "Prompt" [default]
  local answer
  if [ -n "${3:-}" ]; then read -r -p "$2 [$3]: " answer; answer="${answer:-$3}"; else read -r -p "$2: " answer; fi
  printf -v "$1" '%s' "$answer"
}

echo "Reminder setup for $REPO / Supabase project $PROJECT_REF"
echo

ask APPS_SCRIPT_URL "Apps Script web app URL (ends in /exec)"
if [[ ! "$APPS_SCRIPT_URL" =~ ^https://script\.google\.com/(a/macros/[a-z0-9.-]+/|macros/)s/[A-Za-z0-9_-]{20,200}/exec$ ]]; then
  echo "That does not look like an Apps Script web app URL." >&2; exit 1
fi
ask EMAIL_FROM_ADDRESS "Google account that deployed the script (the sender address)"
EMAIL_FROM_ADDRESS="$(printf '%s' "$EMAIL_FROM_ADDRESS" | tr '[:upper:]' '[:lower:]')"
if [[ ! "$EMAIL_FROM_ADDRESS" =~ ^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$ ]]; then
  echo "Sender address is not valid." >&2; exit 1
fi
ask EMAIL_TERM_ID "Active term id (uuid from public.terms)"
if [[ ! "$EMAIL_TERM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Term id must be a lowercase uuid." >&2; exit 1
fi
ask EMAIL_PROVIDER_DOMAIN_ID "Sender binding id (uuid; leave blank to generate a new one)" ""
if [ -z "$EMAIL_PROVIDER_DOMAIN_ID" ]; then
  EMAIL_PROVIDER_DOMAIN_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
fi
if [[ ! "$EMAIL_PROVIDER_DOMAIN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Sender binding id must be a lowercase uuid." >&2; exit 1
fi
echo "Note: APP_ORIGIN is shared by every function (files, calendar-sync, google-oauth check it)."
ask APP_ORIGIN "App origin" "$DEFAULT_ORIGIN"
ask APP_BASE_PATH "App base path" "$DEFAULT_BASE_PATH"
if [[ ! "$APP_ORIGIN" =~ ^https://[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || [[ ! "$APP_BASE_PATH" =~ ^/([A-Za-z0-9._-]+/)*$ ]]; then
  echo "Origin must be https://host with no path; base path must start and end with /." >&2; exit 1
fi

echo
read -r -p "Apply pending database migrations now with 'supabase db push'? The project must already be linked. [y/N]: " push
if [[ "$push" =~ ^[Yy]$ ]]; then
  pnpm exec supabase db push
else
  echo "Skipping migrations. The new email-adapter needs migration 20261126090000_email_reminders applied first."
  read -r -p "Continue anyway? [y/N]: " go
  [[ "$go" =~ ^[Yy]$ ]] || exit 1
fi

NOTIFICATION_DISPATCH_SECRET="$(openssl rand -hex 32)"
EMAIL_DISPATCH_SECRET="$(openssl rand -hex 32)"
APPS_SCRIPT_HMAC_SECRET="$(openssl rand -hex 32)"

umask 077
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
{
  printf 'EMAIL_DIGEST_ENABLED=true\n'
  printf 'EMAIL_TRANSPORT=apps_script\n'
  printf 'APPS_SCRIPT_URL=%s\n' "$APPS_SCRIPT_URL"
  printf 'APPS_SCRIPT_HMAC_SECRET=%s\n' "$APPS_SCRIPT_HMAC_SECRET"
  printf 'EMAIL_DISPATCH_SECRET=%s\n' "$EMAIL_DISPATCH_SECRET"
  printf 'NOTIFICATION_DISPATCH_SECRET=%s\n' "$NOTIFICATION_DISPATCH_SECRET"
  printf 'EMAIL_FROM_ADDRESS=%s\n' "$EMAIL_FROM_ADDRESS"
  printf 'EMAIL_PROVIDER_DOMAIN_ID=%s\n' "$EMAIL_PROVIDER_DOMAIN_ID"
  printf 'EMAIL_TERM_ID=%s\n' "$EMAIL_TERM_ID"
  printf 'APP_ORIGIN=%s\n' "$APP_ORIGIN"
  printf 'APP_BASE_PATH=%s\n' "$APP_BASE_PATH"
} >"$ENV_FILE"

echo
echo "Setting Supabase function secrets..."
pnpm exec supabase secrets set --project-ref "$PROJECT_REF" --env-file "$ENV_FILE" >/dev/null

echo "Setting GitHub Actions secrets..."
printf '%s' "$NOTIFICATION_DISPATCH_SECRET" | gh secret set NOTIFICATION_DISPATCH_SECRET -R "$REPO" >/dev/null
printf '%s' "$EMAIL_DISPATCH_SECRET" | gh secret set EMAIL_DISPATCH_SECRET -R "$REPO" >/dev/null

echo "Deploying functions..."
for fn in dispatch-notifications email-adapter dispatch-telegram; do
  pnpm exec supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

cat <<EOF

Done.

Sender binding for supabase/snippets/approve-email-sender.sql (not secret):
  sender    = $EMAIL_FROM_ADDRESS
  domain_id = $EMAIL_PROVIDER_DOMAIN_ID
  term_id   = $EMAIL_TERM_ID

Paste this into Apps Script -> Project Settings -> Script properties as HMAC_SECRET.
It is shown only once; re-run this script to rotate it.

  HMAC_SECRET = $APPS_SCRIPT_HMAC_SECRET

Then run supabase/snippets/approve-email-sender.sql (two different admins) and trigger the
"Reminders" workflow once from the GitHub Actions tab.
EOF
