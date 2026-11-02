// Emergency backup files (Settings > Data backup): the JSON returned by the
// admin_export_data RPC (migration 00042), its portable SQL rendering, and
// reading either back for admin_import_data. Pure functions -- no I/O.

export const BACKUP_FORMAT = "pene-pos-backup";

export interface BackupColumn {
  name: string;
  // information_schema data_type, or "enum" for the app's own enum types.
  type: string;
  nullable: boolean;
  generated: boolean;
}

export type BackupRow = Record<string, unknown>;

export interface BackupTable {
  columns?: BackupColumn[];
  rows: BackupRow[];
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  tables: Record<string, BackupTable>;
}

// Same order the import applies them in: parents before children.
export const BACKUP_TABLE_ORDER = [
  "categories",
  "products",
  "student_wallets",
  "profiles",
  "shop_status",
  "suppliers",
  "supplier_products",
  "sales",
  "sale_items",
  "stock_purchases",
  "supplier_price_history",
] as const;

export type BackupFileErrorCode = "not-a-backup" | "bad-json" | "bad-sql";

export class BackupFileError extends Error {
  constructor(readonly code: BackupFileErrorCode) {
    super(code);
  }
}

function orderedTables(backup: Backup): string[] {
  const known = BACKUP_TABLE_ORDER.filter((name) => name in backup.tables);
  const extra = Object.keys(backup.tables).filter((name) => !(BACKUP_TABLE_ORDER as readonly string[]).includes(name));
  return [...known, ...extra];
}

export function summarizeBackup(backup: Backup): { table: string; rows: number }[] {
  return orderedTables(backup).map((table) => ({ table, rows: backup.tables[table].rows.length }));
}

// ---- JSON ------------------------------------------------------------------

export function backupToJson(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

function assertBackup(value: unknown): Backup {
  const candidate = value as Partial<Backup> | null;
  if (!candidate || candidate.format !== BACKUP_FORMAT || typeof candidate.tables !== "object" || candidate.tables === null) {
    throw new BackupFileError("not-a-backup");
  }
  for (const table of Object.values(candidate.tables)) {
    if (!table || !Array.isArray((table as BackupTable).rows)) throw new BackupFileError("not-a-backup");
  }
  return candidate as Backup;
}

// ---- portable SQL ----------------------------------------------------------
//
// Standard SQL meant to load with little or no editing into PostgreSQL,
// MySQL/MariaDB or SQLite: CREATE TABLE IF NOT EXISTS with common types, then
// batched multi-row INSERTs, inside one transaction. Timestamps are written
// in UTC as 'YYYY-MM-DD HH:MM:SS.mmm'. No foreign keys (load order already
// respects them); generated columns are plain columns holding their values.

const PORTABLE_TYPE: Record<string, string> = {
  uuid: "VARCHAR(36)",
  text: "TEXT",
  "character varying": "TEXT",
  numeric: "DECIMAL(18,4)",
  integer: "INTEGER",
  smallint: "INTEGER",
  bigint: "BIGINT",
  boolean: "BOOLEAN",
  "timestamp with time zone": "TIMESTAMP",
  "timestamp without time zone": "TIMESTAMP",
  date: "DATE",
  jsonb: "TEXT",
  json: "TEXT",
  enum: "VARCHAR(32)",
};

const INSERT_BATCH = 200;
const TIMESTAMP_TYPES = new Set(["timestamp with time zone", "timestamp without time zone"]);

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toSqlTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function sqlValue(value: unknown, type: string | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "object") return sqlString(JSON.stringify(value));
  const text = String(value);
  return sqlString(type && TIMESTAMP_TYPES.has(type) ? toSqlTimestamp(text) : text);
}

function columnsOf(table: BackupTable): BackupColumn[] {
  if (table.columns && table.columns.length > 0) return table.columns;
  // Hand-made file without column info: infer names from the rows.
  const names = new Set<string>();
  for (const row of table.rows) for (const key of Object.keys(row)) names.add(key);
  return [...names].map((name) => ({ name, type: "text", nullable: true, generated: false }));
}

export function backupToSql(backup: Backup): string {
  const out: string[] = [
    `-- ${BACKUP_FORMAT} v${backup.version}`,
    `-- exported_at: ${backup.exported_at}`,
    "-- Portable SQL (PostgreSQL, MySQL/MariaDB, SQLite). Timestamps are UTC.",
    "-- MySQL: run with sql_mode NO_BACKSLASH_ESCAPES so backslashes in text stay literal.",
    "",
    "BEGIN;",
    "",
  ];

  for (const name of orderedTables(backup)) {
    const table = backup.tables[name];
    const columns = columnsOf(table);
    if (columns.length === 0) continue;
    const hasId = columns.some((column) => column.name === "id");
    const definitions = columns.map(
      (column) =>
        `  ${column.name} ${PORTABLE_TYPE[column.type] ?? "TEXT"}${column.nullable || column.name === "id" ? "" : " NOT NULL"}`,
    );
    if (hasId) definitions.push("  PRIMARY KEY (id)");
    out.push(`CREATE TABLE IF NOT EXISTS ${name} (`, definitions.join(",\n"), ");", "");

    const columnList = columns.map((column) => column.name).join(", ");
    for (let start = 0; start < table.rows.length; start += INSERT_BATCH) {
      const batch = table.rows.slice(start, start + INSERT_BATCH);
      const tuples = batch.map(
        (row) => `  (${columns.map((column) => sqlValue(row[column.name], column.type)).join(", ")})`,
      );
      out.push(`INSERT INTO ${name} (${columnList}) VALUES`, `${tuples.join(",\n")};`, "");
    }
  }

  out.push("COMMIT;", "");
  return out.join("\n");
}

// Reads back an SQL file this app produced (or one following the same
// shape): only `INSERT INTO table (cols) VALUES (...), (...);` statements
// carry data; everything else (comments, CREATE TABLE, BEGIN/COMMIT) is
// skipped. Not a general SQL parser.
export function parseBackupSql(sql: string): Backup {
  const exportedAt = /--\s*exported_at:\s*(\S+)/.exec(sql)?.[1] ?? "";
  const version = Number(new RegExp(`--\\s*${BACKUP_FORMAT} v(\\d+)`).exec(sql)?.[1] ?? 1);
  const tables: Record<string, BackupTable> = {};
  const insert = /INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*VALUES\s*/gi;

  let match: RegExpExecArray | null;
  while ((match = insert.exec(sql)) !== null) {
    const table = match[1];
    const columns = match[2].split(",").map((column) => column.trim().replace(/^["`]|["`]$/g, ""));
    let i = insert.lastIndex;
    const rows: BackupRow[] = [];

    // Tuples until the terminating semicolon.
    while (i < sql.length) {
      while (/\s|,/.test(sql[i] ?? "")) i++;
      if (sql[i] === ";") {
        i++;
        break;
      }
      if (sql[i] !== "(") throw new BackupFileError("bad-sql");
      i++;
      const values: unknown[] = [];
      while (i < sql.length) {
        while (/\s/.test(sql[i])) i++;
        if (sql[i] === "'") {
          let text = "";
          i++;
          while (i < sql.length) {
            if (sql[i] === "'" && sql[i + 1] === "'") {
              text += "'";
              i += 2;
            } else if (sql[i] === "'") {
              i++;
              break;
            } else {
              text += sql[i++];
            }
          }
          values.push(text);
        } else {
          const token = /^[^,)\s]+/.exec(sql.slice(i))?.[0] ?? "";
          i += token.length;
          const upper = token.toUpperCase();
          if (upper === "NULL") values.push(null);
          else if (upper === "TRUE") values.push(true);
          else if (upper === "FALSE") values.push(false);
          else if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(token)) values.push(Number(token));
          else throw new BackupFileError("bad-sql");
        }
        while (/\s/.test(sql[i])) i++;
        if (sql[i] === ",") {
          i++;
          continue;
        }
        if (sql[i] === ")") {
          i++;
          break;
        }
        throw new BackupFileError("bad-sql");
      }
      if (values.length !== columns.length) throw new BackupFileError("bad-sql");
      rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    }

    insert.lastIndex = i;
    tables[table] = { rows: [...(tables[table]?.rows ?? []), ...rows] };
  }

  if (Object.keys(tables).length === 0) throw new BackupFileError("not-a-backup");
  return { format: BACKUP_FORMAT, version, exported_at: exportedAt, tables };
}

export function parseBackupFile(fileName: string, text: string): Backup {
  const trimmed = text.trimStart();
  if (fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BackupFileError("bad-json");
    }
    return assertBackup(parsed);
  }
  return parseBackupSql(text);
}
