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

-- ----------------------------------------------------------------------------
-- shop_status Database Webhook -> notify-shop-status edge function.
--
-- No admin UI mutates shop_status yet (that's a separate, un-built feature),
-- so this is the "Database Webhook" wiring option rather than "called by the
-- sync engine" -- fully contained here, nothing else needs to exist for it
-- to fire. supabase_functions.http_request (confirmed present locally) POSTs
-- a body shaped {type, table, schema, record, old_record} built from the
-- trigger context -- notify-shop-status must expect exactly that shape.
-- `kong` is the API gateway's internal Docker network alias; this call never
-- blocks the actual UPDATE (pg_net is async/fire-and-forget).
--
-- Kong itself gatekeeps every /functions/v1/* route on a valid `apikey`
-- header before the request ever reaches the edge runtime -- confirmed live:
-- omitting it gets a 401 "Missing authorization header" straight from Kong,
-- before notify-shop-status's own code runs at all. The value below is the
-- anon key, which is designed to be public (it's the same well-known default
-- for every local Supabase stack, derived from the local JWT secret) -- safe
-- to commit here, unlike a service_role key. When deploying to a real hosted
-- project, replace it with that project's actual anon key.
-- ----------------------------------------------------------------------------
create trigger shop_status_notify
  after update on public.shop_status
  for each row
  execute function supabase_functions.http_request(
    'http://kong:8000/functions/v1/notify-shop-status',
    'POST',
    '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}',
    '{}',
    '5000'
  );

-- ----------------------------------------------------------------------------
-- inventory-alerts scheduling. "Scheduled (Cron)" needs to be configured
-- somewhere real, not just implied by the function existing -- pg_cron +
-- pg_net is the actual mechanism behind Supabase's Dashboard "Cron Jobs"
-- feature (confirmed pg_cron is available, just not yet enabled, on this
-- local stack). Hourly is a reasonable default for a campus shop; adjust to
-- taste.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'inventory-alerts-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/inventory-alerts',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
