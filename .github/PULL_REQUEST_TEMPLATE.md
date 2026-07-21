## Summary

<!-- What does this change, and why? -->

## Type of change

<!-- Matches your commit's conventional-commit prefix, which
     .githooks/post-commit reads to decide the version bump on merge. -->

- [ ] `feat:` — new feature (**minor** bump)
- [ ] `fix:` / `refactor:` / `chore:` / other — fix or non-feature change (**patch** bump)
- [ ] `feat!:` or a `BREAKING CHANGE:` footer — breaking change (**major** bump)

## Backend impact

- [ ] Adds/changes a file in `supabase/migrations/`
- [ ] Adds/changes a file in `supabase/functions/`
- [ ] Neither — frontend-only

If either box above is checked, merging to `main` deploys it straight to production
(`.github/workflows/deploy-production.yml` pushes migrations and edge functions before the frontend
even builds). Migrations should be additive/backwards-compatible — this pipeline has no rollback step.

## Testing

<!-- This repo's convention: typecheck/build passing is necessary but not sufficient. -->

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] Verified live (describe the scenario below — which page/flow, what you clicked, what you expected)

## Screenshots (if UI-facing)
