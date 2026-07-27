-- ============================================================================
-- Fix: shop_status trigger + inventory-alerts-hourly cron never actually
-- reached their edge functions.
-- ============================================================================
--
-- 00014's net.http_post() calls only ever sent an `apikey` header. Neither
-- notify-shop-status nor inventory-alerts has a supabase/config.toml
-- override, so both keep the CLI default verify_jwt = true (confirmed
-- deliberate -- .github/workflows/deploy-production.yml's own deploy-edge-
-- functions comment: "true for dispatch-push and notify-shop-status, which
-- must not be callable by an anonymous request"). The Edge Functions gateway
-- enforces verify_jwt by checking `Authorization: Bearer <jwt>` -- `apikey`
-- alone does not satisfy it (the same workflow's own working dispatch-push
-- curl call, a few jobs later, sends both headers side by side). So every
-- trigger/cron-fired call was rejected with 401 before the function body
-- ever ran, in every environment -- not just something misconfigured on the
-- real hosted project.
--
-- A new migration, not an edit to 00014, for the same reason 00014 itself
-- gave for not editing migration 3: 00014 already shipped and replayed
-- elsewhere (including the real hosted project per its own comment), so
-- changing it in place wouldn't reach anything that already ran it.
-- ============================================================================

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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_anon_key,
        'Authorization', 'Bearer ' || v_anon_key
      ),
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

-- cron.schedule with an existing job name replaces it in place (same owner
-- as 00014) -- no separate unschedule step needed here either.
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
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', v_anon_key,
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := '{}'::jsonb
      );
    end if;
  end;
  $do$;
  $$
);
