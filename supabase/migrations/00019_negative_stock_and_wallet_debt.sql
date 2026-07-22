-- ============================================================================
-- Network-first pivot, part 1: allow negative stock and negative wallet
-- balance from a genuine cross-terminal race, instead of surfacing it as a
-- sync conflict needing manual admin resolution.
-- ============================================================================
--
-- Supersedes products_stock_non_negative (added in migration 00002, and
-- still described as "active" in 00015_atomic_complete_sale.sql's own
-- comments -- that description is now stale historical narrative and is
-- deliberately left unedited there: migrations are immutable history in this
-- repo, corrections land in the newest migration's comments, not by
-- rewriting an old one). Dropping this constraint means complete_sale's
-- (migration 00015) stock decrement now succeeds on an oversell instead of
-- raising 23514 -- negative stock becomes a normal, expected state, surfaced
-- to admins via a UI badge (ProductGrid.tsx, ProductsPage.tsx,
-- OperationalWidgets.tsx) instead of blocking sync. conflictResolver.ts's
-- resolveByAdjustingStock/resolveByAcceptingNegativeStock become unreachable
-- for stock specifically -- left in place, not dead code overall (still
-- relevant to other conflict shapes, e.g. unique_violation on badge_code).
alter table public.products drop constraint products_stock_non_negative;

-- adjust_wallet_balance: remove the manual "insufficient balance" guard
-- added in migration 00010 -- same rationale as above. A wallet going
-- negative from a genuine cross-terminal spending race is now treated
-- exactly like the already-supported admin-entered negative starting
-- balance, rather than being surfaced as a sync conflict.
create or replace function public.adjust_wallet_balance(p_wallet_id uuid, p_delta numeric)
returns public.student_wallets
language plpgsql
security invoker
as $$
declare
  updated_wallet public.student_wallets;
begin
  update public.student_wallets
  set balance = balance + p_delta
  where id = p_wallet_id
  returning * into updated_wallet;

  if not found then
    raise exception 'student wallet % not found', p_wallet_id;
  end if;

  return updated_wallet;
end;
$$;
