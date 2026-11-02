-- ============================================================================
-- Sales history: search by product name.
-- ============================================================================
--
-- Why: the sales history search could match a sale id, cashier, student or
-- device, but not what was sold. Resolving matching product ids -> sale ids
-- client-side and OR-ing them in as `id.in.(...)` breaks down as soon as a
-- popular product has a few hundred sales (the whole id list goes into the
-- request URL). This view exposes each sale with the names of the products on
-- it, so the existing single PostgREST query just adds
-- `product_names.ilike.%term%` to its OR filter and keeps server-side
-- pagination and counting.
--
-- security_invoker (PG15+): the view runs with the caller's rights, so the
-- existing RLS on sales / sale_items / products applies unchanged -- nobody
-- sees a sale through the view they couldn't select directly. Product renames
-- show up immediately; there is no denormalised column to keep in sync.
-- ============================================================================

create view public.sales_search
with (security_invoker = true)
as
select
  s.*,
  coalesce(
    (
      select string_agg(distinct p.name, ' ')
      from public.sale_items si
      join public.products p on p.id = si.product_id
      where si.sale_id = s.id
    ),
    ''
  ) as product_names
from public.sales s;

grant select on public.sales_search to authenticated;
grant select on public.sales_search to service_role;
