import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, DatabaseBackup, FileJson, FileCode, FileUp, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { downloadFile } from "@/lib/csv";
import {
  backupToJson,
  backupToSql,
  BackupFileError,
  parseBackupFile,
  summarizeBackup,
  type Backup,
} from "@/lib/backup";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";

type ImportMode = "merge" | "replace";

interface ImportResult {
  mode: ImportMode;
  counts: Record<string, number>;
  remapped_cashiers: number;
}

// Typed by the admin to unlock "replace all" -- a deliberate second step on
// top of the admin PIN, since that mode deletes data for good.
const REPLACE_CONFIRM_WORD: Record<string, string> = { fr: "REMPLACER", en: "REPLACE" };

function timestampForFile(): string {
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
}

// Emergency export/import of the whole business dataset (migration 00042):
// JSON (this app's own format, also what a restore reads best) or portable
// SQL for loading into another database engine.
export function DataBackupCard() {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const { isOnline, triggerManualSync } = useSyncEngine();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState<"json" | "sql" | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirmText, setConfirmText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const confirmWord = REPLACE_CONFIRM_WORD[i18n.language] ?? REPLACE_CONFIRM_WORD.fr;
  const tableLabel = (table: string) => t(`admin.backup.tables.${table}`, { defaultValue: table });

  const handleExport = async (format: "json" | "sql") => {
    setExporting(format);
    try {
      const { data, error } = await supabase.rpc("admin_export_data");
      if (error) throw error;
      const exported = data as unknown as Backup;
      const total = summarizeBackup(exported).reduce((sum, entry) => sum + entry.rows, 0);
      const base = `pene-pos-sauvegarde-${timestampForFile()}`;
      if (format === "json") downloadFile(`${base}.json`, backupToJson(exported), "application/json");
      else downloadFile(`${base}.sql`, backupToSql(exported), "application/sql");
      showToast("success", t("admin.backup.exportDone", { count: total }));
    } catch (error) {
      console.warn("[DataBackupCard] export failed", error);
      showToast("error", t("admin.backup.exportFailed"));
    } finally {
      setExporting(null);
    }
  };

  const handleFile = async (file: File | undefined) => {
    setBackup(null);
    setResult(null);
    setFileError(null);
    setConfirmText("");
    if (!file) return;
    setFileName(file.name);
    try {
      setBackup(parseBackupFile(file.name, await file.text()));
    } catch (error) {
      setFileError(
        error instanceof BackupFileError ? t(`admin.backup.fileErrors.${error.code}`) : t("admin.backup.fileErrors.not-a-backup"),
      );
    }
  };

  const handleImport = async () => {
    if (!backup) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.rpc("admin_import_data", { p_payload: backup as never, p_mode: mode });
      if (error) {
        showToast("error", t("admin.backup.importFailed", { reason: error.message }), 10000);
        return;
      }
      setResult(data as unknown as ImportResult);
      showToast("success", t("admin.backup.importDone"));
      // Pull the imported rows into this device; after a replace the data
      // epoch makes it rebuild its local copy first (services/sync/pull.ts).
      void triggerManualSync();
    } finally {
      setImporting(false);
    }
  };

  const summary = backup ? summarizeBackup(backup) : [];
  const total = summary.reduce((sum, entry) => sum + entry.rows, 0);
  const replaceConfirmed = mode === "merge" || confirmText.trim().toUpperCase() === confirmWord;

  return (
    <CardCustom
      title={
        <span className="inline-flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5" aria-hidden />
          {t("admin.backup.title")}
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">{t("admin.backup.intro")}</p>
        {!isOnline && <p className="text-sm font-medium text-warning">{t("admin.backup.offline")}</p>}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">{t("admin.backup.exportTitle")}</h3>
          <p className="text-xs text-muted">{t("admin.backup.exportHint")}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonCustom
              variant="primary"
              size="sm"
              disabled={!isOnline || exporting !== null}
              isLoading={exporting === "json"}
              requiresAdminPin
              pinModalTitle={t("admin.backup.exportPinTitle")}
              onClick={() => void handleExport("json")}
            >
              <FileJson aria-hidden />
              {t("admin.backup.exportJson")}
            </ButtonCustom>
            <ButtonCustom
              variant="primary"
              size="sm"
              disabled={!isOnline || exporting !== null}
              isLoading={exporting === "sql"}
              requiresAdminPin
              pinModalTitle={t("admin.backup.exportPinTitle")}
              onClick={() => void handleExport("sql")}
            >
              <FileCode aria-hidden />
              {t("admin.backup.exportSql")}
            </ButtonCustom>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">{t("admin.backup.importTitle")}</h3>
          <p className="text-xs text-muted">{t("admin.backup.importHint")}</p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.sql,application/json,application/sql,text/plain"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent"
            >
              <FileUp className="h-4 w-4 shrink-0" aria-hidden />
              {fileName ?? t("admin.backup.chooseFile")}
            </button>
          </div>
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}

          {backup && (
            <>
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="mb-2 text-xs text-muted">
                  {backup.exported_at
                    ? t("admin.backup.fileDate", { date: new Date(backup.exported_at).toLocaleString() })
                    : t("admin.backup.fileDateUnknown")}
                </p>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {summary.map((entry) => (
                    <li key={entry.table} className="flex justify-between gap-3">
                      <span className="text-muted">{tableLabel(entry.table)}</span>
                      <span className="font-medium text-foreground">{entry.rows}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-border pt-2 text-right text-xs text-muted">
                  {t("admin.backup.totalRows", { count: total })}
                </p>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-muted">{t("admin.backup.modeLabel")}</legend>
                {(["merge", "replace"] as const).map((option) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${
                      mode === option
                        ? option === "replace"
                          ? "border-destructive bg-destructive/5"
                          : "border-accent bg-surface2"
                        : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="import-mode"
                      value={option}
                      checked={mode === option}
                      onChange={() => {
                        setMode(option);
                        setConfirmText("");
                      }}
                      className="mt-0.5"
                    />
                    <span>
                      <span className={`font-medium ${option === "replace" ? "text-destructive" : "text-foreground"}`}>
                        {t(`admin.backup.modes.${option}.title`)}
                      </span>
                      <span className="block text-xs text-muted">{t(`admin.backup.modes.${option}.description`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {mode === "replace" && (
                <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <p className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {t("admin.backup.replaceWarning")}
                  </p>
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("admin.backup.replaceConfirmLabel", { word: confirmWord })}
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      autoComplete="off"
                      className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-destructive"
                    />
                  </label>
                </div>
              )}

              <div>
                <ButtonCustom
                  variant={mode === "replace" ? "danger" : "primary"}
                  size="sm"
                  disabled={!isOnline || !replaceConfirmed || importing}
                  isLoading={importing}
                  requiresAdminPin
                  pinModalTitle={t("admin.backup.importPinTitle")}
                  onClick={() => void handleImport()}
                >
                  <Upload aria-hidden />
                  {mode === "replace" ? t("admin.backup.importReplace") : t("admin.backup.importMerge")}
                </ButtonCustom>
              </div>
            </>
          )}

          {result && (
            <div className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
              <p className="mb-1 font-medium text-success">{t("admin.backup.resultTitle")}</p>
              <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {Object.entries(result.counts).map(([table, count]) => (
                  <li key={table} className="flex justify-between gap-3 text-xs">
                    <span className="text-muted">{tableLabel(table)}</span>
                    <span className="text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
              {result.remapped_cashiers > 0 && (
                <p className="mt-2 text-xs text-muted">
                  {t("admin.backup.remappedCashiers", { count: result.remapped_cashiers })}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </CardCustom>
  );
}
