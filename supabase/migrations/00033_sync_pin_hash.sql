-- ============================================================================
-- Sync a client-comparable PIN hash down to every device.
--
-- profiles.pin_code (bcrypt, migration 00001) stays write-only via the API --
-- it remains the "real" credential and is never selectable. This adds a
-- second, deliberately weaker column: a plain SHA-256 hex digest of the same
-- 4-digit PIN, computed with the exact algorithm apps/web/src/lib/hashPin.ts
-- already uses locally. Unlike pin_code, this one IS meant to be pulled down
-- (see pull.ts), so that a PIN changed or reset on any one device is
-- recognized by every other device's offline PinPadModal check on its next
-- sync, instead of only working on the device the change was made on.
--
-- Exposure is no worse than what every authenticated device already gets for
-- the rest of a profile's roster (name, email, role) via the existing
-- profiles pull -- and a 4-digit PIN's keyspace is small regardless of hash
-- algorithm, so bcrypt vs SHA-256 buys no real protection here; pin_code
-- stays the one column that's never selectable at all.
-- ============================================================================

alter table public.profiles add column pin_hash text;

comment on column public.profiles.pin_hash is
  'SHA-256 hex digest of the 4-digit PIN, same algorithm as the client''s local cache -- synced down so a PIN change/reset on one device is recognized on all of them. Not the real credential; see pin_code.';

-- Additive: the existing column-list grant (migration 00001) already omits
-- pin_code on purpose, so re-declaring the full list here would silently
-- keep pin_code excluded regardless -- this just adds pin_hash to what
-- `authenticated` may select.
grant select (pin_hash) on public.profiles to authenticated;

-- Redefine to also keep pin_hash current every time a PIN is written --
-- same signature/security posture as migration 00012, just one more column
-- set in the same statement.
create or replace function public.update_own_pin_code(new_pin text)
returns void
language plpgsql
security invoker
as $$
begin
  if new_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = '22023';
  end if;

  update public.profiles
  set
    pin_code = crypt(new_pin, gen_salt('bf')),
    pin_hash = encode(digest(new_pin, 'sha256'), 'hex'),
    updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'no profile row updated -- caller is not an admin, or has no matching profile';
  end if;
end;
$$;
