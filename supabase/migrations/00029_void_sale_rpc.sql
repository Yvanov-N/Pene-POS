-- ============================================================================
-- Sync rebuild, part 8 -- a server-side, atomic void/refund RPC.
-- ============================================================================
--
-- Why: refundService.ts's voidSale (client-orchestrated today) computes
-- restock quantities from a LOCAL Dexie snapshot and pushes whole-row
-- product/wallet/sale updates as three independent network calls. Two
-- confirmed problems this closes: (1) the stock/wallet snapshot can be
-- stale by the time the write lands, silently clobbering a concurrent
-- sale on another terminal; (2) a failure between the three independent
-- calls can leave stock restored but the sale still marked active, or any
-- other partial combination.
--
-- This RPC looks up the sale and its items ITSELF, server-side, under a row
-- lock (`for update`) -- it never trusts a client-supplied stock/balance
-- snapshot. Restocking and the wallet credit-back reuse the same
-- adjust_product_stock / adjust_wallet_balance delta RPCs complete_sale
-- uses, so there's one code path for "atomically change stock/balance by a
-- delta," not a third, separately-written one for refunds. Everything
-- (row lock, restocks, wallet credit, status flip) happens in one
-- transaction, ledger-guarded like every other RPC added this phase.
--
-- The "is this caller really an admin" check mirrors refundService.ts's own
-- existing comment ("a 'secure' refund path is worth a second,
-- service-level check... rather than trusting the UI layer alone") -- RLS
-- alone doesn't block a cashier from calling this (sales_update_cashier has
-- no ownership/role-scoping left after migration 00002), so the check is
-- done explicitly in application logic here, same as the client already
-- did before this rebuild.
-- ============================================================================

create or replace function public.void_sale(
  p_operation_id uuid,
  p_sale_id uuid,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing public.sync_operations;
  -- Only the column actually needed, not `select *` -- profiles has a
  -- column-scoped select grant (migration 00010) that excludes pin_code,
  -- and `select *` requires every column in the row type to be individually
  -- granted, not just the ones actually read. Confirmed live: `select *
  -- into public.profiles` here raised "permission denied for table
  -- profiles" even though `role` itself is grantable.
  v_admin_role public.user_role;
  v_sale public.sales;
  v_item record;
  v_stock_result jsonb;
  v_wallet_result jsonb;
  v_line_results jsonb := '[]'::jsonb;
  v_conflict_reason text;
begin
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    return jsonb_build_object('outcome', 'replayed', 'operation_id', p_operation_id, 'result', v_existing.result);
  end if;

  select role into v_admin_role from public.profiles where id = p_admin_id;
  if not found or v_admin_role <> 'admin' then
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result, created_by)
    values (p_operation_id, 'void_sale', 'sales', p_sale_id, 'conflict',
      jsonb_build_object('reason', 'not_authorized'), p_admin_id);
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', 'not_authorized');
  end if;

  begin
    -- Row lock: two concurrent void attempts on the same sale (e.g. an
    -- admin double-clicking, or a retried offline void) serialize here
    -- instead of both restocking/crediting.
    select * into v_sale from public.sales where id = p_sale_id for update;
    if not found then
      raise exception 'sale % not found', p_sale_id;
    end if;
    if v_sale.status = 'refunded' then
      raise exception 'sale % already refunded', p_sale_id;
    end if;

    for v_item in select * from public.sale_items where sale_id = p_sale_id loop
      v_stock_result := public.adjust_product_stock(
        gen_random_uuid(), v_item.product_id, v_item.quantity, 'void:' || p_sale_id::text
      );
      if v_stock_result->>'outcome' = 'conflict' then
        raise exception 'stock restore conflict for product %: %',
          v_item.product_id, v_stock_result->>'reason';
      end if;
      v_line_results := v_line_results || jsonb_build_array(v_stock_result);
    end loop;

    if v_sale.payment_method = 'student_wallet' and v_sale.student_id is not null then
      v_wallet_result := public.adjust_wallet_balance(
        gen_random_uuid(), v_sale.student_id, v_sale.total_amount, 'void:' || p_sale_id::text
      );
      if v_wallet_result->>'outcome' = 'conflict' then
        raise exception 'wallet credit-back conflict for wallet %: %',
          v_sale.student_id, v_wallet_result->>'reason';
      end if;
    end if;

    update public.sales set status = 'refunded' where id = p_sale_id returning * into v_sale;
  exception when others then
    get stacked diagnostics v_conflict_reason = message_text;
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result, created_by)
    values (p_operation_id, 'void_sale', 'sales', p_sale_id, 'conflict',
      jsonb_build_object('reason', v_conflict_reason), p_admin_id);
    insert into public.sync_events (event_type, severity, entity_table, entity_id, operation_id, message)
    values ('void_sale_conflict', 'error', 'sales', p_sale_id, p_operation_id, v_conflict_reason);
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', v_conflict_reason);
  end;

  insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result, created_by)
  values (p_operation_id, 'void_sale', 'sales', p_sale_id, 'completed',
    jsonb_build_object('sale', to_jsonb(v_sale), 'lines', v_line_results), p_admin_id);

  return jsonb_build_object('outcome', 'completed', 'operation_id', p_operation_id, 'sale', to_jsonb(v_sale));
end;
$$;

revoke execute on function public.void_sale(uuid, uuid, uuid) from public, anon;
grant execute on function public.void_sale(uuid, uuid, uuid) to authenticated;
