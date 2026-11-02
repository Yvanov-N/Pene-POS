-- ============================================================================
-- Realtime: broadcast the rest of the POS-facing tables.
-- ============================================================================
--
-- Why: clients now apply Realtime change payloads straight into their local
-- Dexie mirror (no follow-up request), instead of treating a notification as
-- "go pull" (useRealtimeSync). That only covers tables in the publication --
-- 00016 added products, sales and student_wallets. A checkout also writes
-- sale_items (sales history, best-seller order, student stats), and the
-- shop open/closed toggle and category edits are shown on every till, so
-- those join too. Admin-only tables (suppliers, purchases, price history)
-- and profiles stay out: they change rarely and the periodic watermark sync
-- (00039) picks them up.
--
-- Realtime still enforces each subscriber's RLS on these rows, exactly as a
-- direct select would.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['sale_items', 'categories', 'shop_status'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
