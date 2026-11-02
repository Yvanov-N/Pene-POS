-- ============================================================================
-- Supplier price history.
-- ============================================================================
--
-- Why: supplier_products (00036) holds ONE price per supplier+product, and
-- updating it overwrote the old value -- but the same supplier quotes
-- different prices over time, and the shop wants to see that evolution, not
-- just today's figure. supplier_price_history keeps every dated price point:
--
--   * source 'manual'  -- an admin recorded/updated the supplier's price
--                         (OfferFormModal), optionally back-dated.
--   * source 'restock' -- the price actually paid on a restock; written by
--                         record_restock with id = the operation id, so the
--                         client's optimistic local row is replaced, not
--                         duplicated, by the pulled server row.
--
-- supplier_products.price stays the CURRENT price (= the most recent point by
-- recorded_at); the history is append-only apart from soft delete, so a typo
-- can be removed without rewriting anything else.
-- ============================================================================

create table public.supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  product_id uuid not null references public.products (id),
  price numeric not null check (price >= 0),
  source text not null default 'manual' check (source in ('manual', 'restock')),
  recorded_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  sync_seq bigint not null default 0,
  deleted_at timestamptz
);

create index idx_supplier_price_history_sync_seq on public.supplier_price_history (sync_seq);
create index idx_supplier_price_history_pair on public.supplier_price_history (product_id, supplier_id, recorded_at desc);
create trigger supplier_price_history_touch_sync
  before insert or update on public.supplier_price_history
  for each row execute function public.touch_sync_columns();

alter table public.supplier_price_history enable row level security;

create policy "supplier_price_history_admin_all"
  on public.supplier_price_history for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

grant select, insert, update on public.supplier_price_history to authenticated;
grant select, insert, update on public.supplier_price_history to service_role;

-- ---- backfill ----

-- Every past restock is a dated price point already.
insert into public.supplier_price_history (id, supplier_id, product_id, price, source, recorded_at, created_by)
select id, supplier_id, product_id, unit_cost, 'restock', created_at, created_by
from public.stock_purchases;

-- A current offer that no restock explains (entered by hand) becomes a manual
-- point at the time it was last set.
insert into public.supplier_price_history (supplier_id, product_id, price, source, recorded_at)
select o.supplier_id, o.product_id, o.price, 'manual', o.updated_at
from public.supplier_products o
where o.deleted_at is null
  and not exists (
    select 1
    from public.stock_purchases p
    where p.supplier_id = o.supplier_id
      and p.product_id = o.product_id
      and p.unit_cost = o.price
  );

-- ---- record_restock: also log the paid price ----

create or replace function public.record_restock(
  p_operation_id uuid,
  p_product_id uuid,
  p_supplier_id uuid,
  p_quantity integer,
  p_unit_cost numeric,
  p_expiry_date timestamptz default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing public.sync_operations;
  v_purchase public.stock_purchases;
  v_product public.products;
  v_stock_result jsonb;
begin
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    return jsonb_build_object('outcome', 'replayed', 'operation_id', p_operation_id, 'result', v_existing.result);
  end if;

  perform 1 from public.products where id = p_product_id and deleted_at is null;
  if not found then
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
    values (p_operation_id, 'record_restock', 'stock_purchases', p_product_id, 'conflict',
      jsonb_build_object('reason', 'product_not_found'));
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', 'product_not_found');
  end if;

  perform 1 from public.suppliers where id = p_supplier_id and deleted_at is null;
  if not found then
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
    values (p_operation_id, 'record_restock', 'stock_purchases', p_product_id, 'conflict',
      jsonb_build_object('reason', 'supplier_not_found'));
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', 'supplier_not_found');
  end if;

  insert into public.stock_purchases (id, product_id, supplier_id, quantity, unit_cost, expiry_date)
  values (p_operation_id, p_product_id, p_supplier_id, p_quantity, p_unit_cost, p_expiry_date)
  returning * into v_purchase;

  v_stock_result := public.adjust_product_stock(
    gen_random_uuid(), p_product_id, p_quantity, 'restock:' || v_purchase.id::text
  );

  update public.products
  set cost_price = p_unit_cost,
      expiry_date = coalesce(p_expiry_date, expiry_date)
  where id = p_product_id
  returning * into v_product;

  insert into public.supplier_products (supplier_id, product_id, price)
  values (p_supplier_id, p_product_id, p_unit_cost)
  on conflict (supplier_id, product_id)
  do update set price = excluded.price, deleted_at = null;

  insert into public.supplier_price_history (id, supplier_id, product_id, price, source, recorded_at)
  values (p_operation_id, p_supplier_id, p_product_id, p_unit_cost, 'restock', v_purchase.created_at);

  insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
  values (
    p_operation_id, 'record_restock', 'stock_purchases', v_purchase.id, 'completed',
    jsonb_build_object('purchase', to_jsonb(v_purchase), 'product', to_jsonb(v_product),
      'negative_stock', coalesce((v_stock_result->>'negative_stock')::boolean, false))
  );

  return jsonb_build_object(
    'outcome', 'completed',
    'operation_id', p_operation_id,
    'purchase', to_jsonb(v_purchase),
    'product', to_jsonb(v_product)
  );
end;
$$;
