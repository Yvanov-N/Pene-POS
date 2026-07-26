-- ============================================================================
-- Attribute checkout to the device, not a PIN-matched cashier profile.
-- ============================================================================
--
-- Why: checkout's PIN pad matched against ANY local profile (admin or
-- cashier role) and used whichever one matched as sales.cashier_id -- this
-- is exactly the mechanism that let a stale/fake local profile (the
-- production mock-seeding incident, migration/fix in the same phase as
-- this one) become a permanently-unsyncable cashier_id. Checkout now only
-- accepts an admin PIN (a lightweight "you're allowed to complete this
-- sale" gate, checked against real, already-synced admin profiles --
-- requiredRole="admin" at the client, no schema change needed for that
-- part), and the sale is attributed to the DEVICE that rang it up instead
-- of whichever admin happened to type their PIN in. cashier_id is kept
-- (still records which admin authorized the sale, useful audit trail, and
-- avoids touching its NOT NULL FK) -- device_label is the new, additive,
-- nullable column that becomes the PRIMARY thing shown on receipts/Sales
-- History/etc. going forward. Historical sales have no device_label
-- (NULL) and fall back to showing the cashier name, same as always.
-- ============================================================================

alter table public.sales add column device_label text;

-- complete_sale (4-arg, operation_id overload, migration 00028) -- same
-- signature, just also stores device_label when the client sends one.
-- p_sale is a jsonb blob already, so no new RPC argument/overload is
-- needed, just reading one more optional key out of it.
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
  v_device_label text := nullif(p_sale->>'device_label', '');
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
        status, momo_verification_status, device_label
      )
      values (
        v_sale_id,
        coalesce((p_sale->>'created_at')::timestamptz, now()),
        v_cashier_id,
        v_total,
        v_payment_method,
        v_student_id,
        'completed',
        nullif(p_sale->>'momo_verification_status', ''),
        v_device_label
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

-- get_public_receipt (migration 00021) -- same signature, adds
-- device_label to the returned JSON so the public receipt page/edge
-- functions can show it too.
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
    'device_label', s.device_label,
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

revoke execute on function public.complete_sale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.complete_sale(uuid, jsonb, jsonb) to authenticated;
revoke all on function public.get_public_receipt(uuid) from public;
grant execute on function public.get_public_receipt(uuid) to anon, authenticated;
