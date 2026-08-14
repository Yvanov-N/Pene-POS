-- ============================================================================
-- Soft delete for student_wallets, same shape as migration 00023's
-- products/categories soft delete.
-- ============================================================================
--
-- Why: 00023 deliberately left student_wallets out of scope ("no delete UI
-- path today"). That UI path now exists (an admin can archive a student),
-- and a hard DELETE would either fail outright (sales.student_id references
-- student_wallets with no `on delete` clause -- Postgres default is
-- RESTRICT, so any wallet with sale history blocks a raw delete) or, for a
-- wallet with no sales yet, silently erase it with no tombstone for other
-- devices' cursor-based pull to notice. A nullable deleted_at turns
-- "archive" into an ordinary UPDATE instead, exactly like 00023 did for
-- products/categories -- picked up by the same sync_seq-cursor pull
-- mechanism, and restorable by clearing the column back to null.
-- ============================================================================

alter table public.student_wallets add column deleted_at timestamptz;

create index idx_student_wallets_deleted_at on public.student_wallets (deleted_at) where deleted_at is not null;
