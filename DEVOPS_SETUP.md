# DevOps setup — production deploy pipeline

`.github/workflows/deploy-production.yml` runs on every push to `main` (i.e. every merged PR) and:

1. Tags the release (`resolve-version`)
2. Pushes DB migrations + deploys all Supabase Edge Functions (`supabase-deploy`)
3. Builds and promotes the PWA on Vercel (`deploy-vercel`) — **skipped entirely if step 2 fails**
4. Posts a summary to the Actions run page (`summarize`)

Nothing above needs a version bump from CI: this repo already bumps `apps/web/public/changelog.json`
locally on every commit (`.githooks/post-commit`), so the commit that lands on `main` already carries
its final version. `resolve-version` just reads it and tags it — see the comment at the top of the
workflow file if you're wondering where the "bump" step is.

## Required GitHub Secrets

Add these under **Settings → Secrets and variables → Actions → Secrets** on the repo (not an
environment — this workflow doesn't use one).

| Secret | Used by | Where to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `supabase-deploy` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token. This is a *personal* access token for the CLI, not a project key. |
| `SUPABASE_PROJECT_ID` | `supabase-deploy`, `deploy-vercel` (build), `summarize` (optional push) | Supabase dashboard → your project → **Settings → General → Reference ID** (the `abcdefghijklmnop` in `https://abcdefghijklmnop.supabase.co`). |
| `SUPABASE_DB_PASSWORD` | `supabase-deploy` | The database password you set when the project was created. Lost it? Dashboard → **Settings → Database → Reset database password**. |
| `SUPABASE_SERVICE_ROLE_KEY` | `summarize` (optional, only if the push-notification step is enabled — see below) | Dashboard → **Settings → API → Project API keys → `service_role`**. This key bypasses RLS — GitHub secrets are encrypted at rest and masked in logs, but treat it with the same care as a database superuser password. |
| `VERCEL_TOKEN` | `deploy-vercel` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create token. |
| `VERCEL_ORG_ID` | `deploy-vercel` | Run `vercel link` once locally from `apps/web` (or the repo root — see below) with the Vercel CLI; it writes `.vercel/project.json` containing both `orgId` and `projectId`. Do **not** commit that file — it's already covered by the root `.env`-style gitignore rules... actually it isn't, so add `.vercel` to `.gitignore` if you run this locally. |
| `VERCEL_PROJECT_ID` | `deploy-vercel` | Same `.vercel/project.json` as above, or Vercel dashboard → project → **Settings → General → Project ID**. |
| `VITE_SUPABASE_URL` | `deploy-vercel` (build) | `https://<SUPABASE_PROJECT_ID>.supabase.co` — same project as above. |
| `VITE_SUPABASE_ANON_KEY` | `deploy-vercel` (build) | Dashboard → **Settings → API → Project API keys → `anon` `public`**. Safe to ship to the frontend by design (that's what RLS is for) — but keep it in Secrets rather than committed anyway, since it's still project-specific. |
| `VITE_VAPID_PUBLIC_KEY` | `deploy-vercel` (build) | The public half of the keypair Web Push uses — see `apps/web/.env.local` / `supabase/functions/.env` in local dev for the dev keypair. **Generate a separate, real keypair for production** (`npx web-push generate-vapid-keys`); never reuse the dev one. The private half goes to Supabase (below), never to Vercel/GitHub. |

The VAPID **private** key isn't in this table because it's not a GitHub secret at all — it's a
Supabase Edge Function secret. Set it directly against the linked project once:

```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT="mailto:you@yourdomain.com" \
  --project-ref <SUPABASE_PROJECT_ID>
```

(and `RESEND_API_KEY` the same way, if you want `notify-shop-status`'s student emails to actually send —
also not a GitHub secret, for the same reason.)

## Optional: push notification on deploy

The last step in `summarize` pings all admins via `dispatch-push` when a deploy succeeds. It's off by
default (a failed announcement push shouldn't be able to make a deploy look broken, so it's gated
behind a repo *variable*, not just left unconditional). To turn it on:

**Settings → Secrets and variables → Actions → Variables tab** → add `ENABLE_DEPLOY_PUSH_NOTIFICATION` = `true`.

This also requires `SUPABASE_SERVICE_ROLE_KEY` (table above) to be set, since `dispatch-push` only
allows a role-wide broadcast when called with that key.

## One-time Vercel dashboard setting

This is a pnpm monorepo — the actual frontend lives in `apps/web`, not the repo root. In the Vercel
project's dashboard: **Settings → General → Root Directory** → set to `apps/web`. The workflow runs
`vercel pull` / `vercel build` / `vercel deploy` from the repo root and relies entirely on this setting
to find the right app; without it, Vercel will try to build the monorepo root and fail (or build the
wrong thing).

## Branch protection

This workflow assumes `main` only ever changes via a merged PR (no direct pushes). If that's not
already enforced: repo **Settings → Branches → Add branch protection rule** for `main`, require a PR
before merging.

## Sanity checklist before the first real run

- [ ] All 9 secrets in the table above are set.
- [ ] Vercel project's Root Directory is `apps/web`.
- [ ] Production Supabase project has its own VAPID keypair and (if wanted) `RESEND_API_KEY` set via
      `supabase secrets set` — **not** copied from local dev.
- [ ] `main` has branch protection requiring PRs.
- [ ] `ENABLE_DEPLOY_PUSH_NOTIFICATION` left unset (or `false`) until you've actually verified a manual
      `dispatch-push` call against production works — the first real deploy is not the moment to find
      out it doesn't.
