-- ============================================================================
-- Sync watermarks: "has anything changed?" in one request.
-- ============================================================================
--
-- Why: every sync cycle (every 30s per open device, plus every Realtime
-- notification) ran one incremental `select ... where sync_seq > cursor`
-- per syncable table -- 11 requests, almost always returning nothing. A
-- measured idle POS made ~1 560 requests/hour just to learn that.
--
-- Every syncable table is stamped from the same sequence (sync_seq,
-- migrations 00022/00030), so the highest sync_seq per table is a complete
-- change marker: a new row, an update and a soft delete (deleted_at set
-- through a normal UPDATE) all bump it. The client compares these against
-- its own per-table cursors and pulls only the tables that moved -- usually
-- none.
--
-- security invoker: max() runs under the caller's RLS, so a cashier session
-- gets null for the admin-only tables (suppliers, purchases...) exactly as
-- its pulls already return nothing there. Each max() is a backward scan of
-- that table's sync_seq index.
-- ============================================================================

create or replace function public.sync_watermarks()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'categories', (select max(sync_seq) from public.categories),
    'products', (select max(sync_seq) from public.products),
    'student_wallets', (select max(sync_seq) from public.student_wallets),
    'sales', (select max(sync_seq) from public.sales),
    'sale_items', (select max(sync_seq) from public.sale_items),
    'profiles', (select max(sync_seq) from public.profiles),
    'shop_status', (select max(sync_seq) from public.shop_status),
    'suppliers', (select max(sync_seq) from public.suppliers),
    'supplier_products', (select max(sync_seq) from public.supplier_products),
    'stock_purchases', (select max(sync_seq) from public.stock_purchases),
    'supplier_price_history', (select max(sync_seq) from public.supplier_price_history)
  );
$$;

revoke execute on function public.sync_watermarks() from public, anon;
grant execute on function public.sync_watermarks() to authenticated;
