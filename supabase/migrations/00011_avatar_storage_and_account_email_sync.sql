-- Phase 11 follow-up: local avatar photo uploads (Supabase Storage) and
-- keeping public.profiles.email in sync with the real Supabase Auth login
-- email once an auth.updateUser({email}) change is confirmed.

-- ----------------------------------------------------------------------------
-- avatars bucket: public read (avatar URLs are displayed as plain <img src>
-- everywhere in the app, same as every other image_url/avatar_url field --
-- no signed-URL pattern exists anywhere in this codebase), write restricted
-- to the object's own user-id folder.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_own_write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_own_update"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_own_delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- auth.users.email -> public.profiles.email sync. Supabase's own
-- auth.updateUser({ email }) doesn't touch auth.users.email until the new
-- address is actually confirmed (a link sent to it, captured locally by
-- Inbucket) -- firing this trigger only on a real change to that column,
-- rather than writing profiles.email eagerly from the client the moment the
-- form is submitted, means profiles.email can never show an address that
-- isn't actually the confirmed login email yet.
-- ----------------------------------------------------------------------------
create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.sync_profile_email_from_auth();
