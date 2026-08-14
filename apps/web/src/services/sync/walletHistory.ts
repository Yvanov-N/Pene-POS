import { supabase } from "@/lib/supabase";
import type { StudentWallet } from "@/types/db";

// ============================================================================
// Admin-facing wallet views, both live Supabase reads rather than local
// Dexie queries -- same "deliberate exception to the offline-first read
// rule" as listRecentSyncEvents in conflicts.ts: neither has (or needs) a
// local mirror, since both are audit/management views, not data a cashier
// needs while offline.
// ============================================================================

export interface WalletTransaction {
  operationId: string;
  delta: number;
  reason: "recharge" | "withdrawal";
  balanceAfter: number;
  occurredAt: string;
}

interface SyncOperationResult {
  wallet?: { balance: number };
  delta?: number;
  reason?: string;
}

// sync_operations (migration 00024) already records every adjust_wallet_balance
// call -- recharges, withdrawals, and also purchase debits/refund credits
// (reason "sale:<id>"/"void:<id>"). Those last two are filtered out here:
// they already show in the drawer's own sales-history tab, so surfacing them
// again here would just duplicate the same event under a different label.
export async function listWalletTransactions(walletId: string, limit = 50): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from("sync_operations")
    .select("id,result,created_at")
    .eq("op_type", "adjust_wallet_balance")
    .eq("entity_table", "student_wallets")
    .eq("entity_id", walletId)
    .eq("outcome", "completed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[walletHistory] failed to fetch wallet transactions", error);
    return [];
  }

  const transactions: WalletTransaction[] = [];
  for (const row of data) {
    const result = row.result as SyncOperationResult | null;
    if (result?.reason !== "recharge" && result?.reason !== "withdrawal") continue;
    if (typeof result.delta !== "number" || typeof result.wallet?.balance !== "number") continue;
    transactions.push({
      operationId: row.id,
      delta: result.delta,
      reason: result.reason,
      balanceAfter: result.wallet.balance,
      occurredAt: row.created_at,
    });
  }
  return transactions;
}

export type ArchivedStudentWallet = StudentWallet & { deleted_at: string };

export async function listArchivedWallets(searchTerm = ""): Promise<ArchivedStudentWallet[]> {
  let query = supabase
    .from("student_wallets")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  const term = searchTerm.trim().replace(/[%,()]/g, "");
  if (term) {
    query = query.or(`student_name.ilike.%${term}%,badge_code.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[walletHistory] failed to fetch archived wallets", error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    student_name: row.student_name,
    badge_code: row.badge_code,
    balance: row.balance,
    email: row.email ?? "",
    email_opt_in: row.email_opt_in,
    phone: row.phone ?? "",
    updated_at: row.updated_at,
    sync_seq: row.sync_seq,
    deleted_at: row.deleted_at as string,
  }));
}
