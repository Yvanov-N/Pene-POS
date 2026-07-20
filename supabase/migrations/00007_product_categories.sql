-- Product categories: a real managed entity (create/rename/delete) instead
-- of a free-text string duplicated across products. Renaming a category is
-- now free (every product referencing it updates implicitly via the FK);
-- deleting one in use auto-clears affected products via `on delete set
-- null`, enforced here server-side in addition to the client doing the same
-- reassignment locally for an immediate, correct offline UI.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  updated_at timestamptz not null default now()
);

alter table public.categories enable row level security;
grant select, insert, update, delete on public.categories to authenticated;

-- service_role's BYPASSRLS only bypasses row-level security *policies* --
-- it does not grant the base table-level privilege Postgres checks first
-- (the exact bug already found and fixed for other tables in migration
-- 00003 -- same fix needed here for the same reason).
grant select, insert, update, delete on public.categories to service_role;

create policy "categories_admin_all"
  on public.categories for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "categories_select_cashier"
  on public.categories for select
  using (public.current_role() = 'cashier');

alter table public.products
  add column category_id uuid references public.categories(id) on delete set null;

-- Backfill for any pre-existing rows -- a no-op on a fresh `supabase db
-- reset`, where products is seeded *after* migrations run (seed.sql carries
-- its own fixed-id category rows for that path). This only matters for an
-- environment that already had real product data before this migration.
insert into public.categories (name)
select distinct category from public.products where category is not null and category <> ''
on conflict (name) do nothing;

update public.products p
set category_id = c.id
from public.categories c
where p.category = c.name and p.category_id is null;

alter table public.products drop column category;

-- Recreated to reference category_id instead of the now-dropped category
-- column -- this trigger (migration 00002) is what fences cashiers out of
-- editing product metadata columns; leaving it referencing `category` would
-- fail to even compile once that column is gone.
create or replace function public.enforce_cashier_product_columns()
returns trigger language plpgsql as $$
begin
  if public.current_role() = 'cashier' then
    if new.name is distinct from old.name
      or new.price is distinct from old.price
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
