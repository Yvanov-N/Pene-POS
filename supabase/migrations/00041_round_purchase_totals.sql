-- ============================================================================
-- Purchase totals rounded to the franc.
-- ============================================================================
--
-- Why: a unit cost can carry cents (a pack price split per unit: 1 000 FCFA
-- for 12 -> 83.33 each), and quantity x unit_cost then gives 999.96 -- but
-- what's actually paid to the supplier is whole francs. stock_purchases
-- .total_cost (00036) is a generated column, so the rounding goes there;
-- the client rounds the same way (lib/money.ts purchaseLineTotal). Purchases
-- only: sale amounts keep their exact value.
--
-- PG15 can't change a generation expression in place (ALTER COLUMN ... SET
-- EXPRESSION is PG17+), hence drop + re-add; every existing row is
-- recomputed. The no-op UPDATE then bumps sync_seq (touch_sync_columns,
-- 00022) so devices re-pull the rounded totals into their local copy.
-- ============================================================================

alter table public.stock_purchases drop column total_cost;
alter table public.stock_purchases
  add column total_cost numeric generated always as (round(quantity * unit_cost)) stored;

update public.stock_purchases set unit_cost = unit_cost;
