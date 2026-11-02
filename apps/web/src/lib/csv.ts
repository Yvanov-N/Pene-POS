function csvField(value: string | number): string {
  const stringValue = String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

// Hands `content` to the browser as a file download.
export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Builds a CSV from rows and triggers a browser download -- shared by the
// dashboard report and the restock history export.
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\n");
  downloadFile(filename, csv, "text/csv;charset=utf-8;");
}
