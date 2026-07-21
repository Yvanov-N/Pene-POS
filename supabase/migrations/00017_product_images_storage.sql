-- product-images bucket: public read (image_url is displayed as a plain
-- <img src> everywhere in the app, same as avatars -- see migration 00011),
-- write restricted to admins since products aren't user-owned (no uid-folder
-- check like avatars has).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product_images_admin_write"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and public.current_role() = 'admin');

create policy "product_images_admin_update"
  on storage.objects for update
  using (bucket_id = 'product-images' and public.current_role() = 'admin')
  with check (bucket_id = 'product-images' and public.current_role() = 'admin');

create policy "product_images_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'product-images' and public.current_role() = 'admin');
