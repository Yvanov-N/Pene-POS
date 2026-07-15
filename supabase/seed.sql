-- ============================================================================
-- Dev-only seed data. Runs after migrations on `supabase db reset` (and on
-- the first `supabase start`). NOT for production -- these are throwaway
-- local-dev credentials, not secrets.
-- ============================================================================

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

    insert into public.profiles (id, email, full_name, role, pin_code)
    values (dev_admin_id, 'admin@penepos.dev', 'Dev Admin', 'admin', crypt('1234', gen_salt('bf')));
  end if;
end $$;
