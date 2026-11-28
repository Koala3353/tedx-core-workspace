#!/usr/bin/env bash
# Makes fresh reminder dispatch secrets and stores them everywhere they're needed:
#   - Supabase function secrets (dispatch-notifications, email-adapter read them on the next call)
#   - GitHub Actions secrets (the "Reminders" workflow, kept as a backup)
#   - printed ONCE here, for you to paste into Apps Script > Project Settings > Script properties
# Run it yourself from the app folder:  bash scripts/rotate-dispatch-secrets.sh
# Needs: openssl, gh (logged in, admin on the repo), and `pnpm exec supabase login` done.
set -euo pipefail
REPO="Koala3353/tedx-core-workspace"
PROJECT_REF="wyurosneoxfqqrrvstke"
cd "$(dirname "$0")/.."
for tool in openssl gh pnpm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

NOTIFICATION_DISPATCH_SECRET="$(openssl rand -hex 32)"
EMAIL_DISPATCH_SECRET="$(openssl rand -hex 32)"

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"
printf 'NOTIFICATION_DISPATCH_SECRET=%s\nEMAIL_DISPATCH_SECRET=%s\n' "$NOTIFICATION_DISPATCH_SECRET" "$EMAIL_DISPATCH_SECRET" > "$ENV_FILE"

echo "Saving to Supabase function secrets..."
pnpm exec supabase secrets set --project-ref "$PROJECT_REF" --env-file "$ENV_FILE" >/dev/null
echo "Saving to GitHub Actions secrets..."
printf '%s' "$NOTIFICATION_DISPATCH_SECRET" | gh secret set NOTIFICATION_DISPATCH_SECRET -R "$REPO" >/dev/null
printf '%s' "$EMAIL_DISPATCH_SECRET" | gh secret set EMAIL_DISPATCH_SECRET -R "$REPO" >/dev/null

cat <<EOF

Done. Now open the Apps Script project (TEDx reminder relay) > Project Settings > Script properties
and add (or replace) these two properties. They are shown only this once:

  NOTIFICATION_DISPATCH_SECRET = $NOTIFICATION_DISPATCH_SECRET
  EMAIL_DISPATCH_SECRET        = $EMAIL_DISPATCH_SECRET

Then, in the editor, pick installReminderTrigger in the function menu and press Run (approve the
permission prompt). After that, runReminders runs every 15 minutes on its own.
EOF
