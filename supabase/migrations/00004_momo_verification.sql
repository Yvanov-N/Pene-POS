-- ============================================================================
-- Phase 7.2 -- Mobile Money manual SMS-verification tracking.
-- ============================================================================
--
-- Deliberately a NEW, separate column rather than repurposing sales.status:
-- that field already has an established meaning -- offline push/sync state
-- (pending_sync -> completed, or -> conflict_warning on an oversold-stock
-- race) -- that AdminConflictDashboard, TopBar's conflict badge, and
-- syncService's pushSale/processSyncQueue all rely on. Whether a MoMo sale's
-- SMS confirmation has been checked is an orthogonal concern: a sale can be
-- fully synced to Supabase AND still awaiting MoMo verification, or the
-- reverse. Overloading sales.status with a new value for this would corrupt
-- the meaning every existing consumer already assumes, so this gets its own
-- column instead. NULL for cash/student_wallet sales, for which MoMo
-- verification never applies.
--
-- No RLS/grant changes needed: sales already has a table-level grant to
-- authenticated (migration 1) and an unrestricted admin "for all" policy, and
-- neither is column-scoped the way profiles' grant is -- a new column is
-- automatically covered.
-- ============================================================================

alter table public.sales
  add column momo_verification_status text
  check (momo_verification_status in ('pending', 'confirmed', 'rejected'));
