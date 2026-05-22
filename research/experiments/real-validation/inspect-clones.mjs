// Show WHAT is duplicated in each codebase, to judge harmful vs benign duplication.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const W = 12, MIN_CONTENT = 5;
const isSource = (n) => /\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n) && !/\.(test|spec)\./.test(n);

function collect(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === "dist" || e === ".git") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (isSource(e)) out.push([relative(dir, p), readFileSync(p, "utf8")]);
    }
  };
  walk(dir);
  return out;
}

function topClones(dir, n = 6) {
  const map = new Map();
  for (const [name, text] of collect(dir)) {
    const stripped = text
      .split(/\r?\n/u)
      .filter((l) => !/^\s*import\b/u.test(l) && !/^\s*export\b[^;]*\bfrom\b/u.test(l))
      .join("\n");
    const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, stripped);
    const toks = [];
    let k = sc.scan();
    while (k !== ts.SyntaxKind.EndOfFileToken) {
      const content =
        k === ts.SyntaxKind.Identifier || k === ts.SyntaxKind.StringLiteral ||
        k === ts.SyntaxKind.NumericLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral;
      const txt = content ? sc.getTokenText().trim() : "";
      toks.push({ key: content ? `${k}:${txt}` : String(k), content, start: sc.getTokenStart(), end: sc.getTextPos() });
      k = sc.scan();
    }
    for (let i = 0; i + W <= toks.length; i += 1) {
      const win = toks.slice(i, i + W);
      const distinct = new Set();
      for (const t of win) if (t.content) distinct.add(t.key);
      if (distinct.size < MIN_CONTENT) continue;
      const key = win.map((t) => t.key).join("");
      const snippet = stripped.slice(win[0].start, win[W - 1].end).replace(/\s+/g, " ").trim().slice(0, 90);
      const rec = map.get(key) ?? { count: 0, files: new Set(), snippet };
      rec.count += 1;
      rec.files.add(name);
      map.set(key, rec);
    }
  }
  return [...map.values()]
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

for (const [label, dir] of [
  ["GOOD opencode/core/src", join(OPENCODE_REPO, "packages/core/src")],
  ["BAD  codenuke/src", join(CODENUKE_REPO, "src")],
]) {
  console.log(`\n### ${label} — top repeated 12-token windows\n`);
  for (const r of topClones(dir)) {
    console.log(`  x${r.count}  (${r.files.size} files)  ${r.snippet}`);
  }
}
