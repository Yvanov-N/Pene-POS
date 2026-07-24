-- ============================================================================
-- Sync rebuild, part 7 -- a ledger-guarded overload of complete_sale that
-- also debits the wallet in the same transaction for student_wallet sales.
-- ============================================================================
--
-- Why: usePosCheckout.ts's completeCheckout fires the sale creation and the
-- wallet debit as two separate, sequential network calls (submitSaleNet-
-- workFirst then submitWalletAdjustmentNetworkFirst) -- a failure between
-- them can produce a sale with no matching debit, or a debited wallet with
-- no sale, a direct cause of the reported "data corruption/wrong values."
-- This overload widens the transaction boundary to cover both effects at
-- once: the wallet debit (via adjust_wallet_balance's new ledger-guarded
-- overload) happens inside the SAME transaction as the sale/items/stock
-- writes, so it's genuinely all-or-nothing.
--
-- Idempotency is generalized via sync_operations (migration 00024) rather
-- than complete_sale's original "does a sales row with this id already
-- exist" trick (migration 00015) -- that trick still works and is kept as
-- a secondary safety net (see the nested unique_violation handler below),
-- but the operation_id ledger is now the primary, general mechanism that
-- also covers the wallet-debit side, which the old trick never could.
--
-- New overload (4 args, keyed by p_operation_id) alongside the untouched
-- 2-arg original from migration 00015 -- same coexistence rationale as
-- adjust_wallet_balance's new overload (migration 00027): an already-
-- deployed client tab keeps calling the old 2-arg version successfully
-- during rollout.
--
-- Structured, non-throwing outcomes instead of magic SQLSTATEs: any
-- failure partway through (a deleted product, a since-deleted wallet) is
-- caught by the outer exception block below, which rolls back everything
-- this call did (sale insert, items, any stock/wallet deltas already
-- applied THIS call) via plpgsql's implicit per-block savepoint, then
-- returns `{outcome: "conflict", reason: ...}` instead of surfacing a raw
-- Postgres error for the client to sniff a SQLSTATE out of.
-- ============================================================================

create or replace function public.complete_sale(
  p_operation_id uuid,
  p_sale jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing public.sync_operations;
  v_sale_id uuid := (p_sale->>'id')::uuid;
  v_cashier_id uuid := (p_sale->>'cashier_id')::uuid;
  v_payment_method public.payment_method := (p_sale->>'payment_method')::public.payment_method;
  v_student_id uuid := nullif(p_sale->>'student_id', '')::uuid;
  v_total numeric := (p_sale->>'total_amount')::numeric;
  v_sale public.sales;
  v_item jsonb;
  v_stock_result jsonb;
  v_wallet_result jsonb;
  v_negative_stock boolean := false;
  v_negative_balance boolean := false;
  v_line_results jsonb := '[]'::jsonb;
  v_conflict_reason text;
begin
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    return jsonb_build_object('outcome', 'replayed', 'operation_id', p_operation_id, 'result', v_existing.result);
  end if;

  begin
    begin
      insert into public.sales (
        id, created_at, cashier_id, total_amount, payment_method, student_id,
        status, momo_verification_status
      )
      values (
        v_sale_id,
        coalesce((p_sale->>'created_at')::timestamptz, now()),
        v_cashier_id,
        v_total,
        v_payment_method,
        v_student_id,
        'completed',
        nullif(p_sale->>'momo_verification_status', '')
      )
      returning * into v_sale;
    exception when unique_violation then
      -- Same sale id already committed from a prior call that succeeded
      -- server-side but whose response never reached this client, and this
      -- retry happens to be using a different operation_id than that prior
      -- attempt did. Treat as already-done -- return the winner's row
      -- without touching sale_items/stock/wallet again.
      select * into v_sale from public.sales where id = v_sale_id;
      insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result, created_by)
      values (p_operation_id, 'complete_sale', 'sales', v_sale_id, 'completed', to_jsonb(v_sale), v_cashier_id);
      return jsonb_build_object('outcome', 'completed', 'operation_id', p_operation_id, 'sale', to_jsonb(v_sale));
    end;

    insert into public.sale_items (id, sale_id, product_id, quantity, unit_price)
    select
      (item->>'id')::uuid,
      (item->>'sale_id')::uuid,
      (item->>'product_id')::uuid,
      (item->>'quantity')::integer,
      (item->>'unit_price')::numeric
    from jsonb_array_elements(p_items) as item;

    for v_item in select * from jsonb_array_elements(p_items) loop
      v_stock_result := public.adjust_product_stock(
        gen_random_uuid(),
        (v_item->>'product_id')::uuid,
        -(v_item->>'quantity')::integer,
        'sale:' || v_sale_id::text
      );
      if v_stock_result->>'outcome' = 'conflict' then
        raise exception 'stock adjustment conflict for product %: %',
          v_item->>'product_id', v_stock_result->>'reason';
      end if;
      if (v_stock_result->>'negative_stock')::boolean then
        v_negative_stock := true;
      end if;
      v_line_results := v_line_results || jsonb_build_array(v_stock_result);
    end loop;

    if v_payment_method = 'student_wallet' and v_student_id is not null then
      v_wallet_result := public.adjust_wallet_balance(
        gen_random_uuid(),
        v_student_id,
        -v_total,
        'sale:' || v_sale_id::text
      );
      if v_wallet_result->>'outcome' = 'conflict' then
        raise exception 'wallet adjustment conflict for wallet %: %',
          v_student_id, v_wallet_result->>'reason';
      end if;
      if (v_wallet_result->>'negative_balance')::boolean then
        v_negative_balance := true;
      end if;
    end if;
  exception when others then
    get stacked diagnostics v_conflict_reason = message_text;
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result, created_by)
    values (p_operation_id, 'complete_sale', 'sales', v_sale_id, 'conflict',
      jsonb_build_object('reason', v_conflict_reason), v_cashier_id);
    insert into public.sync_events (event_type, severity, entity_table, entity_id, operation_id, message)
    values ('complete_sale_conflict', 'error', 'sales', v_sale_id, p_operation_id, v_conflict_reason);
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', v_conflict_reason);
  end;

  insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result, created_by)
  values (
    p_operation_id, 'complete_sale', 'sales', v_sale_id, 'completed',
    jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'negative_stock', v_negative_stock,
      'negative_balance', v_negative_balance,
      'lines', v_line_results
    ),
    v_cashier_id
  );

  return jsonb_build_object(
    'outcome', 'completed',
    'operation_id', p_operation_id,
    'sale', to_jsonb(v_sale),
    'negative_stock', v_negative_stock,
    'negative_balance', v_negative_balance
  );
end;
$$;

revoke execute on function public.complete_sale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.complete_sale(uuid, jsonb, jsonb) to authenticated;
