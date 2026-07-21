-- ============================================================================
-- Dev-only seed data. Runs after migrations on `supabase db reset` (and on
-- the first `supabase start`). NOT for production -- these are throwaway
-- local-dev credentials, not secrets.
-- ============================================================================

-- Local values for migration 00014's parameterized notify-shop-status
-- trigger / inventory-alerts cron job (public.app_settings, not a Postgres
-- GUC -- see that migration's own comment for why). `kong` is the API
-- gateway's internal Docker network alias; the anon key is the fixed,
-- well-known default for every local Supabase stack (same one migration 3
-- used to hardcode) -- public and safe to commit, unlike a service_role
-- key. A real hosted project sets its own values directly (see migration
-- 00014's own comment for the exact command) -- never from this file, which
-- is dev-only and never applied to a remote project by `supabase db push`.
insert into public.app_settings (key, value)
values
  ('functions_url', 'http://kong:8000/functions/v1'),
  ('anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0')
on conflict (key) do update set value = excluded.value;

-- Default admin account for local development.
--   Email:    admin@penepos.dev
--   Password: DevAdmin123!
--   PIN:      1234 (server-side hash here; the separate local Dexie mock
--             profile seeded by apps/web/src/lib/seedLocalProfiles.ts for
--             the PIN pad uses the same PIN but its own SHA-256 cache --
--             see the note on Profile in apps/web/src/types/db.ts).
do $$
declare
  dev_admin_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  if not exists (select 1 from auth.users where id = dev_admin_id) then
    insert into auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      created_at, updated_at
    ) values (
      dev_admin_id, '00000000-0000-0000-0000-000000000000', 'admin@penepos.dev',
      crypt('DevAdmin123!', gen_salt('bf')), now(),
      '{"provider":"email"}', '{}', 'authenticated', 'authenticated',
      '', '', '', '', '', '', '', '',
      now(), now()
    );

    -- full_name is a generated column (migration 00010, first_name || ' ' ||
    -- last_name) -- inserting into it directly is rejected by Postgres.
    insert into public.profiles (id, email, first_name, last_name, role, pin_code)
    values (dev_admin_id, 'admin@penepos.dev', 'Dev', 'Admin', 'admin', crypt('1234', gen_salt('bf')));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Demo product categories, matching the fixed ids in
-- apps/web/src/lib/seedLocalCategories.ts (its own local-only Dexie seed).
-- Must exist before the products insert below, which references these ids
-- via category_id.
-- ----------------------------------------------------------------------------
insert into public.categories (id, name)
values
  ('00000000-0000-0000-0000-000000000201', 'Boissons'),
  ('00000000-0000-0000-0000-000000000202', 'Snacks'),
  ('00000000-0000-0000-0000-000000000203', 'Laiterie'),
  ('00000000-0000-0000-0000-000000000204', 'Recharge'),
  ('00000000-0000-0000-0000-000000000205', 'Epicerie'),
  ('00000000-0000-0000-0000-000000000206', 'Hygiene')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Demo product catalog, matching the fixed ids in
-- apps/web/src/lib/seedLocalProducts.ts (its own local-only Dexie seed).
-- These ids must stay aligned: the local seed is what a fresh POS actually
-- sells against, and sale_items.product_id has a foreign key into this
-- table, so any local mock product without a matching row here makes every
-- sale referencing it permanently fail to sync (23503, retried and then
-- silently stuck at status "failed" -- the bug this seed block fixes).
-- ----------------------------------------------------------------------------
insert into public.products (id, name, price, stock, barcode, category_id, emoji, expiry_date)
values
  ('00000000-0000-0000-0000-000000000101', 'Coca-Cola 33cl', 500, 40, '6001234567890', '00000000-0000-0000-0000-000000000201', '🥤', null),
  ('00000000-0000-0000-0000-000000000102', 'Eau minerale 50cl', 300, 60, '6001234567891', '00000000-0000-0000-0000-000000000201', '💧', null),
  ('00000000-0000-0000-0000-000000000103', 'Chips Plantain', 400, 25, '6001234567892', '00000000-0000-0000-0000-000000000202', '🍟', null),
  ('00000000-0000-0000-0000-000000000104', 'Biscuits Choco', 350, 2, '6001234567893', '00000000-0000-0000-0000-000000000202', '🍪', null),
  ('00000000-0000-0000-0000-000000000105', 'Yaourt Nature', 450, 15, '6001234567894', '00000000-0000-0000-0000-000000000203', '🥛', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000000106', 'Fromage Fondu', 600, 10, '6001234567895', '00000000-0000-0000-0000-000000000203', '🧀', null),
  ('00000000-0000-0000-0000-000000000107', 'Recharge MoMo 1000F', 1000, 999, '6001234567896', '00000000-0000-0000-0000-000000000204', '💳', null),
  ('00000000-0000-0000-0000-000000000108', 'Sardine Boite', 550, 12, '6001234567897', '00000000-0000-0000-0000-000000000205', '🐟', null),
  ('00000000-0000-0000-0000-000000000109', 'Savon', 250, 0, '6001234567898', '00000000-0000-0000-0000-000000000206', '🧼', null)
on conflict (id) do nothing;
