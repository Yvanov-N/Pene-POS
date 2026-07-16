-- ============================================================================
-- Relax cashier ownership checks so the offline sync engine can push, add
-- a cashier UPDATE path on products, and add check constraints that give
-- the push engine a real "stock inconsistency" error to catch.
-- ============================================================================
--
-- Why: sales_insert_cashier / sale_items_*_cashier required
-- `cashier_id = auth.uid()`. But this app's auth is two-layered -- Layer 1
-- (GlobalLogin, Supabase Auth) authenticates the *device*; Layer 2
-- (PinPadModal) identifies the *cashier* per transaction against a purely
-- local Dexie cache, never against Supabase Auth. So cashier_id (from the
-- PIN-verified local profile) essentially never equals the signed-in
-- device session's auth.uid(). Dropping the ownership check keeps the
-- device (role check) as the trust boundary, matching the model already
-- used for student_wallets_update_cashier (no ownership check there
-- either).
-- ============================================================================

-- ---- sales ----
drop policy "sales_insert_cashier" on public.sales;
drop policy "sales_update_cashier" on public.sales;
drop policy "sales_select_cashier" on public.sales;

create policy "sales_insert_cashier"
  on public.sales for insert
  with check (public.current_role() = 'cashier');

create policy "sales_update_cashier"
  on public.sales for update
  using (public.current_role() = 'cashier')
  with check (public.current_role() = 'cashier');

create policy "sales_select_cashier"
  on public.sales for select
  using (public.current_role() = 'cashier');

-- ---- sale_items ----
drop policy "sale_items_insert_cashier" on public.sale_items;
drop policy "sale_items_update_cashier" on public.sale_items;
drop policy "sale_items_select_cashier" on public.sale_items;

create policy "sale_items_insert_cashier"
  on public.sale_items for insert
  with check (public.current_role() = 'cashier');

create policy "sale_items_update_cashier"
  on public.sale_items for update
  using (public.current_role() = 'cashier')
  with check (public.current_role() = 'cashier');

create policy "sale_items_select_cashier"
  on public.sale_items for select
  using (public.current_role() = 'cashier');

-- ---- products: cashiers can push stock changes, nothing else ----
create policy "products_update_cashier"
  on public.products for update
  using (public.current_role() = 'cashier')
  with check (public.current_role() = 'cashier');

-- A column-scoped `grant update (stock, updated_at) ... to authenticated`
-- was tried here first and verified (via a live grant inspection) to do
-- nothing: migration 1 already granted table-wide UPDATE on products to
-- authenticated for admin's benefit, and -- same lesson as the
-- profiles.pin_code column lockdown -- table-level and column-level grants
-- are additive in Postgres, not layered, so the narrower grant is a no-op
-- on top of the broader one already in place. Since admin and cashier
-- share the same `authenticated` Postgres role, no GRANT can tell them
-- apart; only a trigger comparing OLD/NEW can.
create or replace function public.enforce_cashier_product_columns()
returns trigger
language plpgsql
as $$
begin
  if public.current_role() = 'cashier' then
    if new.name is distinct from old.name
      or new.price is distinct from old.price
      or new.barcode is distinct from old.barcode
      or new.category is distinct from old.category
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

create trigger products_cashier_column_guard
  before update on public.products
  for each row
  execute function public.enforce_cashier_product_columns();

-- ---- conflict detection: give the sync engine a real error to catch ----
alter table public.products
  add constraint products_stock_non_negative check (stock >= 0);

alter table public.student_wallets
  add constraint student_wallets_balance_non_negative check (balance >= 0);

-- ---- atomic adjustments ----
-- A fetch-then-update from the client (read stock, subtract, write) has a
-- lost-update race between two terminals selling the last item at once --
-- exactly what the check constraint above is supposed to catch. These do
-- the read-modify-write as a single atomic statement instead. security
-- invoker (the default, made explicit) so they still run as the calling
-- role and respect the grants/RLS above -- no privilege escalation.
create or replace function public.decrement_product_stock(p_product_id uuid, p_quantity integer)
returns public.products
language plpgsql
security invoker
as $$
declare
  updated_product public.products;
begin
  update public.products
  set stock = stock - p_quantity, updated_at = now()
  where id = p_product_id
  returning * into updated_product;

  if not found then
    raise exception 'product % not found', p_product_id;
  end if;

  return updated_product;
end;
$$;

create or replace function public.adjust_wallet_balance(p_wallet_id uuid, p_delta numeric)
returns public.student_wallets
language plpgsql
security invoker
as $$
declare
  updated_wallet public.student_wallets;
begin
  update public.student_wallets
  set balance = balance + p_delta
  where id = p_wallet_id
  returning * into updated_wallet;

  if not found then
    raise exception 'student wallet % not found', p_wallet_id;
  end if;

  return updated_wallet;
end;
$$;

revoke execute on function public.decrement_product_stock(uuid, integer) from public, anon;
grant execute on function public.decrement_product_stock(uuid, integer) to authenticated;

revoke execute on function public.adjust_wallet_balance(uuid, numeric) from public, anon;
grant execute on function public.adjust_wallet_balance(uuid, numeric) to authenticated;
