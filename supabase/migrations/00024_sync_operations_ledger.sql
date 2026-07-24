-- ============================================================================
-- Sync rebuild, part 3 -- a general-purpose idempotency ledger.
-- ============================================================================
--
-- Why: complete_sale's idempotency (migration 00015) only works because it
-- can check "does a sales row with this client-chosen id already exist" --
-- a trick specific to inserts with a client-supplied primary key. It does
-- not generalize to adjust_wallet_balance (a plain, non-idempotent
-- `balance = balance + delta`, confirmed -- a retried push could double
-- apply) or to the new stock/void RPCs being added this phase. This table
-- gives every mutating RPC one shared mechanism: take a client-generated
-- operation_id as its first argument, check this table for it inside the
-- same transaction, record the outcome before returning. A retry (lost
-- response, network blip, duplicate offline-queue drain) becomes a safe
-- no-op replay instead of a duplicate effect.
-- ============================================================================

create table public.sync_operations (
  id uuid primary key,
  op_type text not null,
  entity_table text,
  entity_id uuid,
  outcome text not null check (outcome in ('completed', 'conflict')),
  result jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index idx_sync_operations_entity on public.sync_operations (entity_table, entity_id);
create index idx_sync_operations_created_at on public.sync_operations (created_at);

alter table public.sync_operations enable row level security;

-- Every mutating RPC (complete_sale_v2, adjust_wallet_balance_v2,
-- adjust_product_stock, void_sale) runs `security invoker` -- same
-- convention as every existing RPC in this schema -- so its own internal
-- select/insert against this ledger executes as whichever role actually
-- called it. A cashier ringing up a sale must be able to check and record
-- its own idempotency entry, or checkout would fail RLS for every cashier,
-- not just admins. There is nothing confidential in a row here (op type,
-- which table/row it touched, completed-vs-conflict) that would justify
-- restricting this the way profiles.pin_code is restricted.
create policy "sync_operations_insert_authenticated"
  on public.sync_operations for insert
  to authenticated
  with check (true);

create policy "sync_operations_select_authenticated"
  on public.sync_operations for select
  to authenticated
  using (true);

-- Deliberately no update/delete policy and no update/delete grant below --
-- append-only, enforced the same way profiles.pin_code is kept
-- unreadable-by-omission: there is simply no path that can mutate a row
-- once inserted.
grant select, insert on public.sync_operations to authenticated;
grant select, insert on public.sync_operations to service_role;
