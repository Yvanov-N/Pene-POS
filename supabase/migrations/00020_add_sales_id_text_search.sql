-- ============================================================================
-- Phase 13: backend-paginated Sales History search needs to ilike sale ids,
-- but sales.id is uuid and Postgres has no ~~*/ilike operator for uuid
-- (confirmed against the local dev stack: "operator does not exist: uuid
-- ~~* unknown") -- PostgREST also doesn't support an inline column::text
-- cast in filter position. Same technique already used for profiles.full_name
-- in migration 00010: expose a generated, ilike-able text column instead.
-- ============================================================================
alter table public.sales
  add column id_text text generated always as (id::text) stored;

-- No new grant needed -- select on public.sales is already granted to
-- authenticated (migration 1); a generated column rides the same grant.
