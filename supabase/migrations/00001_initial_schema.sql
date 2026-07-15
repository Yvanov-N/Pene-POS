-- ============================================================================
-- Cite Shop / Pene POS -- initial schema, RLS policies, and auth notes
-- ============================================================================
--
-- Auth architecture (dual layer):
--
--   Layer 1 -- device/shop login (Supabase Auth). A cashier or admin signs
--   in on the POS device via Supabase Auth (email/password, Google OAuth, or
--   Apple OAuth), creating a row in auth.users. Signup is intentionally left
--   disabled at the app layer (see enable_signup = false in config.toml) --
--   a matching public.profiles row is provisioned out-of-band by an admin,
--   never by a client-side trigger, so an arbitrary authenticated user can't
--   grant themselves cashier/admin access just by signing up.
--
--   Layer 2 -- fast in-app cashier switching. Once a device is signed in via
--   Layer 1, individual cashiers "clock in" by entering a 4-digit PIN,
--   checked against profiles.pin_code, without a full Supabase Auth
--   re-login. pin_code is ALWAYS a hash (pgcrypto crypt()/bcrypt), never
--   plaintext -- and it must be verified via a SECURITY DEFINER RPC added in
--   a later phase, never a client-side SELECT + compare, because RLS is
--   row-level, not column-level: a plain SELECT policy on profiles would let
--   any signed-in cashier read every other profile's pin_code hash. This
--   migration closes that gap directly with a column-level REVOKE below.
--
-- ============================================================================

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'cashier');
create type public.payment_method as enum ('cash', 'momo_mtn', 'momo_orange', 'student_wallet');
create type public.sale_status as enum ('completed', 'pending_sync', 'conflict_warning');

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.user_role not null,
  pin_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.pin_code is
  'Hashed 4-digit PIN (pgcrypto crypt()/bcrypt) used for Layer 2 cashier switching. Never store or expose plaintext.';

-- ----------------------------------------------------------------------------
-- student_wallets
-- ----------------------------------------------------------------------------
create table public.student_wallets (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  badge_code text not null unique,
  balance numeric not null default 0,
  email text
);

-- ----------------------------------------------------------------------------
-- products
-- ----------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null,
  stock integer not null default 0,
  barcode text unique,
  category text,
  image_url text,
  emoji text,
  expiry_date timestamptz,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- sales
-- ----------------------------------------------------------------------------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cashier_id uuid not null references public.profiles (id),
  total_amount numeric not null,
  payment_method public.payment_method not null,
  student_wallet_id uuid references public.student_wallets (id),
  status public.sale_status not null default 'completed'
);

-- ----------------------------------------------------------------------------
-- sale_items
-- ----------------------------------------------------------------------------
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity integer not null,
  unit_price numeric not null
);

-- ----------------------------------------------------------------------------
-- shop_status (single row)
-- ----------------------------------------------------------------------------
create table public.shop_status (
  id integer primary key default 1,
  is_open boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint shop_status_singleton check (id = 1)
);

insert into public.shop_status (id, is_open) values (1, true);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.student_wallets enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.shop_status enable row level security;

-- Postgres checks table-level GRANTs before RLS is ever evaluated -- without
-- these, every query from the API would fail with permission-denied
-- regardless of policy, even for admins. `authenticated` gets the broadest
-- operation any role might need per table (RLS narrows the actual rows/verbs
-- per admin vs cashier); `anon` gets nothing since this is an internal POS
-- with no unauthenticated read/write path.
--
-- profiles is granted separately below with an explicit column list: in
-- Postgres, table-level and column-level privileges are ADDITIVE, not
-- layered, so a later `revoke select (pin_code)` cannot narrow a table-wide
-- `grant select` -- the only way to keep a column out of the API is to never
-- include it in the SELECT grant in the first place.
grant select, insert, update, delete on
  public.products,
  public.sales,
  public.sale_items,
  public.student_wallets,
  public.shop_status
to authenticated;

grant select (id, email, full_name, role, created_at, updated_at) on public.profiles to authenticated;
grant insert, update, delete on public.profiles to authenticated;

-- current_role(): SECURITY DEFINER lookup of the caller's own profile role.
-- Runs with elevated privilege so it can read public.profiles regardless of
-- that table's own RLS -- this avoids infinite recursion when profiles'
-- policies themselves need to call this function.
create or replace function public.current_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ---- profiles ----
create policy "profiles_admin_all"
  on public.profiles for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_select_cashier"
  on public.profiles for select
  using (public.current_role() = 'cashier');

-- pin_code is intentionally write-only via the API: the column-list grant
-- above never included it, so no role -- not even admin, who shares the
-- same `authenticated` Postgres role as cashiers -- can SELECT it back.
-- Admins can still UPDATE it (PIN reset) since UPDATE was granted table-wide.

-- ---- products ----
create policy "products_admin_all"
  on public.products for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "products_select_cashier"
  on public.products for select
  using (public.current_role() = 'cashier');

-- ---- sales ----
-- Cashiers may only insert/update sales attributed to themselves.
create policy "sales_admin_all"
  on public.sales for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "sales_insert_cashier"
  on public.sales for insert
  with check (public.current_role() = 'cashier' and cashier_id = auth.uid());

create policy "sales_update_cashier"
  on public.sales for update
  using (public.current_role() = 'cashier' and cashier_id = auth.uid())
  with check (public.current_role() = 'cashier' and cashier_id = auth.uid());

-- Required for INSERT/UPDATE to actually work, not just to "view history":
-- Postgres RLS enforces SELECT policies against RETURNING rows too, and a
-- failed RETURNING check rolls back the entire statement (verified against
-- a live instance) -- not just an empty response. Without this, a cashier's
-- checkout INSERT would silently never persist via the standard
-- `return=representation` flow supabase-js uses by default.
create policy "sales_select_cashier"
  on public.sales for select
  using (public.current_role() = 'cashier' and cashier_id = auth.uid());

-- ---- sale_items ----
-- Ownership is indirect via sales.cashier_id, so check through a join.
create policy "sale_items_admin_all"
  on public.sale_items for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "sale_items_insert_cashier"
  on public.sale_items for insert
  with check (
    public.current_role() = 'cashier'
    and exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = auth.uid()
    )
  );

create policy "sale_items_update_cashier"
  on public.sale_items for update
  using (
    public.current_role() = 'cashier'
    and exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = auth.uid()
    )
  )
  with check (
    public.current_role() = 'cashier'
    and exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = auth.uid()
    )
  );

-- Same RETURNING/RLS reason as sales_select_cashier above.
create policy "sale_items_select_cashier"
  on public.sale_items for select
  using (
    public.current_role() = 'cashier'
    and exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = auth.uid()
    )
  );

-- ---- student_wallets ----
create policy "student_wallets_admin_all"
  on public.student_wallets for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "student_wallets_select_cashier"
  on public.student_wallets for select
  using (public.current_role() = 'cashier');

-- Cashiers adjust balances at checkout; wallet creation stays admin-only
-- (no cashier INSERT policy). This UPDATE policy is row-level, not
-- column-level -- a cashier UPDATE could technically also touch
-- badge_code/student_name/email. Restricting cashiers to balance-only
-- writes needs a BEFORE UPDATE trigger comparing OLD/NEW, deferred to a
-- later phase since it's checkout business logic, not schema/RLS.
create policy "student_wallets_update_cashier"
  on public.student_wallets for update
  using (public.current_role() = 'cashier')
  with check (public.current_role() = 'cashier');

-- ---- shop_status ----
create policy "shop_status_admin_all"
  on public.shop_status for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy "shop_status_select_cashier"
  on public.shop_status for select
  using (public.current_role() = 'cashier');
