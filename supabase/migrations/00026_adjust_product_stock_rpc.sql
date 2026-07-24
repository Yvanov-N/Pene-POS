-- ============================================================================
-- Sync rebuild, part 5 -- a ledger-guarded, delta-only stock adjustment RPC.
-- ============================================================================
--
-- Why: refundService.ts's voidSale (being rewritten this phase) restocked a
-- product by reading its current stock into a local Dexie snapshot, adding
-- the refunded quantity client-side, then pushing the ENTIRE row back as a
-- last-write-wins UPDATE -- a sale ringing up on another terminal between
-- that read and that write was silently overwritten. This RPC is the one
-- code path for "change a product's stock by some delta," used by both the
-- new complete_sale (decrementing) and void_sale (restocking) RPCs below,
-- and directly callable for future admin manual-adjustment features -- an
-- atomic `stock = stock + delta` UPDATE can never lose a concurrent
-- terminal's write the way a whole-row overwrite can.
--
-- Structured outcome instead of a magic SQLSTATE: negative stock (allowed,
-- per migration 00019's deliberate business rule) is reported as an
-- explicit `negative_stock: true` flag plus a sync_events row, not a silent
-- non-event -- this is what makes that already-decided business rule
-- observable instead of invisible.
-- ============================================================================

create or replace function public.adjust_product_stock(
  p_operation_id uuid,
  p_product_id uuid,
  p_delta integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing public.sync_operations;
  v_product public.products;
  v_negative boolean := false;
begin
  -- Idempotency guard: a retry (queue redrain, network blip after this
  -- call's own response was lost) with the same operation_id is a safe
  -- no-op replay, not a second delta application.
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    return jsonb_build_object('outcome', 'replayed', 'operation_id', p_operation_id, 'result', v_existing.result);
  end if;

  -- deleted_at is null: a soft-deleted product (migration 00023) is
  -- "gone" for stock-adjustment purposes even though the row itself still
  -- physically exists (FK from historical sale_items requires that) --
  -- this reproduces the old FK-violation conflict signal for "product
  -- deleted before this offline sale ever reached the server" under the
  -- new soft-delete scheme.
  update public.products
  set stock = stock + p_delta
  where id = p_product_id and deleted_at is null
  returning * into v_product;

  if not found then
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
    values (p_operation_id, 'adjust_product_stock', 'products', p_product_id, 'conflict',
      jsonb_build_object('reason', 'product_not_found', 'delta', p_delta));
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', 'product_not_found');
  end if;

  v_negative := v_product.stock < 0;

  insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
  values (
    p_operation_id, 'adjust_product_stock', 'products', p_product_id, 'completed',
    jsonb_build_object('product', to_jsonb(v_product), 'delta', p_delta, 'negative_stock', v_negative, 'reason', p_reason)
  );

  if v_negative then
    insert into public.sync_events (event_type, severity, entity_table, entity_id, operation_id, message, context)
    values ('negative_stock', 'warning', 'products', p_product_id, p_operation_id,
      'Stock went negative for product ' || p_product_id::text,
      jsonb_build_object('stock', v_product.stock, 'delta', p_delta, 'reason', p_reason));
  end if;

  return jsonb_build_object(
    'outcome', 'completed',
    'operation_id', p_operation_id,
    'product', to_jsonb(v_product),
    'negative_stock', v_negative
  );
end;
$$;

revoke execute on function public.adjust_product_stock(uuid, uuid, integer, text) from public, anon;
grant execute on function public.adjust_product_stock(uuid, uuid, integer, text) to authenticated;
