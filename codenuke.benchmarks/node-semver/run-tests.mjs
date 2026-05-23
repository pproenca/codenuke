// Deterministic test gate for changecost on node-semver. Runs the full tap suite
// (no coverage enforcement) EXCEPT test/map.js — semver's 1:1 source/test meta-test,
// which would reject standalone accept tests. Auto-includes installed accept tests.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (/\.js$/.test(e.name) && p !== "test/map.js") out.push(p);
  }
  return out;
}

const files = walk("test");
const r = spawnSync("npx", ["tap", "--no-coverage", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
