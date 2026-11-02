-- ============================================================================
-- Emergency data export / import (Settings > Data backup).
-- ============================================================================
--
-- Why: the shop needs a way out -- a full copy of its business data it can
-- keep, restore, or load into another database engine -- without relying on
-- dashboard access or pg_dump. Two admin-only RPCs back the Settings tile:
--
--   admin_export_data()            every business table as JSON: column
--                                  descriptions (to generate portable SQL
--                                  client-side) + all rows, soft-deleted ones
--                                  included. Never exported: pin_code,
--                                  pin_hash (secrets), sync_seq and
--                                  data_epoch (this app's own sync plumbing).
--   admin_import_data(payload, mode)
--                                  applies such a payload in ONE transaction:
--                                  any error (bad file, broken reference...)
--                                  leaves the database exactly as it was.
--       'merge'   insert-or-update by id; rows absent from the file stay.
--       'replace' business tables are emptied first, then refilled -- the
--                 file becomes the whole dataset.
--
-- Profiles are tied to auth.users (logins) and are never created or deleted
-- by an import: only their display fields (names, avatar, language) are
-- updated. Roles and e-mails are left alone so a restore can't lock the
-- restoring admin out. A sale whose cashier has no profile here is attached
-- to the importing admin (sales.cashier_id is required); a shop_status
-- updated_by that doesn't exist is cleared.
--
-- 'replace' also bumps shop_status.data_epoch. Hard deletes are invisible to
-- the cursor-based sync (there's no row left to carry a new sync_seq), so
-- every device compares this counter with its own and, when it moved,
-- rebuilds its local copy from scratch (services/sync/pull.ts).
--
-- SECURITY DEFINER (with an explicit admin check) because profiles.pin_code
-- isn't readable by `authenticated` at all (column grant, 00001) and the
-- replace mode deletes from append-only tables; search_path is pinned.
-- ============================================================================

alter table public.shop_status add column data_epoch bigint not null default 0;

-- sale_items_snapshot_cost (00036) fills a missing unit_cost with the
-- product's CURRENT purchase price. Right for a new sale; wrong while
-- restoring history, where a null cost means "sold before costs were
-- recorded" and must stay null. admin_import_data sets app.importing for its
-- own transaction only.
create or replace function public.snapshot_sale_item_cost()
returns trigger language plpgsql as $$
begin
  if new.unit_cost is null and coalesce(current_setting('app.importing', true), '') <> 'on' then
    select cost_price into new.unit_cost from public.products where id = new.product_id;
  end if;
  return new;
end;
$$;

create or replace function public.admin_export_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables text[] := array[
    'categories', 'products', 'student_wallets', 'profiles', 'shop_status',
    'suppliers', 'supplier_products', 'sales', 'sale_items', 'stock_purchases',
    'supplier_price_history'
  ];
  v_hidden text[] := array['sync_seq', 'pin_code', 'pin_hash', 'data_epoch'];
  v_table text;
  v_columns jsonb;
  v_rows jsonb;
  v_out jsonb := '{}'::jsonb;
begin
  if public.current_role() is distinct from 'admin' then
    raise exception 'only an admin can export the data' using errcode = '42501';
  end if;

  foreach v_table in array v_tables loop
    select jsonb_agg(
             jsonb_build_object(
               'name', c.column_name,
               'type', case when c.data_type = 'USER-DEFINED' then 'enum' else c.data_type end,
               'nullable', c.is_nullable = 'YES',
               'generated', c.is_generated <> 'NEVER'
             ) order by c.ordinal_position)
      into v_columns
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_table and c.column_name <> all (v_hidden);

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) - $1::text[]), ''[]''::jsonb) from public.%I t',
      v_table
    ) into v_rows using v_hidden;

    v_out := v_out || jsonb_build_object(v_table, jsonb_build_object('columns', v_columns, 'rows', v_rows));
  end loop;

  return jsonb_build_object(
    'format', 'pene-pos-backup',
    'version', 1,
    'exported_at', now(),
    'tables', v_out
  );
end;
$$;

create or replace function public.admin_import_data(p_payload jsonb, p_mode text default 'merge')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Parents before children, so every reference already exists.
  v_tables text[] := array[
    'categories', 'products', 'student_wallets', 'profiles', 'shop_status',
    'suppliers', 'supplier_products', 'sales', 'sale_items', 'stock_purchases',
    'supplier_price_history'
  ];
  v_skip text[] := array['sync_seq', 'pin_code', 'pin_hash', 'data_epoch'];
  v_admin uuid := auth.uid();
  v_table text;
  v_rows jsonb;
  v_cols text;
  v_set text;
  v_count integer;
  v_remapped integer := 0;
  v_counts jsonb := '{}'::jsonb;
begin
  if public.current_role() is distinct from 'admin' then
    raise exception 'only an admin can import data' using errcode = '42501';
  end if;
  if p_mode not in ('merge', 'replace') then
    raise exception 'unknown import mode %', p_mode;
  end if;
  if p_payload ->> 'format' is distinct from 'pene-pos-backup' or jsonb_typeof(p_payload -> 'tables') <> 'object' then
    raise exception 'not a Pene POS backup file';
  end if;

  -- Transaction-local (third argument true): restored sale lines keep their
  -- recorded cost, null included (see snapshot_sale_item_cost above).
  perform set_config('app.importing', 'on', true);

  if p_mode = 'replace' then
    -- Children first. Profiles and the shop_status row are kept (see header).
    delete from public.supplier_price_history where true;
    delete from public.stock_purchases where true;
    delete from public.sale_items where true;
    delete from public.sales where true;
    delete from public.supplier_products where true;
    delete from public.suppliers where true;
    delete from public.products where true;
    delete from public.categories where true;
    delete from public.student_wallets where true;
  end if;

  foreach v_table in array v_tables loop
    v_rows := p_payload -> 'tables' -> v_table -> 'rows';
    if v_rows is null or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
      continue;
    end if;

    if v_table = 'profiles' then
      update public.profiles p
         set first_name = coalesce(r.first_name, p.first_name),
             last_name = coalesce(r.last_name, p.last_name),
             avatar_url = coalesce(r.avatar_url, p.avatar_url),
             preferred_language = coalesce(r.preferred_language, p.preferred_language)
        from jsonb_populate_recordset(null::public.profiles, v_rows) r
       where p.id = r.id;
      get diagnostics v_count = row_count;
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
      continue;
    end if;

    if v_table = 'sales' then
      select count(*) into v_remapped
        from jsonb_array_elements(v_rows) e
       where not exists (select 1 from public.profiles where id = (e ->> 'cashier_id')::uuid);
      select jsonb_agg(
               case when exists (select 1 from public.profiles where id = (e ->> 'cashier_id')::uuid)
                    then e
                    else jsonb_set(e, '{cashier_id}', to_jsonb(v_admin::text)) end)
        into v_rows
        from jsonb_array_elements(v_rows) e;
    elsif v_table = 'shop_status' then
      select jsonb_agg(
               case when e ->> 'updated_by' is null
                      or exists (select 1 from public.profiles where id = (e ->> 'updated_by')::uuid)
                    then e
                    else jsonb_set(e, '{updated_by}', 'null'::jsonb) end)
        into v_rows
        from jsonb_array_elements(v_rows) e;
    end if;

    -- Columns this file actually carries (first row), minus generated ones and
    -- this app's sync plumbing -- an older file missing a newer column then
    -- leaves that column alone instead of nulling it.
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
           string_agg(format('%I = excluded.%I', c.column_name, c.column_name), ', ' order by c.ordinal_position)
      into v_cols, v_set
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = v_table
       and c.is_generated = 'NEVER'
       and c.column_name <> all (v_skip)
       and (v_rows -> 0) ? c.column_name;

    if v_cols is null then
      continue;
    end if;

    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) '
      'on conflict (id) do update set %s',
      v_table, v_cols, v_cols, v_table, v_set
    ) using v_rows;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;

  if p_mode = 'replace' then
    update public.shop_status set data_epoch = data_epoch + 1 where id = 1;
  end if;

  return jsonb_build_object(
    'mode', p_mode,
    'counts', v_counts,
    'remapped_cashiers', v_remapped,
    'data_epoch', (select data_epoch from public.shop_status where id = 1)
  );
end;
$$;

revoke execute on function public.admin_export_data() from public, anon;
grant execute on function public.admin_export_data() to authenticated;
revoke execute on function public.admin_import_data(jsonb, text) from public, anon;
grant execute on function public.admin_import_data(jsonb, text) to authenticated;
