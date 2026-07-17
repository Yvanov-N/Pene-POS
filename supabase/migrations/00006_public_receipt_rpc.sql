-- ============================================================================
-- Phase 9.1 -- public receipt sharing RPC.
-- ============================================================================
--
-- anon has zero table grants by design (see migration 1: "anon gets nothing
-- since this is an internal POS"). A shared receipt link needs to work for
-- someone who never logged into this POS at all, so this is a deliberate,
-- narrow exception: a single SECURITY DEFINER function that returns exactly
-- the fields a receipt needs for one specific sale_id, nothing else.
--
-- This is safe specifically because sale_id is a random uuid (gen_random_uuid
-- default, migration 1) -- there is no enumeration path to iterate/scrape
-- every sale the way there would be with a sequential id, and the function
-- returns a single sale's data, never a list. cashier_id/student_wallet_id
-- are deliberately NOT included in the returned JSON (a receipt doesn't need
-- the cashier's raw id, and exposing which specific student wallet paid is
-- unnecessary exposure for a link that might be forwarded further).
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
  where s.id = p_sale_id;

  return result; -- null if no matching sale -- caller treats this as "not found"
end;
$$;

revoke all on function public.get_public_receipt(uuid) from public;
grant execute on function public.get_public_receipt(uuid) to anon, authenticated;
