-- ============================================================================
-- Suppliers, purchase prices and real profit.
-- ============================================================================
--
-- Why: a restock used to record nothing but a quantity (adjust_product_stock
-- with reason 'restock'), so the shop had no idea what it paid for anything,
-- who it bought from, or what it actually earned on a sale -- the dashboard
-- could only show revenue. This adds:
--
--   * suppliers             -- who the shop buys from (name, contact, phone,
--                              location).
--   * supplier_products     -- the price each supplier offers for a product
--                              ("tarif"), editable without buying, and kept
--                              equal to the last price actually paid.
--   * stock_purchases       -- one row per restock: product, supplier,
--                              quantity, unit cost. Restock + price history.
--   * products.cost_price   -- the LAST purchase price (business decision:
--                              last price, not weighted average).
--   * sale_items.unit_cost  -- cost snapshot at sale time, filled by trigger
--                              from products.cost_price so complete_sale
--                              (00028/00032) needs no change. Historical rows
--                              stay null = "cost unknown", never 0.
--   * record_restock()      -- one ledger-guarded RPC doing purchase row +
--                              stock delta + cost/offer update atomically,
--                              same idempotency shape as adjust_product_stock
--                              (00026).
--
-- All three new tables are syncable (sync_seq + touch_sync_columns, 00022/
-- 00030) and pulled into Dexie so the restock screen works offline. RLS is
-- admin-only: purchase prices are management data, and restocking already
-- sits behind the admin PIN lock client-side.
-- ============================================================================

-- ---- suppliers ----

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sync_seq bigint not null default 0,
  deleted_at timestamptz
);

create index idx_suppliers_sync_seq on public.suppliers (sync_seq);
create trigger suppliers_touch_sync
  before insert or update on public.suppliers
  for each row execute function public.touch_sync_columns();

-- ---- supplier_products (offers) ----

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  product_id uuid not null references public.products (id),
  price numeric not null check (price >= 0),
  updated_at timestamptz not null default now(),
  sync_seq bigint not null default 0,
  deleted_at timestamptz,
  unique (supplier_id, product_id)
);

create index idx_supplier_products_sync_seq on public.supplier_products (sync_seq);
create index idx_supplier_products_product on public.supplier_products (product_id);
create trigger supplier_products_touch_sync
  before insert or update on public.supplier_products
  for each row execute function public.touch_sync_columns();

-- ---- stock_purchases (restock history) ----

create table public.stock_purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  supplier_id uuid not null references public.suppliers (id),
  quantity integer not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  total_cost numeric generated always as (quantity * unit_cost) stored,
  expiry_date timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sync_seq bigint not null default 0
);

create index idx_stock_purchases_sync_seq on public.stock_purchases (sync_seq);
create index idx_stock_purchases_product_created on public.stock_purchases (product_id, created_at desc);
create index idx_stock_purchases_supplier on public.stock_purchases (supplier_id);
create trigger stock_purchases_touch_sync
  before insert or update on public.stock_purchases
  for each row execute function public.touch_sync_columns();

-- ---- RLS + grants ----

alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.stock_purchases enable row level security;

create policy "suppliers_admin_all"
  on public.suppliers for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "supplier_products_admin_all"
  on public.supplier_products for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "stock_purchases_admin_all"
  on public.stock_purchases for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

grant select, insert, update, delete on public.suppliers, public.supplier_products to authenticated;
grant select, insert, update, delete on public.suppliers, public.supplier_products to service_role;
-- Purchases are history: written only through record_restock, never edited.
grant select, insert on public.stock_purchases to authenticated;
grant select, insert on public.stock_purchases to service_role;

-- ---- products.cost_price ----

alter table public.products add column cost_price numeric check (cost_price >= 0);

-- Same guard as 00007, plus cost_price: a cashier may still only move stock.
create or replace function public.enforce_cashier_product_columns()
returns trigger language plpgsql as $$
begin
  if public.current_role() = 'cashier' then
    if new.name is distinct from old.name
      or new.price is distinct from old.price
      or new.cost_price is distinct from old.cost_price
      or new.barcode is distinct from old.barcode
      or new.category_id is distinct from old.category_id
      or new.image_url is distinct from old.image_url
      or new.emoji is distinct from old.emoji
      or new.expiry_date is distinct from old.expiry_date
    then
      raise exception 'cashiers may only update stock' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---- sale_items.unit_cost ----

alter table public.sale_items add column unit_cost numeric;

-- Server-side snapshot so the cost is the one in force when the sale reached
-- the server, whatever the client sent -- complete_sale's insert list doesn't
-- carry unit_cost at all, so this always fills it.
create or replace function public.snapshot_sale_item_cost()
returns trigger language plpgsql as $$
begin
  if new.unit_cost is null then
    select cost_price into new.unit_cost from public.products where id = new.product_id;
  end if;
  return new;
end;
$$;

create trigger sale_items_snapshot_cost
  before insert on public.sale_items
  for each row execute function public.snapshot_sale_item_cost();

-- ---- record_restock ----

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

  -- The purchase id IS the operation id: the client already wrote the
  -- optimistic local row under that id, so the pulled server row replaces it
  -- instead of appearing twice.
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

revoke execute on function public.record_restock(uuid, uuid, uuid, integer, numeric, timestamptz) from public, anon;
grant execute on function public.record_restock(uuid, uuid, uuid, integer, numeric, timestamptz) to authenticated;
