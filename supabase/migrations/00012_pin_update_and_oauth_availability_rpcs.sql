-- ============================================================================
-- Admin PIN self-service update + OAuth-availability check for the login
-- page.
-- ============================================================================

-- update_own_pin_code(): the only way to write profiles.pin_code from the
-- client. pin_code is bcrypt (pgcrypto crypt()/gen_salt('bf'), see migration
-- 1) -- there's no bcrypt implementation on the client, so the hashing has
-- to happen here, not in a plain `update profiles set pin_code = ...`.
--
-- security invoker, not definer: the caller already has everything this
-- needs. profiles_admin_all (migration 1) lets an admin UPDATE any row
-- including their own, so this only ever runs with the privileges the
-- caller already legitimately has -- no elevation required. A cashier
-- calling this hits the same RLS wall a plain UPDATE would (0 rows
-- affected -> "not found" below), which is the correct fail-closed result.
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
  set pin_code = crypt(new_pin, gen_salt('bf')), updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'no profile row updated -- caller is not an admin, or has no matching profile';
  end if;
end;
$$;

-- oauth_provider_linked(): the one thing the (unauthenticated) login page
-- needs to decide whether to show a "Sign in with Google/Apple" button at
-- all -- there's no point offering a provider nobody has ever linked, since
-- the shop's own Supabase project may not even have it configured yet, and
-- a broken OAuth button is worse than no button.
--
-- auth.identities isn't reachable through PostgREST directly (anon has zero
-- grants into the auth schema, by design), so this is a narrow, read-only
-- SECURITY DEFINER exception -- same shape as get_public_receipt (migration
-- 6): one specific yes/no fact, nothing that could enumerate accounts or
-- leak who linked what.
create or replace function public.oauth_provider_linked(provider_name text)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from auth.identities where provider = provider_name
  );
$$;

revoke all on function public.oauth_provider_linked(text) from public;
grant execute on function public.oauth_provider_linked(text) to anon, authenticated;
