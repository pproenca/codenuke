#!/usr/bin/env node
// Repeatable proxy↔𝒱̂ validation across a list of substrates.
//
//   node evals/scripts/validate-substrates.mjs [config=evals/substrates.json] [substrate-name]
//
// For each substrate in the config, for each candidate code-state (a git ref): compute the
// inner-loop value PROXY (calibrated reduction vs the baseline) and the held-out change-cost
// 𝒱̂ (loop/changecost.mjs against the substrate's codenuke.benchmark). Then report, per
// substrate, the discrimination table and — when ≥3 candidates have a measured 𝒱̂ —
// validate-proxy (Spearman ρ + permutation p). This is the experiment from the semver /
// codecharter sessions made one-command and repeatable from a codebase list.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measure } from "../../loop/measure.mjs";
import { isSourceFile } from "../../loop/config.mjs";
import { validateValueProxy } from "../../loop/value-proxy.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CHANGECOST = `${repoRoot}/loop/changecost.mjs`;
const DEFAULTS = { dL: 1.0, dCx: 1.8, dDup: 0.35, sL: 150, sCx: 15, sDup: 5 };

const argv = process.argv.slice(2);
const configPath = resolve(
  argv.find((a) => a.endsWith(".json")) || `${repoRoot}/evals/substrates.json`,
);
const only = argv.find((a) => !a.endsWith(".json"));
const config = JSON.parse(readFileSync(configPath, "utf8"));

const git = (repo, args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });

function srcMapAt(repo, ref, srcDir) {
  const spec = srcDir === "." ? "." : srcDir;
  const files = git(repo, ["ls-tree", "-r", "--name-only", ref, "--", spec])
    .split("\n")
    .map((s) => s.trim())
    .filter(isSourceFile);
  const map = {};
  for (const f of files) {
    try {
      map[f] = git(repo, ["show", `${ref}:${f}`]);
    } catch {}
  }
  return map;
}

function scalesFor(repo) {
  const p = `${repo}/.codenuke/calibration.json`;
  if (existsSync(p)) {
    try {
      const s = JSON.parse(readFileSync(p, "utf8")).scales;
      if (s) return { ...DEFAULTS, sL: s.sL, sCx: s.sCx, sDup: s.sDup };
    } catch {}
  }
  return DEFAULTS;
}

function changecost(sub, ref) {
  const env = {
    ...process.env,
    CN_REPO: sub.repoAbs,
    CN_SRC: sub.srcDir,
    CN_TEST: sub.testCommand.replaceAll("{repo}", sub.repoAbs),
    CN_TYPECHECK: "",
    CN_BENCH: `${sub.repoAbs}/${sub.benchmark}`,
    CN_TAG: `validate-${sub.name}`,
  };
  if (sub.implementer) env.CN_IMPLEMENTER = sub.implementer.replaceAll("{repo}", sub.repoAbs);
  try {
    execSync(`node ${CHANGECOST} ${ref}`, {
      env,
      stdio: ["ignore", "ignore", "ignore"],
      maxBuffer: 1 << 30,
    });
  } catch {}
  return JSON.parse(readFileSync(`${sub.repoAbs}/.codenuke/changecost.json`, "utf8"));
}

const substrates = config.substrates.filter((s) => !only || s.name === only);
if (substrates.length === 0) {
  console.error(`no substrate named "${only}" in ${configPath}`);
  process.exit(1);
}

for (const sub of substrates) {
  sub.repoAbs = resolve(dirname(configPath), sub.repo);
  const w = scalesFor(sub.repoAbs);
  const base = measure(srcMapAt(sub.repoAbs, sub.baseline, sub.srcDir));
  const proxyOf = (m) =>
    w.dL * ((base.L - m.L) / w.sL) +
    w.dCx * ((base.complexity - m.complexity) / w.sCx) +
    w.dDup * ((base.dupMass - m.dupMass) / w.sDup);

  console.log(
    `\n=== ${sub.name} — ${sub.candidates.length} candidates, implementer=${sub.implementer ? "scripted" : "codex"} ===`,
  );
  const rows = [];
  for (const ref of sub.candidates) {
    const proxy = proxyOf(measure(srcMapAt(sub.repoAbs, ref, sub.srcDir)));
    const cc = changecost(sub, ref);
    rows.push({ id: ref.slice(0, 7), proxy: Number(proxy.toFixed(4)), Vhat: cc.Vhat });
    console.log(
      `  ${ref.slice(0, 7)}  proxy=${proxy.toFixed(3).padStart(7)}  𝒱̂=${String(cc.Vhat).padStart(6)}  (${cc.done}/${cc.total} δ done)`,
    );
  }

  const valid = rows.filter((r) => typeof r.Vhat === "number");
  if (valid.length >= 3) {
    const report = validateValueProxy(valid);
    console.log(
      `  → validate-proxy: ${report.passed ? "PASS" : "FAIL"} (${report.reason || "ok"})  ρ=${report.rho == null ? "n/a" : report.rho.toFixed(3)}  p=${report.pValue == null ? "n/a" : report.pValue.toFixed(3)}  n=${valid.length}`,
    );
  } else if (valid.length === 2) {
    const [a, b] = valid.toSorted((x, y) => x.proxy - y.proxy);
    const dir =
      b.Vhat < a.Vhat
        ? "reduction LOWERS 𝒱̂ → safe ✓"
        : b.Vhat > a.Vhat
          ? "reduction RAISES 𝒱̂ → unsafe ✗ (metric declines it)"
          : "flat (change-irrelevant)";
    console.log(
      `  → discrimination (n=2): more-reduced ${b.id} 𝒱̂=${b.Vhat} vs ${a.id} 𝒱̂=${a.Vhat} ⇒ ${dir}`,
    );
  } else {
    console.log(`  → need ≥2 candidates with a measured 𝒱̂`);
  }
}
