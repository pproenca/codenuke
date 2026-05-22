// Are cluster co-changes BATCH CREATION (artifact) or REAL MAINTENANCE (tax)?
// Prints, for a cluster, the commits that touched >=2 cluster files, with subjects.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const isSource = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p);

function episodes(repo, srcPrefix, inCluster, label) {
  const raw = execSync(
    `git -C ${repo} log --no-merges --name-only --pretty=format:%x01%H%x02%s -n 100000`,
    { maxBuffer: 1 << 30 },
  ).toString();
  const rows = [];
  for (const block of raw.split("\x01").slice(1)) {
    const nl = block.indexOf("\n");
    const head = block.slice(0, nl);
    const [, subject] = head.split("\x02");
    const files = [
      ...new Set(
        block.slice(nl + 1).split("\n").map((s) => s.trim())
          .filter((p) => p.startsWith(srcPrefix)).map((p) => p.slice(srcPrefix.length))
          .filter(isSource).filter(inCluster),
      ),
    ];
    if (files.length >= 2) rows.push({ subject, n: files.length });
  }
  console.log(`\n=== ${label}: ${rows.length} commits touched >=2 cluster files ===`);
  for (const r of rows.slice(0, 18)) console.log(`  ${String(r.n).padStart(2)} files  ${r.subject.slice(0, 70)}`);
  const creationish = rows.filter((r) => /add|new|init|import|provider|support|introduc|create/i.test(r.subject)).length;
  console.log(`  -> ${creationish}/${rows.length} look like additions/creation; ${rows.length - creationish} look like maintenance`);
}

const ocDir = join(OPENCODE_REPO, "packages/core/src");
const plug = new Set();
(function walk(d) {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (isSource(p) && readFileSync(p, "utf8").includes("PluginV2.define")) plug.add(relative(ocDir, p));
  }
})(ocDir);
episodes(OPENCODE_REPO, "packages/core/src/", (f) => plug.has(f), `opencode PluginV2 (${plug.size} files)`);

const mappers = (f) => f.startsWith("mappers/");
episodes(CODENUKE_REPO, "src/", mappers, "codenuke mappers/");
