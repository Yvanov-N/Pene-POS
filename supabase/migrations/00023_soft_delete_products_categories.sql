-- ============================================================================
-- Sync rebuild, part 2 -- soft delete for products/categories.
-- ============================================================================
--
-- Why: a hard DELETE is invisible to a sync_seq-cursor pull -- there is no
-- row left to return with a sync_seq greater than the client's cursor, so a
-- product deleted on one device would never be removed from another
-- device's local Dexie copy. Soft-deleting (setting deleted_at) turns a
-- delete into an ordinary UPDATE, which the sync_seq trigger from the
-- previous migration already stamps and makes visible to the next
-- incremental pull like any other change.
--
-- Scoped to products/categories only -- the two tables an admin actually
-- deletes rows from during normal use (ProductsPage's delete guard,
-- category management). sales/sale_items/student_wallets/profiles have no
-- delete UI path today and are out of scope here.
--
-- RLS is deliberately left unchanged: a select policy filtering out
-- deleted_at rows would also hide them from the sync pull that's supposed
-- to propagate the deletion in the first place. Filtering deleted rows out
-- of business-facing reads (ProductGrid, admin tables) is a client-side
-- concern, not a row-security one -- an admin can still see/undelete a
-- soft-deleted row if a future feature needs that.
-- ============================================================================

alter table public.products add column deleted_at timestamptz;
alter table public.categories add column deleted_at timestamptz;

create index idx_products_deleted_at on public.products (deleted_at) where deleted_at is not null;
create index idx_categories_deleted_at on public.categories (deleted_at) where deleted_at is not null;
