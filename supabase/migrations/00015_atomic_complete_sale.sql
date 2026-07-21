-- ============================================================================
-- Phase 18 -- atomic complete_sale RPC, replacing pushSale's three separate
-- round trips (insert sales, insert sale_items, loop-decrement stock) with
-- one transactional call.
-- ============================================================================
--
-- Why: the old 3-step client-side flow could partially succeed (e.g. the
-- sales insert commits, then a network blip or a deleted-product FK
-- violation aborts a later step) and had no safe way to retry -- a resend of
-- the sales insert hit a duplicate-key 23505 every time thereafter
-- (sync_queue.status stuck 'failed' forever once retries were exhausted,
-- db.sales.status stuck 'pending_sync' forever, shown as "Syncing" with no
-- resolution -- confirmed live in production). Wrapping every step in one
-- plpgsql function makes it all-or-nothing (Postgres functions run inside
-- the calling statement's transaction), and lets the function check its own
-- prior effects race-free before doing anything -- a sales row existing for
-- this id is a reliable signal the whole operation already committed on a
-- prior attempt whose response never reached the client.
-- ============================================================================

create or replace function public.complete_sale(p_sale jsonb, p_items jsonb)
returns public.sales
language plpgsql
security invoker
as $$
declare
  v_sale_id uuid := (p_sale->>'id')::uuid;
  v_existing public.sales;
  v_result public.sales;
  v_item jsonb;
  v_new_stock integer;
begin
  -- Idempotency guard: a retry after this function's own success response
  -- was lost (timeout/network blip) must not re-insert or re-decrement
  -- anything. Safe specifically because the insert below and every stock
  -- decrement happen in this same transaction -- "the sales row exists"
  -- can only be true if the ENTIRE prior call committed.
  select * into v_existing from public.sales where id = v_sale_id;
  if found then
    return v_existing;
  end if;

  begin
    insert into public.sales (
      id, created_at, cashier_id, total_amount, payment_method, student_id,
      status, momo_verification_status
    )
    values (
      v_sale_id,
      coalesce((p_sale->>'created_at')::timestamptz, now()),
      (p_sale->>'cashier_id')::uuid,
      (p_sale->>'total_amount')::numeric,
      (p_sale->>'payment_method')::public.payment_method,
      nullif(p_sale->>'student_id', '')::uuid,
      -- Server-authoritative: 'pending_sync' is a purely local/Dexie
      -- concept (see syncService.ts's repository-pattern note) -- once this
      -- function is inserting the row at all, the sale IS fully committed
      -- remotely, so 'completed' is the only value that's ever correct
      -- here. (Also fixes a pre-existing quirk where the old direct insert
      -- sent the client's local status through unchanged, leaving every
      -- synced sale's remote row permanently reading 'pending_sync'.)
      'completed',
      nullif(p_sale->>'momo_verification_status', '')
    )
    returning * into v_result;
  exception when unique_violation then
    -- Closes the narrow race between the existence check above and this
    -- insert (two overlapping calls for the same sale_id) -- the loser
    -- returns the winner's already-committed row instead of erroring, and
    -- critically never reaches the sale_items/stock steps below, so it
    -- can't double-decrement anything either.
    select * into v_result from public.sales where id = v_sale_id;
    return v_result;
  end;

  insert into public.sale_items (id, sale_id, product_id, quantity, unit_price)
  select
    (item->>'id')::uuid,
    (item->>'sale_id')::uuid,
    (item->>'product_id')::uuid,
    (item->>'quantity')::integer,
    (item->>'unit_price')::numeric
  from jsonb_array_elements(p_items) as item;
  -- A product deleted before this offline sale ever reached the server
  -- (nothing blocked that delete -- no sale_items row referenced it yet)
  -- surfaces right here as a standard 23503 foreign_key_violation, which
  -- pushSale treats as a conflict, same as every other table already does.

  for v_item in select * from jsonb_array_elements(p_items) loop
    update public.products
    set stock = stock - (v_item->>'quantity')::integer, updated_at = now()
    where id = (v_item->>'product_id')::uuid
    returning stock into v_new_stock;
    -- An oversell (stock would go negative) is caught for free here by the
    -- products_stock_non_negative CHECK constraint (migration 2, still
    -- active) -- Postgres raises 23514 automatically, no manual check
    -- needed, exactly like the old decrement_product_stock RPC relied on.

    if not found then
      -- Narrow race: product deleted between the sale_items insert above
      -- and this specific line's decrement, within this same call. Same
      -- errcode as the FK violation above, so pushSale needs exactly one
      -- check to catch every "product gone" shape.
      raise exception 'product % not found', v_item->>'product_id'
        using errcode = '23503';
    end if;
  end loop;

  return v_result;
end;
$$;

revoke execute on function public.complete_sale(jsonb, jsonb) from public, anon;
grant execute on function public.complete_sale(jsonb, jsonb) to authenticated;

-- decrement_product_stock is deliberately left in place, not dropped --
-- pushSale (syncService.ts) is its only caller and stops using it after this
-- migration ships, but dropping a DB function is an unforced, unrelated risk
-- to bundle into a reliability fix. Dead but harmless.
