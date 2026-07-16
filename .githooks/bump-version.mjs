import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

if (process.env.SKIP_VERSION_HOOK) process.exit(0); // defense in depth

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
const changelogPath = path.join(root, "apps/web/public/changelog.json");
const message = execSync("git log -1 --pretty=%B", { encoding: "utf-8" });
const header = message.split("\n")[0];

const conventional = /^(\w+)(\([^)]+\))?(!)?:\s*(.+)$/.exec(header);
const type = conventional?.[1] ?? "";
const breaking = Boolean(conventional?.[3]) || /BREAKING[ -]CHANGE:/.test(message);
// A breaking marker overrides "feat" -- feat! is MAJOR, not minor.
const bump = breaking ? "major" : type === "feat" ? "minor" : "patch";

const entries = JSON.parse(readFileSync(changelogPath, "utf-8"));
const [major, minor, patch] = entries[0].version.split(".").map(Number);
const nextVersion =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

const text = (conventional?.[4] ?? header).trim();
entries.unshift({ version: nextVersion, date: new Date().toISOString().slice(0, 10), changes: [text] });
writeFileSync(changelogPath, JSON.stringify(entries, null, 2) + "\n");

execSync("git add apps/web/public/changelog.json", { cwd: root });
execSync("git commit --amend --no-edit", { cwd: root, env: { ...process.env, SKIP_VERSION_HOOK: "1" } });
console.log(`[version-hook] bumped to v${nextVersion} (${bump})`);
