-- ============================================================================
-- Phase 16 -- parameterize the Database Webhook / cron edge-function calls
-- migration 3 hardcoded against the local dev stack.
-- ============================================================================
--
-- migration 3's shop_status_notify trigger and inventory-alerts-hourly cron
-- job both hardcoded `http://kong:8000/...` (the local Docker gateway's
-- internal alias -- unreachable from a real hosted project) and the fixed
-- public local-dev demo anon key. That's exactly right for `supabase start`,
-- but wrong for a real deploy, and the two can't share one hardcoded value:
-- a migration is the same file replayed on every environment, so whatever
-- got hardcoded for local dev would ALSO become the hosted project's value
-- (and vice versa) the moment either one pushed.
--
-- Fix: read both from a small settings table instead of hardcoding either.
-- Two things ruled out a Postgres GUC (current_setting()/ALTER DATABASE ...
-- SET), both confirmed live against the local stack, not assumed:
--   1. CREATE TRIGGER ... EXECUTE FUNCTION arguments must be literal
--      constants, not expressions -- `current_setting('x') || 'y'` there is
--      a syntax error, not a runtime one (migration 3's trigger passed
--      hardcoded literals for exactly this reason, not by oversight).
--   2. ALTER DATABASE ... SET <custom-param> needs a true superuser.
--      Supabase's `postgres` role is deliberately NOT one (only the
--      internal `supabase_admin` is, confirmed via `select rolsuper from
--      pg_roles`) -- true on a real hosted project too, not just local, so
--      this was never going to work there either.
-- A plain table has neither restriction: a SECURITY DEFINER function can
-- read arbitrary expressions from it, and the `postgres` role (what both
-- `supabase db push` and the Dashboard's SQL Editor connect as) already has
-- full DML rights on anything it creates in `public` -- no elevated
-- privilege needed to populate it, locally or on a real project.
--
-- The trigger itself also can't stay as a literal-argument call to the
-- extension's supabase_functions.http_request once the URL/key must be
-- looked up dynamically (same restriction as point 1 above) -- replaced
-- with a plain plpgsql trigger function that calls net.http_post() itself,
-- reproducing the exact {type, table, schema, record, old_record} body
-- shape notify-shop-status/index.ts already parses (see its own top-of-file
-- comment) -- not a payload shape change, just who builds it.
--
-- Per-environment setup (NOT part of this migration, deliberately -- see
-- above for why hardcoding either environment's value here would break the
-- other):
--   * local dev: supabase/seed.sql inserts the local stack's fixed values
--     on every `supabase start` / `db reset`. Nothing else to do.
--   * hosted project: run once, directly against that project (Dashboard's
--     SQL Editor, or `supabase db execute` against the linked project),
--     substituting its real project ref and anon key (both public-safe --
--     see migration 3's own note -- so no secret-handling concern here):
--       insert into public.app_settings (key, value) values
--         ('functions_url', 'https://<project-ref>.supabase.co/functions/v1'),
--         ('anon_key', '<anon-key>')
--       on conflict (key) do update set value = excluded.value;
--     Must be re-run if this project's anon key is ever rotated.
-- ============================================================================

-- Deliberately no grants to anon/authenticated -- this is read only by
-- SECURITY DEFINER trigger/cron functions below, never by PostgREST or the
-- app directly, so it's not part of the public API surface at all.
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

revoke all on public.app_settings from public, anon, authenticated;

create or replace function public.notify_shop_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_functions_url text := (select value from public.app_settings where key = 'functions_url');
  v_anon_key text := (select value from public.app_settings where key = 'anon_key');
begin
  if v_functions_url is not null and v_anon_key is not null then
    perform net.http_post(
      url := v_functions_url || '/notify-shop-status',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_anon_key),
      body := jsonb_build_object(
        'type', TG_OP,
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      ),
      timeout_milliseconds := 5000
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists shop_status_notify on public.shop_status;

create trigger shop_status_notify
  after update on public.shop_status
  for each row
  execute function public.notify_shop_status_change();

-- cron.schedule with an existing job name replaces it in place (same owner)
-- -- no separate unschedule step needed. A `do` block (not a bare `select
-- ... where`) for the same reason as the trigger function above: explicit
-- if/then control flow, not relying on whether a no-FROM `where` clause
-- suppresses evaluating a side-effecting call in the target list.
select cron.schedule(
  'inventory-alerts-hourly',
  '0 * * * *',
  $$
  do $do$
  declare
    v_functions_url text := (select value from public.app_settings where key = 'functions_url');
    v_anon_key text := (select value from public.app_settings where key = 'anon_key');
  begin
    if v_functions_url is not null and v_anon_key is not null then
      perform net.http_post(
        url := v_functions_url || '/inventory-alerts',
        headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_anon_key),
        body := '{}'::jsonb
      );
    end if;
  end;
  $do$;
  $$
);
