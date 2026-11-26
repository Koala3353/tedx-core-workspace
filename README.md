# TEDx Core Dashboard

React and TypeScript webapp with Supabase database migrations and Edge Functions. This branch contains the application source, public assets, backend source, and build configuration.

## Local development

Use Node.js 24 LTS and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173/. With no environment settings, the app displays its Setup needed screen. Copy `.env.example` to `.env.local` and supply the public Supabase settings for an approved development project. Never put service-role keys, OAuth secrets, database passwords, or other server credentials in `VITE_` settings.

## Check and build

```sh
pnpm typecheck
pnpm typecheck:files
pnpm lint
pnpm build
pnpm preview
```

The static frontend is generated in `dist/`. For an approved Pages environment, set the exact HTTPS frontend origin and public Supabase configuration, then run `pnpm build:pages`.

### GitHub Pages

`.github/workflows/pages.yml` type-checks, lints, builds and deploys on push. Set the repository variables listed at the top of that file and choose **GitHub Actions** as the Pages source.

- `PAGES_BASE_PATH` (build-time, not a `VITE_` setting) sets the URL prefix. It defaults to `/<repository>/` for a project site; use `/` for a custom domain. The router, sign-in callback, service worker and manifest all follow it.
- The Pages build writes `404.html` (deep links), `.nojekyll`, and a Content-Security-Policy `<meta>` tag, because Pages ignores `_headers`. Frame protection comes from `src/main.tsx`, which refuses to render inside a frame.
- In Supabase Auth, set the Site URL to `<origin><base>` and add `<origin><base>auth/callback` to the redirect allow-list.
- A project site shares its origin (and browser storage) with every other site under the same `*.github.io` account. Prefer a custom domain for production.

## Backend

`supabase/migrations/` contains 95 ordered database migrations. `supabase/functions/` contains the Edge Functions, and `supabase/config.toml` contains the local Supabase configuration. The pinned Supabase CLI is available through `pnpm exec supabase`. Inspect the target and migration ledger before applying changes. Synthetic development seeds and audit/test fixtures are excluded from this branch. Configure function secrets in the approved server environment. Optional integrations remain disabled until configured and authorized.

## Deployment status

The hosted app is at https://tedxateneodashboard.vercel.app. Sign-in uses Google and requires a current approved roster entry. Google OAuth must be configured in the connected Supabase project before accounts can sign in.

There is no privacy-notice step or publication prerequisite in the sign-in flow. Old `/privacy-notice` links redirect to sign-in. Account verification, exact callback origins, roster checks and database access policies still apply.
