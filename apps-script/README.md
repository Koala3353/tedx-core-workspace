# Email reminder relay (Google Apps Script)

The Supabase `email-adapter` function sends reminder emails through this small Apps Script web app
when `EMAIL_TRANSPORT=apps_script`. Mail goes out from the Google account that deploys the script,
with the display name "TEDxAteneodeManilaU Core Workspace".

## How it is called

```
POST <web app URL>?ts=<unix seconds>&sig=<hex HMAC-SHA256(HMAC_SECRET, ts + "." + rawBody)>
{"v":1,"action":"send","type":"task_due_soon","jobId":"<uuid>","to":"x@student.ateneo.edu",
 "subject":"...","text":"...","ts":"<same ts>","nonce":"<uuid>"}
```

- `doPost` cannot read headers, so the timestamp and signature are query parameters.
- Requests older or newer than 5 minutes, with a bad signature, or with a reused nonce are refused.
- Only `@student.ateneo.edu` recipients are accepted.
- A `jobId` that was sent in the last 6 hours is not sent again (CacheService plus LockService).
- The remaining MailApp daily quota is checked before every send.
- `action: "health"` returns `{"outcome":"ok","remaining":<quota left today>}`. The adapter calls it
  before each run and stops when it fails.
- Every response is HTTP 200 with JSON `{"outcome": "accepted" | "quota" | "retry" | "failed" | "ok", ...}`.
- `GET` returns the text `ok` and nothing else.

## Deploy

1. Sign in to the Google account that should send the reminders. A Google Workspace account is better
   because its daily quota is higher (see Quotas below).
2. Go to <https://script.google.com>, choose **New project**, and name it `TEDx reminder relay`.
3. Open **Project Settings**, turn on **Show "appsscript.json" manifest file in editor**, and set the
   time zone to `Asia/Manila`.
4. Replace the contents of `Code.gs` with [`Code.gs`](./Code.gs), and replace `appsscript.json` with
   [`appsscript.json`](./appsscript.json). Save.
5. Run `scripts/setup-reminders.sh` from the app folder. It prints `HMAC_SECRET` once. In **Project
   Settings -> Script properties**, add the property `HMAC_SECRET` with that value. (The script asks
   for the web app URL, so do step 6 in another tab first, or come back and re-run it.)
6. Choose **Deploy -> New deployment -> Web app** and set:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Click **Deploy** and approve the permissions (send email as you, see your email address).
8. Copy the **Web app URL** (it ends in `/exec`). That is `APPS_SCRIPT_URL`.
9. In the editor, run `doGet` once to check that the project saves and authorizes cleanly.

To change the code later, use **Deploy -> Manage deployments -> Edit -> Version: New version** so the
URL stays the same. Creating a new deployment gives a new URL, and then `APPS_SCRIPT_URL` has to be
updated in Supabase.

"Who has access: Anyone" is needed because the caller is a server, not a signed-in Google user. The
HMAC signature, the time window and the nonce check are what keep other callers out. Do not paste the
secret into the code, a document or a chat; it lives only in Script properties and Supabase secrets.

### Optional: `NO_REPLY`

On Google Workspace accounts the relay sends with `noReply: true` (from a no-reply address). Consumer
`@gmail.com` accounts do not support that option, so it is off there. Set the Script property
`NO_REPLY` to `true` or `false` to override.

## Quotas

| Account type                       | MailApp recipients per day |
| ---------------------------------- | -------------------------- |
| Consumer Google account (gmail)    | about 100                  |
| Google Workspace account           | 1,500                      |

The database also caps sends per day through `daily_cap` in `app_private.email_sender_approvals`
(1 to 1,500). Set it at or below the account's quota; see `supabase/snippets/approve-email-sender.sql`.
When MailApp runs out, the relay answers `quota` and sending pauses for 24 hours.

## Rotating the secret

Re-run `scripts/setup-reminders.sh`, then paste the new value into `HMAC_SECRET` in Script
properties. Sends fail with `denied` between the two steps, so do it outside 08:00-20:00 Manila time.
