-- ============================================================================
-- Sync rebuild, part 6 -- a ledger-guarded overload of adjust_wallet_balance.
-- ============================================================================
--
-- Why: the existing adjust_wallet_balance(uuid, numeric) (migrations 00002,
-- 00010, 00019) is a plain `balance = balance + delta` with no idempotency
-- check at all -- confirmed: a retried push after a dropped response would
-- double-apply. It's also the direct RPC pushWalletBalanceAdjustment calls
-- for a checkout wallet debit, so it's implicated in the "duplicate sales"
-- class of bug reported for wallet-paid sales specifically.
--
-- This adds a NEW overload (4 args, keyed by p_operation_id) rather than
-- editing the existing 2-arg function -- the old signature is left
-- completely untouched so an already-deployed client tab keeps calling it
-- successfully during rollout (Postgres resolves by argument list, and
-- PostgREST resolves by matching the request body's keys against each
-- overload's parameter names). The 2-arg version becomes dead code once
-- every client has upgraded, to be dropped in a later, separate cleanup
-- migration -- not this one.
-- ============================================================================

create or replace function public.adjust_wallet_balance(
  p_operation_id uuid,
  p_wallet_id uuid,
  p_delta numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing public.sync_operations;
  v_wallet public.student_wallets;
  v_negative boolean := false;
begin
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    return jsonb_build_object('outcome', 'replayed', 'operation_id', p_operation_id, 'result', v_existing.result);
  end if;

  update public.student_wallets
  set balance = balance + p_delta
  where id = p_wallet_id
  returning * into v_wallet;

  if not found then
    insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
    values (p_operation_id, 'adjust_wallet_balance', 'student_wallets', p_wallet_id, 'conflict',
      jsonb_build_object('reason', 'wallet_not_found', 'delta', p_delta));
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id, 'reason', 'wallet_not_found');
  end if;

  v_negative := v_wallet.balance < 0;

  insert into public.sync_operations (id, op_type, entity_table, entity_id, outcome, result)
  values (
    p_operation_id, 'adjust_wallet_balance', 'student_wallets', p_wallet_id, 'completed',
    jsonb_build_object('wallet', to_jsonb(v_wallet), 'delta', p_delta, 'negative_balance', v_negative, 'reason', p_reason)
  );

  if v_negative then
    -- Deliberately allowed (migration 00019's wallet-debt business rule),
    -- now a tracked, admin-visible outcome instead of a silent non-event.
    insert into public.sync_events (event_type, severity, entity_table, entity_id, operation_id, message, context)
    values ('negative_balance', 'warning', 'student_wallets', p_wallet_id, p_operation_id,
      'Wallet balance went negative for wallet ' || p_wallet_id::text,
      jsonb_build_object('balance', v_wallet.balance, 'delta', p_delta, 'reason', p_reason));
  end if;

  return jsonb_build_object(
    'outcome', 'completed',
    'operation_id', p_operation_id,
    'wallet', to_jsonb(v_wallet),
    'negative_balance', v_negative
  );
end;
$$;

revoke execute on function public.adjust_wallet_balance(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.adjust_wallet_balance(uuid, uuid, numeric, text) to authenticated;
