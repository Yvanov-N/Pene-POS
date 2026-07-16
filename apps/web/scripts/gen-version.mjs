import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = path.join(webRoot, "public/changelog.json");
const outPath = path.join(webRoot, "public/version.json");

const [latest] = JSON.parse(readFileSync(changelogPath, "utf-8"));
if (!latest) throw new Error(`changelog.json is empty at ${changelogPath}`);

let buildId = "unknown";
try {
  buildId = execSync("git rev-parse --short HEAD", { cwd: webRoot, encoding: "utf-8" }).trim();
} catch {
  // No git available (e.g. shallow CI checkout) — degrade gracefully.
}

writeFileSync(
  outPath,
  JSON.stringify(
    {
      version: latest.version,
      buildId,
      buildDate: new Date().toISOString(),
      changes: latest.changes,
    },
    null,
    2,
  ) + "\n",
);

console.log(`[gen-version] v${latest.version} (${buildId})`);
