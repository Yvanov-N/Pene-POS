-- ============================================================================
-- Rebuild of get_public_receipt (originally migration 00006, extended by
-- 00009 for student_name). Migrations 00006/00009 are historical/applied and
-- are intentionally NOT edited or deleted -- this is a fresh forward
-- migration that redefines the same function name/signature so every
-- existing call site (ReceiptPage.tsx, supabase/functions/_shared/receipt.ts)
-- keeps working unchanged.
--
-- Nothing about this function's SQL was ever actually broken -- confirmed
-- live (SET ROLE anon; select public.get_public_receipt(...) returned full,
-- correct JSON for a synced sale). The real bug was architectural: sharing
-- was never gated on the sale existing server-side yet, and the client gave
-- up on one null instead of confirming sync. That's fixed at the application
-- layer (see services/syncService.ts's confirmSaleSynced and
-- ReceiptPage.tsx's rewritten fetch state machine) -- this migration exists
-- only so the feature's full rewrite has one canonical, freshly-owned
-- definition to build on going forward, not because the query itself needed
-- to change.
--
-- Preserved from 00006/00009, still true: sale_id is a random uuid
-- (gen_random_uuid default) with no enumeration path, so a single-sale
-- SECURITY DEFINER lookup for anon is safe. cashier_id/student_wallet id are
-- still deliberately excluded from the JSON. student_name is still included
-- despite 00006's original narrower stance (00009 already made and
-- documented that call for the "Client / Etudiant" receipt badge) -- not
-- revisited here.
-- ============================================================================

create or replace function public.get_public_receipt(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', s.id,
    'created_at', s.created_at,
    'payment_method', s.payment_method,
    'total_amount', s.total_amount,
    'status', s.status,
    'cashier_name', p.full_name,
    'student_name', sw.student_name,
    'items', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'product_name', pr.name,
          'quantity', si.quantity,
          'unit_price', si.unit_price
        ) order by si.id)
        from public.sale_items si
        left join public.products pr on pr.id = si.product_id
        where si.sale_id = s.id
      ),
      '[]'::jsonb
    )
  )
  into result
  from public.sales s
  left join public.profiles p on p.id = s.cashier_id
  left join public.student_wallets sw on sw.id = s.student_id
  where s.id = p_sale_id;

  return result; -- null if no matching sale -- caller treats this as "not found"
end;
$$;

revoke all on function public.get_public_receipt(uuid) from public;
grant execute on function public.get_public_receipt(uuid) to anon, authenticated;
