-- ============================================================================
-- Sync rebuild follow-up -- give sync_seq a cheap literal default.
-- ============================================================================
--
-- Why: migration 00022 added sync_seq as NOT NULL with no DEFAULT on every
-- syncable table, relying entirely on the touch_sync_columns BEFORE INSERT
-- trigger to populate it. That's correct at the database level -- the
-- trigger unconditionally overwrites new.sync_seq before the row is ever
-- stored, so a real INSERT never actually fails -- but `supabase gen types`
-- has no visibility into trigger behavior, only raw column DDL, so it
-- correctly (from its own vantage point) marked sync_seq as REQUIRED on
-- every generated Insert type. That broke the production Vercel build: the
-- new sync test suite's direct, strongly-typed .insert() calls (
-- reconciliation.fuzz.test.ts, testHelpers.ts) don't pass sync_seq, since
-- nothing in application code ever needs to -- the trigger was always going
-- to overwrite it anyway. Confirmed live: supabase-deploy succeeded and
-- applied migrations 00022-00029 to production before this specific
-- Vercel build step failed, so this migration lands on top of that,
-- additive as always.
--
-- 0, not nextval('public.sync_seq') -- a real sequence-backed default would
-- work too, but burns a sequence value on every insert only to have the
-- trigger immediately overwrite it with a second one. A cheap literal is
-- enough: it only ever exists transiently before the trigger runs, never
-- actually persisted.
-- ============================================================================

alter table public.products alter column sync_seq set default 0;
alter table public.categories alter column sync_seq set default 0;
alter table public.profiles alter column sync_seq set default 0;
alter table public.shop_status alter column sync_seq set default 0;
alter table public.sales alter column sync_seq set default 0;
alter table public.sale_items alter column sync_seq set default 0;
alter table public.student_wallets alter column sync_seq set default 0;
