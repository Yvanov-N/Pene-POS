import { describe, expect, it } from "vitest";
import { backupToSql, parseBackupSql, type Backup } from "@/lib/backup";
import { signInAsDevAdmin } from "./testHelpers";

// Settings > Data backup (migration 00042): export, then import the very same
// data back -- merge from the SQL rendering, replace from the JSON -- and the
// database must come out identical.
describe("data export / import", () => {
  const counts = (backup: Backup) =>
    Object.fromEntries(Object.entries(backup.tables).map(([name, table]) => [name, table.rows.length]));

  it("exports every business table without secrets", async () => {
    const { client } = await signInAsDevAdmin();
    const { data, error } = await client.rpc("admin_export_data");
    expect(error).toBeNull();
    const backup = data as unknown as Backup;
    expect(backup.format).toBe("pene-pos-backup");
    expect(Object.keys(backup.tables)).toEqual(
      expect.arrayContaining(["products", "sales", "sale_items", "student_wallets", "suppliers", "stock_purchases", "profiles"]),
    );
    const profile = backup.tables.profiles.rows[0];
    expect(profile).not.toHaveProperty("pin_code");
    expect(profile).not.toHaveProperty("pin_hash");
    expect(backup.tables.products.rows[0]).not.toHaveProperty("sync_seq");
  });

  it("merge-imports its own SQL export without changing anything", async () => {
    const { client } = await signInAsDevAdmin();
    const before = (await client.rpc("admin_export_data")).data as unknown as Backup;
    const fromSql = parseBackupSql(backupToSql(before));

    const { data, error } = await client.rpc("admin_import_data", { p_payload: fromSql as never, p_mode: "merge" });
    expect(error).toBeNull();
    expect((data as { counts: Record<string, number> }).counts.products).toBe(before.tables.products.rows.length);

    const after = (await client.rpc("admin_export_data")).data as unknown as Backup;
    expect(counts(after)).toEqual(counts(before));
  });

  it("replace-imports its own JSON export: same data, sale costs untouched, data epoch bumped", async () => {
    const { client } = await signInAsDevAdmin();
    const before = (await client.rpc("admin_export_data")).data as unknown as Backup;
    const epochBefore = (await client.from("shop_status").select("data_epoch").eq("id", 1).single()).data!.data_epoch;

    const { error } = await client.rpc("admin_import_data", { p_payload: before as never, p_mode: "replace" });
    expect(error).toBeNull();

    const after = (await client.rpc("admin_export_data")).data as unknown as Backup;
    expect(counts(after)).toEqual(counts(before));
    const costs = (backup: Backup) =>
      Object.fromEntries(backup.tables.sale_items.rows.map((row) => [row.id as string, row.unit_cost ?? null]));
    expect(costs(after)).toEqual(costs(before));
    const epochAfter = (await client.from("shop_status").select("data_epoch").eq("id", 1).single()).data!.data_epoch;
    expect(epochAfter).toBe(epochBefore + 1);
  });

  it("rolls everything back on a broken file", async () => {
    const { client } = await signInAsDevAdmin();
    const before = (await client.rpc("admin_export_data")).data as unknown as Backup;
    const broken: Backup = {
      ...before,
      tables: { ...before.tables, products: { rows: [{ id: crypto.randomUUID(), name: "Orphan", price: 1, stock: 1, category_id: crypto.randomUUID() }] } },
    };
    const { error } = await client.rpc("admin_import_data", { p_payload: broken as never, p_mode: "replace" });
    expect(error).not.toBeNull(); // unknown category -> foreign key error
    const after = (await client.rpc("admin_export_data")).data as unknown as Backup;
    expect(counts(after)).toEqual(counts(before)); // nothing was deleted
  });
});
