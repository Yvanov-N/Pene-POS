import { describe, expect, it } from "vitest";
import { backupToSql, BackupFileError, parseBackupFile, parseBackupSql, summarizeBackup, type Backup } from "../backup";

const backup: Backup = {
  format: "pene-pos-backup",
  version: 1,
  exported_at: "2026-11-02T15:00:00.000Z",
  tables: {
    sales: {
      columns: [
        { name: "id", type: "uuid", nullable: false, generated: false },
        { name: "total_amount", type: "numeric", nullable: false, generated: false },
        { name: "created_at", type: "timestamp with time zone", nullable: false, generated: false },
        { name: "payment_method", type: "enum", nullable: false, generated: false },
        { name: "student_id", type: "uuid", nullable: true, generated: false },
      ],
      rows: [
        { id: "s-1", total_amount: 37.5, created_at: "2026-11-02T10:15:30.250+00:00", payment_method: "cash", student_id: null },
      ],
    },
    products: {
      columns: [
        { name: "id", type: "uuid", nullable: false, generated: false },
        { name: "name", type: "text", nullable: false, generated: false },
        { name: "stock", type: "integer", nullable: false, generated: false },
        { name: "is_promo", type: "boolean", nullable: true, generated: false },
      ],
      rows: [
        { id: "p-1", name: "L'eau, \"minérale\"", stock: -3, is_promo: true },
        { id: "p-2", name: "Pain (12)", stock: 0, is_promo: false },
      ],
    },
  },
};

describe("backup SQL", () => {
  const sql = backupToSql(backup);

  it("writes portable DDL and inserts, parents first, in one transaction", () => {
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS products (");
    expect(sql).toContain("  id VARCHAR(36)");
    expect(sql).toContain("  total_amount DECIMAL(18,4) NOT NULL");
    expect(sql).toContain("  created_at TIMESTAMP NOT NULL");
    expect(sql).toContain("PRIMARY KEY (id)");
    expect(sql.indexOf("INSERT INTO products")).toBeLessThan(sql.indexOf("INSERT INTO sales"));
    expect(sql).toContain("'L''eau, \"minérale\"'");
    expect(sql).toContain("'2026-11-02 10:15:30.250'");
  });

  it("reads its own SQL back", () => {
    const parsed = parseBackupSql(sql);
    expect(parsed.exported_at).toBe("2026-11-02T15:00:00.000Z");
    expect(parsed.tables.products.rows).toEqual(backup.tables.products.rows);
    expect(parsed.tables.sales.rows).toEqual([
      { id: "s-1", total_amount: 37.5, created_at: "2026-11-02 10:15:30.250", payment_method: "cash", student_id: null },
    ]);
  });

  it("summarizes tables in import order", () => {
    expect(summarizeBackup(backup)).toEqual([
      { table: "products", rows: 2 },
      { table: "sales", rows: 1 },
    ]);
  });
});

describe("parseBackupFile", () => {
  it("accepts this app's JSON", () => {
    expect(parseBackupFile("x.json", JSON.stringify(backup)).tables.products.rows).toHaveLength(2);
  });

  it("rejects anything else", () => {
    expect(() => parseBackupFile("x.json", "{oops")).toThrow(BackupFileError);
    expect(() => parseBackupFile("x.json", JSON.stringify({ hello: 1 }))).toThrow(BackupFileError);
    expect(() => parseBackupFile("x.sql", "SELECT 1;")).toThrow(BackupFileError);
    expect(() => parseBackupFile("x.sql", "INSERT INTO t (a, b) VALUES (1);")).toThrow(BackupFileError);
  });
});
