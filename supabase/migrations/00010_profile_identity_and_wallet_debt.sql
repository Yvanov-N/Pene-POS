-- Phase 11: profile identity fields (first/last name, avatar, language),
-- student wallet email opt-out, and wallet debt tracking.

-- ----------------------------------------------------------------------------
-- profiles: split full_name into first_name/last_name, kept as a generated
-- column so the existing read sites (receipts, sales history, the
-- public-receipt RPCs' embedded JSON, the MoMo verification card) never need
-- to change. Also adds avatar_url and preferred_language.
-- ----------------------------------------------------------------------------
alter table public.profiles add column first_name text;
alter table public.profiles add column last_name text;

-- Backfill from the existing full_name: first word -> first_name, remainder
-- -> last_name. Good enough for this project's handful of seeded/demo
-- profiles; a real multi-word-first-name case would just need a human to
-- correct it once via the new Settings profile form.
update public.profiles
set
  first_name = split_part(full_name, ' ', 1),
  last_name = trim(substring(full_name from length(split_part(full_name, ' ', 1)) + 1));

alter table public.profiles alter column first_name set default '';
alter table public.profiles alter column first_name set not null;
alter table public.profiles alter column last_name set default '';
alter table public.profiles alter column last_name set not null;

alter table public.profiles drop column full_name;
alter table public.profiles add column full_name text
  generated always as (trim(both ' ' from (coalesce(first_name, '') || ' ' || coalesce(last_name, '')))) stored;

alter table public.profiles add column avatar_url text;
alter table public.profiles add column preferred_language text not null default 'fr'
  check (preferred_language in ('fr', 'en'));

-- Re-grant: the original column-restricted select list (migration 00001)
-- must be extended explicitly -- a new column doesn't retroactively appear
-- in an existing column-list grant.
grant select (
  id, email, full_name, first_name, last_name, avatar_url, preferred_language,
  role, created_at, updated_at
) on public.profiles to authenticated;

-- Self-service profile editing (Settings page) -- profiles_admin_all already
-- lets an admin edit any row; this adds "edit your own row" for whichever
-- account is actually signed in via Supabase Auth on this device, distinct
-- from the PIN-based admin/cashier switching that governs page access.
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- profiles_update_own is row-scoped only -- Postgres RLS has no per-column
-- concept, so without this trigger a self-edit could also silently smuggle
-- in a role/pin_code change via the same UPDATE. Mirrors
-- enforce_cashier_product_columns() (migration 00002): a role-based
-- column-write guard implemented as a trigger, not RLS.
create or replace function public.enforce_profile_self_edit_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    if new.role is distinct from old.role then
      raise exception 'only admins may change a profile role' using errcode = '42501';
    end if;
    if new.pin_code is distinct from old.pin_code then
      raise exception 'only admins may change a profile pin' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.enforce_profile_self_edit_columns();

-- ----------------------------------------------------------------------------
-- student_wallets: email opt-out + a deliberately-allowed (but still guarded)
-- negative balance, representing student debt to the shop.
-- ----------------------------------------------------------------------------
alter table public.student_wallets add column email_opt_in boolean not null default true;

-- The blanket "balance can never go negative" CHECK (migration 00002) is
-- replaced by an equivalent guard inside adjust_wallet_balance below, not
-- just deleted outright -- a cross-device sync race on a wallet-payment
-- checkout debit (or a cash withdrawal, added this phase) still needs to be
-- caught as a sync conflict instead of silently overdrafting. The difference
-- is this is now a deliberate application-level decision instead of a
-- blanket table invariant -- a future "sell on credit" feature could choose
-- to bypass it on purpose. Nothing in this phase does: withdrawal is
-- explicitly capped at the current positive balance, and wallet-payment
-- checkout already blocks insufficient balance client-side -- so in
-- practice, today, balance still never goes negative through the app's own
-- flows. The dashboard's debt-tracking widgets are correct, forward-looking
-- infrastructure for whenever a later feature actually creates debt.
alter table public.student_wallets drop constraint student_wallets_balance_non_negative;

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

  if updated_wallet.balance < 0 then
    -- Deliberately raised with the check_violation SQLSTATE (23514) -- the
    -- sync push engine (syncService.ts) already special-cases this exact
    -- code to mark the mutation a "conflict" for admin review instead of
    -- silently retrying or losing it. Reusing it here keeps that existing
    -- client-side handling working unchanged for WALLET_WITHDRAWAL too.
    raise exception 'insufficient wallet balance' using errcode = '23514';
  end if;

  return updated_wallet;
end;
$$;
