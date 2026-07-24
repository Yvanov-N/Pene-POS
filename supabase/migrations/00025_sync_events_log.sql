-- ============================================================================
-- Sync rebuild, part 4 -- an append-only diagnostic event log.
-- ============================================================================
--
-- Why: there is no error tracking/telemetry anywhere in this app today --
-- every sync bug fixed so far (including the three root causes this
-- rebuild addresses) had to be found by reading code, not logs. This table
-- gives the client one durable place to record what happened -- pushes,
-- pulls, conflicts, negative-stock/negative-balance outcomes, and
-- uncaught exceptions -- so future incidents are diagnosable instead of
-- requiring another full code archaeology pass. Written by the client
-- through the same durable local-outbox mechanism as business writes (see
-- src/services/sync/outbox.ts), so a crash log can't itself be lost while
-- offline.
-- ============================================================================

create table public.sync_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  device_id text,
  session_id text,
  profile_id uuid references public.profiles (id),
  event_type text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  entity_table text,
  entity_id uuid,
  operation_id uuid,
  pg_error_code text,
  message text,
  context jsonb
);

create index idx_sync_events_occurred_at on public.sync_events (occurred_at);
create index idx_sync_events_severity on public.sync_events (severity) where severity <> 'info';
create index idx_sync_events_operation_id on public.sync_events (operation_id);

alter table public.sync_events enable row level security;

-- Any authenticated device/session can write its own breadcrumbs (cashier
-- or admin, same as every other write path in this app). Reading them back
-- is admin-only -- unlike sync_operations, events can carry free-text error
-- messages/context, which is exactly the kind of thing that should only
-- surface on the admin-facing Sync Health dashboard, not to every cashier
-- terminal.
create policy "sync_events_insert_authenticated"
  on public.sync_events for insert
  to authenticated
  with check (true);

create policy "sync_events_select_admin"
  on public.sync_events for select
  using (public.current_role() = 'admin');

-- Deliberately no update/delete policy and no update/delete grant below --
-- append-only, same convention as sync_operations.
grant select, insert on public.sync_events to authenticated;
grant select, insert on public.sync_events to service_role;
