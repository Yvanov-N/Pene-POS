-- ============================================================================
-- Phase 5 -- Web Push subscriptions + shop_status Database Webhook.
-- ============================================================================
--
-- push_subscriptions.user_id = auth.uid() is the correct ownership model
-- here, unlike sales.cashier_id (migration 2): a PushSubscription object
-- lives in *this* browser's service worker while *this* Supabase session is
-- authenticated -- it's not attributed by the offline local-PIN cashier
-- identity the way a sale is, so there's no two-layer-auth mismatch to
-- relax for.
-- ============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- update is required, not just select/insert/delete: pushService.ts upserts
-- on (user_id, endpoint) conflict, and INSERT ... ON CONFLICT DO UPDATE
-- needs UPDATE privilege on the table for its conflict-resolution branch --
-- confirmed live: without it, PostgREST returned a clean 42501 "permission
-- denied for table push_subscriptions" on the very first subscribe attempt.
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy "push_subscriptions_admin_all"
  on public.push_subscriptions for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "push_subscriptions_own"
  on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- service_role table grants -- a real bug found while testing this phase's
-- edge functions, not something specific to push_subscriptions: BYPASSRLS
-- (which service_role has) only bypasses row-level security *policies* --
-- it does not grant the base table-level privilege Postgres checks first.
-- Migration 1 explicitly granted authenticated but never granted
-- service_role anything, so it silently had only the default
-- REFERENCES/TRIGGER/TRUNCATE privileges everyone gets -- confirmed live: a
-- real service_role JWT got "permission denied for table student_wallets"
-- straight from PostgREST, before this fix. service_role is server-side-only
-- (edge functions), so a full grant including profiles.pin_code is correct
-- here, unlike the column-restricted grant given to authenticated.
grant select, insert, update, delete on
  public.profiles,
  public.products,
  public.sales,
  public.sale_items,
  public.student_wallets,
  public.shop_status,
  public.push_subscriptions
to service_role;

-- shop_status Database Webhook -> notify-shop-status, and inventory-alerts
-- scheduling both moved to migration 00014: this migration's original
-- versions called supabase_functions.http_request, a schema that turned out
-- to exist on the local dev image but NOT on a real hosted project
-- (confirmed live: `ERROR: schema "supabase_functions" does not exist`,
-- which rolled back this entire migration -- push_subscriptions included --
-- on the very first real deploy attempt). Since this migration had never
-- successfully applied anywhere but local dev at that point, moving the
-- trigger/cron setup forward to a later migration (rather than leaving a
-- known-broken statement here) is safe -- see 00014 for the working
-- pg_net-based replacement and the full story on why.
