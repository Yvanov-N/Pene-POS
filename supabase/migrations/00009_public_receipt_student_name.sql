-- ============================================================================
-- Extends get_public_receipt (migration 00006) to also surface the linked
-- student's name, now that Page 4 makes student attribution a real feature
-- (sales.student_id, renamed from student_wallet_id in migration 00008).
--
-- This is a deliberate reversal of migration 00006's own original stance
-- ("student_wallet_id [is] deliberately NOT included... exposing which
-- specific student wallet paid is unnecessary exposure for a link that
-- might be forwarded further"). That reasoning was sound and is still worth
-- knowing: a receipt forwarded beyond its original two-party share now
-- reveals the buyer's name to whoever it lands with. This migration ships
-- it anyway because the current spec explicitly asks for a "Client /
-- Etudiant : [Nom]" badge on the public receipt -- flagged here rather than
-- silently dropped or silently overriding the earlier call without a trace.
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
