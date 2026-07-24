-- ============================================================================
-- Sync rebuild, part 1 -- a single monotonic sync_seq watermark on every
-- syncable table, replacing full-table select("*") pulls with incremental,
-- cursor-based ones.
-- ============================================================================
--
-- Why: pullFromSupabase() (the old client sync engine, being rebuilt this
-- phase) re-fetched every row of every table on every cycle and reconciled
-- purely by excluding rows with an in-flight local mutation -- there was no
-- "only accept this row if it's actually newer than what I have" check at
-- all, so a stale full-table page landing after a fresher local write could
-- silently clobber it. Incremental pulls need a cursor to page from, and a
-- version stamp to compare against on write-back; one shared sequence
-- across every table (not one sequence per table) is deliberate -- it gives
-- a single, globally-ordered watermark for correlating "what happened, in
-- what order, across every table" during incident diagnosis, at zero extra
-- cost over a per-table sequence.
--
-- The stamping trigger must live on the table itself, not inside the RPCs
-- being added later this phase -- plenty of writes (admin product/category
-- edits, wallet admin edits, profile edits) go through plain PostgREST
-- insert()/update() calls with no RPC involved, and those must be covered
-- too or the incremental-pull cursor would silently miss them.
-- ============================================================================

create sequence public.sync_seq;

-- Generic: checks for an updated_at column via to_jsonb rather than needing
-- a separate trigger function per table shape, since some tables already
-- had updated_at (products/categories/profiles/shop_status) and some don't
-- (sales/sale_items/student_wallets, backfilled below) -- one function
-- covers both cases correctly.
create or replace function public.touch_sync_columns()
returns trigger
language plpgsql
as $$
begin
  new.sync_seq := nextval('public.sync_seq');
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---- products, categories, profiles, shop_status: already have updated_at ----

-- Backfill note: assignment order below is whatever Postgres's UPDATE scan
-- order happens to be (UPDATE has no ORDER BY) -- fine, since only
-- uniqueness and monotonic *future* ordering matter for correctness, both
-- guaranteed by nextval() and the triggers below; historical assignment
-- order is not load-bearing.
alter table public.products add column sync_seq bigint;
update public.products set sync_seq = nextval('public.sync_seq');
alter table public.products alter column sync_seq set not null;
create index idx_products_sync_seq on public.products (sync_seq);
create trigger products_touch_sync
  before insert or update on public.products
  for each row execute function public.touch_sync_columns();

alter table public.categories add column sync_seq bigint;
update public.categories set sync_seq = nextval('public.sync_seq');
alter table public.categories alter column sync_seq set not null;
create index idx_categories_sync_seq on public.categories (sync_seq);
create trigger categories_touch_sync
  before insert or update on public.categories
  for each row execute function public.touch_sync_columns();

alter table public.profiles add column sync_seq bigint;
update public.profiles set sync_seq = nextval('public.sync_seq');
alter table public.profiles alter column sync_seq set not null;
create index idx_profiles_sync_seq on public.profiles (sync_seq);
create trigger profiles_touch_sync
  before insert or update on public.profiles
  for each row execute function public.touch_sync_columns();

-- profiles uses a column-scoped select grant (migration 00010), unlike the
-- other four tables above -- a new column doesn't retroactively appear in
-- an existing column-list grant, so sync_seq must be added explicitly or
-- the incremental pull would silently be unable to read its own cursor
-- column back for this table.
grant select (
  id, email, full_name, first_name, last_name, avatar_url, preferred_language,
  role, created_at, updated_at, sync_seq
) on public.profiles to authenticated;

alter table public.shop_status add column sync_seq bigint;
update public.shop_status set sync_seq = nextval('public.sync_seq');
alter table public.shop_status alter column sync_seq set not null;
create trigger shop_status_touch_sync
  before insert or update on public.shop_status
  for each row execute function public.touch_sync_columns();

-- ---- sales, sale_items, student_wallets: updated_at didn't exist at all ----

alter table public.sales add column updated_at timestamptz not null default now();
alter table public.sales add column sync_seq bigint;
update public.sales set updated_at = created_at, sync_seq = nextval('public.sync_seq');
alter table public.sales alter column sync_seq set not null;
create index idx_sales_sync_seq on public.sales (sync_seq);
create trigger sales_touch_sync
  before insert or update on public.sales
  for each row execute function public.touch_sync_columns();

alter table public.sale_items add column updated_at timestamptz not null default now();
alter table public.sale_items add column sync_seq bigint;
update public.sale_items si
set updated_at = s.created_at, sync_seq = nextval('public.sync_seq')
from public.sales s
where s.id = si.sale_id;
alter table public.sale_items alter column sync_seq set not null;
create index idx_sale_items_sync_seq on public.sale_items (sync_seq);
create trigger sale_items_touch_sync
  before insert or update on public.sale_items
  for each row execute function public.touch_sync_columns();

alter table public.student_wallets add column updated_at timestamptz not null default now();
alter table public.student_wallets add column sync_seq bigint;
update public.student_wallets set sync_seq = nextval('public.sync_seq');
alter table public.student_wallets alter column sync_seq set not null;
create index idx_student_wallets_sync_seq on public.student_wallets (sync_seq);
create trigger student_wallets_touch_sync
  before insert or update on public.student_wallets
  for each row execute function public.touch_sync_columns();

-- No further grant changes needed for products/categories/shop_status/
-- sales/sale_items/student_wallets: sync_seq/updated_at ride the same
-- table-wide select/insert/update grants every other column on these
-- tables already has (migration 00001). profiles is the one exception,
-- handled above.
