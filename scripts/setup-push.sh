#!/usr/bin/env bash
# One-time setup for device notifications (Web Push). Run it yourself from the app folder:
#   bash scripts/setup-push.sh
#
# Needs: openssl, gh (logged in, admin on the repository), pnpm install done, and
# `pnpm exec supabase login` done. It will:
#   1. make a VAPID key pair locally (EC P-256) in a private temporary folder
#   2. store VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT as Supabase function secrets
#      (through an env file that only you can read, deleted at the end)
#   3. set the public key as the GitHub Actions variable VITE_VAPID_PUBLIC_KEY for the Pages build
#   4. optionally redeploy dispatch-notifications
# The private key is never printed or passed on a command line. Only the public key is shown.
#
# Running it again makes a NEW key pair. Every device that turned notifications on stops getting
# them until its owner turns them on again, so only re-run it if the private key may have leaked.
set -euo pipefail

REPO="Koala3353/tedx-core-workspace"
PROJECT_REF="wyurosneoxfqqrrvstke"

cd "$(dirname "$0")/.."

for tool in openssl gh pnpm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

if pnpm exec supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null | grep -q 'VAPID_PUBLIC_KEY'; then
  echo "Device notification keys are already set for this project."
  echo "Making new ones turns notifications off on every device until each person turns them on again."
  read -r -p "Replace them anyway? [y/N]: " replace
  [[ "$replace" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 0; }
fi

read -r -p "Contact for the push services (an email address the team reads): " CONTACT
CONTACT="$(printf '%s' "$CONTACT" | tr '[:upper:]' '[:lower:]')"
if [[ ! "$CONTACT" =~ ^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$ ]]; then
  echo "That is not an email address." >&2; exit 1
fi

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

openssl ecparam -name prime256v1 -genkey -noout -out "$WORK/vapid.pem" 2>/dev/null
# Public key: the 65-byte uncompressed point at the end of the SubjectPublicKeyInfo.
PUBLIC_KEY="$(openssl ec -in "$WORK/vapid.pem" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"
if [[ ! "$PUBLIC_KEY" =~ ^B[A-Za-z0-9_-]{86}$ ]]; then
  echo "Key generation failed (unexpected public key format)." >&2; exit 1
fi

# Private key: the 32-byte scalar in the SEC1 structure (30 77 02 01 01 04 20 <d>). Written straight
# into the env file, never into a variable or the terminal.
ENV_FILE="$WORK/push.env"
{
  printf 'VAPID_PUBLIC_KEY=%s\n' "$PUBLIC_KEY"
  printf 'VAPID_PRIVATE_KEY='
  openssl ec -in "$WORK/vapid.pem" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url
  printf '\n'
  printf 'VAPID_SUBJECT=mailto:%s\n' "$CONTACT"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
if ! grep -Eq '^VAPID_PRIVATE_KEY=[A-Za-z0-9_-]{43}$' "$ENV_FILE"; then
  echo "Key generation failed (unexpected private key format)." >&2; exit 1
fi

echo "Setting Supabase function secrets..."
pnpm exec supabase secrets set --project-ref "$PROJECT_REF" --env-file "$ENV_FILE" >/dev/null

echo "Setting the GitHub Actions variable VITE_VAPID_PUBLIC_KEY (public)..."
gh variable set VITE_VAPID_PUBLIC_KEY -R "$REPO" --body "$PUBLIC_KEY" >/dev/null

echo
read -r -p "Redeploy dispatch-notifications now so it starts sending? [Y/n]: " deploy
if [[ ! "$deploy" =~ ^[Nn]$ ]]; then
  pnpm exec supabase functions deploy dispatch-notifications --project-ref "$PROJECT_REF" --use-api
fi

cat <<EOF

Done. Public key (safe to share, also in the repository variable):

  $PUBLIC_KEY

Next:
  1. Make sure migration 20261129600000_device_push is applied (pnpm exec supabase db push).
  2. Publish the app: push to main, or run the "Deploy to GitHub Pages" workflow, so the build
     picks up VITE_VAPID_PUBLIC_KEY.
  3. Open Settings > Alerts and reminders, turn on "Notifications on this device" and send a test.
For local development, put the same public key in .env.local as VITE_VAPID_PUBLIC_KEY.
EOF
