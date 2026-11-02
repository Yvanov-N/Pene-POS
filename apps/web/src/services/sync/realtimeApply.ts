import type { Table } from "dexie";
import { db } from "@/lib/db";
import {
  mapCategoryRow,
  mapProductRow,
  mapSaleItemRow,
  mapSaleRow,
  mapShopStatusRow,
  mapWalletRow,
  writeBackIfNewer,
} from "@/services/sync/pull";

// Tables in the supabase_realtime publication (migrations 00016, 00040).
export const REALTIME_TABLES = ["products", "sales", "student_wallets", "sale_items", "categories", "shop_status"] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];

// The subset of Supabase's RealtimePostgresChangesPayload this needs.
export interface RealtimeChange {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

interface Target {
  table: Table<{ id: string | number; sync_seq?: number }, string | number>;
  map: (row: never) => { id: string | number; sync_seq?: number };
  // Soft-deletable (migrations 00023/00035): an UPDATE setting deleted_at
  // means "gone", same as the pull's tombstone handling.
  softDelete: boolean;
}

function targetFor(table: RealtimeTable): Target {
  switch (table) {
    case "products":
      return { table: db.products as never, map: mapProductRow as never, softDelete: true };
    case "categories":
      return { table: db.categories as never, map: mapCategoryRow as never, softDelete: true };
    case "student_wallets":
      return { table: db.student_wallets as never, map: mapWalletRow as never, softDelete: true };
    case "sales":
      return { table: db.sales as never, map: mapSaleRow as never, softDelete: false };
    case "sale_items":
      return { table: db.sale_items as never, map: mapSaleItemRow as never, softDelete: false };
    case "shop_status":
      return { table: db.shop_status as never, map: mapShopStatusRow as never, softDelete: false };
  }
}

// Applies one Realtime change straight into Dexie -- the payload carries the
// full new row (numbers as numbers, sync_seq included), so another till's
// sale or restock reaches this screen with zero extra requests.
//
// Same merge rule as the pull ("only accept if newer", by sync_seq), so a
// late or duplicate message can't roll a row back. Sync cursors are left
// alone on purpose: a cursor only means "every row up to here is local",
// which one message can't prove (another one may have been lost). The next
// periodic watermark sync re-reads those rows once as a safety net; they're
// already identical locally, so it writes nothing.
//
// Returns false when the payload can't be trusted as a full row (unknown
// table, missing id/sync_seq) -- the caller then falls back to a pull.
export async function applyRealtimeChange(change: RealtimeChange): Promise<boolean> {
  if (!(REALTIME_TABLES as readonly string[]).includes(change.table)) return false;
  const target = targetFor(change.table as RealtimeTable);

  if (change.eventType === "DELETE") {
    const id = change.old.id as string | number | undefined;
    if (id === undefined) return false;
    await target.table.delete(id);
    return true;
  }

  const row = change.new;
  if (row.id === undefined || typeof row.sync_seq !== "number") return false;

  if (target.softDelete && row.deleted_at) {
    await target.table.delete(row.id as string | number);
    return true;
  }
  await writeBackIfNewer(target.table, [row as never], target.map);
  return true;
}
