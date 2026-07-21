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

// Production deploys (.github/workflows/deploy-production.yml) are triggered
// by pushing a vX.Y.Z tag, and that tag IS the release version -- prefer an
// exact release tag at the commit being built over changelog.json's own
// auto-bumped version field, which just tracks the running list of
// unreleased changes and can be ahead of whatever was last actually tagged.
// Falls back to changelog.json for local/dev builds, which are never built
// from a release tag.
let version = latest.version;
try {
  const tags = execSync("git tag --points-at HEAD", { cwd: webRoot, encoding: "utf-8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const releaseTag = tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (releaseTag) version = releaseTag.slice(1);
} catch {
  // No git / no tags reachable — fall back to changelog.json above.
}

writeFileSync(
  outPath,
  JSON.stringify(
    {
      version,
      buildId,
      buildDate: new Date().toISOString(),
      changes: latest.changes,
    },
    null,
    2,
  ) + "\n",
);

console.log(`[gen-version] v${version} (${buildId})`);
