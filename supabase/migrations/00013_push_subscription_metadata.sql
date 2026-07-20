-- ============================================================================
-- Phase 15 -- push_subscriptions metadata for the diagnostic tester and for
-- dead-endpoint pruning (dispatch-push / inventory-alerts / notify-shop-status,
-- all via the new _shared/webpush.ts helper).
-- ============================================================================
--
-- device_label: captured from navigator.userAgent at subscribe time so an
-- admin looking at "N devices linked" has some way to tell them apart later
-- (a future per-device list is out of scope here, but the column existing
-- now means that UI never needs a backfill).
--
-- last_used_at: bumped on every push a device actually accepts (see
-- sendToSubscriptions in _shared/webpush.ts) -- distinct from created_at,
-- which never changes. Nothing prunes on staleness alone today (only a
-- push service's own 404/410 response does), but the column existing means
-- a future "stale after N days" sweep doesn't need its own migration.
-- ----------------------------------------------------------------------------

alter table public.push_subscriptions
  add column if not exists device_label text,
  add column if not exists last_used_at timestamptz not null default now();
