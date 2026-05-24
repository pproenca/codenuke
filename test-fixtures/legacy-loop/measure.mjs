// Measurement + behavior fence + scoring for the refactoring loss metric.
// Implements the inner-loop quantities from METRIC.md §1-§2.
// Only dependency: the `typescript` already installed in this repo.

import ts from "typescript";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLONE_WINDOW = 12; // token-window size for clone detection
const MIN_CONTENT = 5; // min distinct content tokens (idents+literals) for a window to count
// -> filters idiomatic boilerplate / pure control-flow (specificity)

const isTest = (name) => /\.(test|spec)\.[tj]sx?$/.test(name) || name.includes("__tests__");
const isTsx = (name) => name.endsWith(".tsx");
const scriptKind = (name) => (isTsx(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function parse(name, text) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(name));
}

// ---- L: AST node count (formatting- and rename-invariant) ----
function astNodeCount(sf) {
  let n = 0;
  const walk = (node) => {
    n += 1;
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return n;
}

// ---- cyclomatic complexity (module-level sum) ----
function complexity(sf) {
  let c = 1;
  const walk = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
        c += 1;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const op = node.operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          c += 1;
        }
        break;
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return c;
}

// ---- any-count (for G3 "no new any") ----
function anyCount(sf) {
  let n = 0;
  const walk = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) n += 1;
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return n;
}

// ---- token stream for clone detection (import lines stripped; content flagged) ----
function tokenStream(name, text) {
  const variant = isTsx(name) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  // Strip import / re-export-from lines: idiom, not logic duplication.
  const stripped = text
    .split(/\r?\n/u)
    .filter((l) => !/^\s*import\b/u.test(l) && !/^\s*export\b[^;]*\bfrom\b/u.test(l))
    .join("\n");
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, variant, stripped);
  const toks = [];
  let k = scanner.scan();
  while (k !== ts.SyntaxKind.EndOfFileToken) {
    const content =
      k === ts.SyntaxKind.Identifier ||
      k === ts.SyntaxKind.StringLiteral ||
      k === ts.SyntaxKind.NumericLiteral ||
      k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      k === ts.SyntaxKind.JsxText;
    const txt = content ? scanner.getTokenText().trim() : "";
    toks.push({ key: content ? `${k}:${txt}` : String(k), content, text: txt });
    k = scanner.scan();
  }
  return toks;
}

// ---- Dup: clone mass + dominant clone-site count across files ----
function cloneStats(files) {
  const counts = new Map();
  for (const [name, text] of Object.entries(files)) {
    if (isTest(name)) continue;
    const toks = tokenStream(name, text);
    for (let i = 0; i + CLONE_WINDOW <= toks.length; i += 1) {
      const win = toks.slice(i, i + CLONE_WINDOW);
      const distinctContent = new Set();
      for (const t of win) if (t.content) distinctContent.add(t.text);
      if (distinctContent.size < MIN_CONTENT) continue;
      const key = win.map((t) => t.key).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let mass = 0; // redundant windows (copies beyond the first)
  let sites = 1; // occurrences of the most-repeated window
  let total = 0; // total windows seen (for a size-independent rate)
  for (const c of counts.values()) {
    total += c;
    if (c >= 2) {
      mass += c - 1;
      if (c > sites) sites = c;
    }
  }
  return { mass, sites, total };
}

// ---- coupling: import-graph fan-in * fan-out (reported, not in gain; see notes) ----
function coupling(files) {
  const localBase = (spec, fromName) => {
    if (!spec.startsWith(".")) return null;
    const cleaned = spec.replace(/\.[tj]sx?$/, "").replace(/^\.\//, "");
    return cleaned;
  };
  const base = (name) => name.replace(/\.[tj]sx?$/, "");
  const modules = Object.keys(files)
    .filter((n) => !isTest(n))
    .map(base);
  const fanout = new Map(modules.map((m) => [m, 0]));
  const fanin = new Map(modules.map((m) => [m, 0]));
  for (const [name, text] of Object.entries(files)) {
    if (isTest(name)) continue;
    const sf = parse(name, text);
    const from = base(name);
    const walk = (node) => {
      let spec = null;
      if (ts.isImportDeclaration(node) && node.moduleSpecifier) spec = node.moduleSpecifier;
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        const target = localBase(spec.text, name);
        if (target !== null && fanin.has(target)) {
          fanout.set(from, (fanout.get(from) ?? 0) + 1);
          fanin.set(target, (fanin.get(target) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sf, walk);
  }
  let k = 0;
  for (const m of modules) k += (fanin.get(m) ?? 0) * (fanout.get(m) ?? 0);
  return k;
}

export function measure(files) {
  let L = 0;
  let comp = 0;
  let anys = 0;
  for (const [name, text] of Object.entries(files)) {
    if (isTest(name)) continue;
    const sf = parse(name, text);
    L += astNodeCount(sf);
    comp += complexity(sf);
    anys += anyCount(sf);
  }
  const { mass, sites, total } = cloneStats(files);
  return {
    L,
    complexity: comp,
    any: anys,
    dupMass: mass,
    cloneSites: sites,
    dupWindows: total,
    dupRate: total > 0 ? mass / total : 0,
    kappa: coupling(files),
  };
}

// Ambient shim so the in-memory program can type-check JSX compiled with
// jsxFactory "h" without pulling in React types. Added only for type checking;
// excluded from size/behavior measurement.
const JSX_SHIM = {
  "__jsxshim__.d.ts": `declare const h: (type: any, props: any, ...children: any[]) => any;
declare namespace JSX { interface IntrinsicElements { [elem: string]: any } type Element = any; }
`,
};

// ---- G3: in-memory type check (best effort) ----
export function typeErrors(files) {
  const hasJsx = Object.keys(files).some((n) => n.endsWith(".tsx"));
  const checkFiles = hasJsx ? { ...files, ...JSX_SHIM } : files;
  const options = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.React,
    jsxFactory: "h",
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
  };
  try {
    const host = ts.createCompilerHost(options);
    const map = new Map(Object.entries(checkFiles));
    const og = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, lang, onErr) => {
      const local = [...map.keys()].find((k) => fileName === k || fileName.endsWith("/" + k));
      if (local)
        return ts.createSourceFile(fileName, map.get(local), lang, true, scriptKind(local));
      return og(fileName, lang, onErr);
    };
    const ogExists = host.fileExists.bind(host);
    host.fileExists = (f) =>
      [...map.keys()].some((k) => f === k || f.endsWith("/" + k)) || ogExists(f);
    const ogRead = host.readFile.bind(host);
    host.readFile = (f) => {
      const local = [...map.keys()].find((k) => f === k || f.endsWith("/" + k));
      return local ? map.get(local) : ogRead(f);
    };
    const program = ts.createProgram([...map.keys()], options, host);
    const diags = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.category === ts.DiagnosticCategory.Error);
    return { ok: true, errors: diags.length };
  } catch (e) {
    return { ok: false, errors: 0, note: String(e && e.message) };
  }
}

// ---- behavior fence: transpile -> temp -> import -> run probes ----
const H_PREAMBLE = "const h=(t,p,...c)=>({__node:true,t,p:p||{},c:c.flat(Infinity)});\n";

function rewriteSpecifiers(js) {
  return js.replace(/((?:import|export)[^;\n]*?\bfrom\s*['"])(\.[^'"]+)(['"])/g, (m, a, spec, z) =>
    /\.[tj]sx?$|\.mjs$/.test(spec) ? m : `${a}${spec}.mjs${z}`,
  );
}

function transpileToTemp(files) {
  const dir = mkdtempSync(join(tmpdir(), "metric-"));
  for (const [name, src] of Object.entries(files)) {
    if (isTest(name)) continue;
    const tsx = isTsx(name);
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: tsx ? ts.JsxEmit.React : undefined,
        jsxFactory: "h",
      },
      fileName: name,
    }).outputText;
    const body = (tsx ? H_PREAMBLE : "") + rewriteSpecifiers(out);
    writeFileSync(join(dir, name.replace(/\.[tj]sx?$/, ".mjs")), body);
  }
  return dir;
}

// Execute function components into a normal-form tree (dependency-free renderer).
function render(n) {
  if (n == null || typeof n !== "object" || !n.__node) return n;
  if (typeof n.t === "function") {
    const props = { ...n.p, children: n.c };
    return render(n.t(props));
  }
  return { t: String(n.t), p: n.p, c: (n.c || []).map(render) };
}

export async function runProbes(files, entry, probe) {
  const dir = transpileToTemp(files);
  try {
    const mod = await import(pathToFileURL(join(dir, entry.replace(/\.[tj]sx?$/, ".mjs"))).href);
    const outputs = [];
    for (const { fn, args } of probe) {
      const f = mod[fn];
      if (typeof f !== "function") {
        outputs.push({ error: `missing export ${fn}` });
        continue;
      }
      const raw = f(...args);
      outputs.push(JSON.stringify(render(raw)));
    }
    return outputs;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- diff size (line-multiset symmetric difference; cheap size proxy) ----
function lineBag(files) {
  const bag = new Map();
  for (const [name, text] of Object.entries(files)) {
    if (isTest(name)) continue;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      bag.set(t, (bag.get(t) ?? 0) + 1);
    }
  }
  return bag;
}
function diffSize(before, after) {
  const a = lineBag(before);
  const b = lineBag(after);
  let d = 0;
  for (const [k, v] of a) d += Math.max(0, v - (b.get(k) ?? 0));
  for (const [k, v] of b) d += Math.max(0, v - (a.get(k) ?? 0));
  return d;
}

// ---- score one control ----
export async function scoreControl(control) {
  const mb = measure(control.before);
  const ma = measure(control.after);
  const tb = typeErrors(control.before);
  const ta = typeErrors(control.after);

  let behaviorPreserved = null;
  let behaviorNote = "";
  try {
    const ob = await runProbes(control.before, control.entry, control.probe);
    const oa = await runProbes(control.after, control.entry, control.probe);
    behaviorPreserved = JSON.stringify(ob) === JSON.stringify(oa);
    if (!behaviorPreserved) {
      const diffs = ob
        .map((v, i) => (v === oa[i] ? null : `probe#${i}: ${v} -> ${oa[i]}`))
        .filter(Boolean);
      behaviorNote = diffs.join("; ");
    }
  } catch (e) {
    behaviorPreserved = false;
    behaviorNote = `probe error: ${String(e && e.message)}`;
  }

  const dL = mb.L - ma.L; // >0 means smaller after
  const dX = mb.cloneSites - ma.cloneSites; // >0 means fewer clone sites
  const dDup = mb.dupMass - ma.dupMass;
  const dComplexity = ma.complexity - mb.complexity; // >0 means more complex after (risk)
  const newAny = ma.any > mb.any;
  const dsize = diffSize(control.before, control.after);

  // Gates (METRIC.md §1.3). G2 (coverage) stubbed for the separation check.
  const G1 = behaviorPreserved === true; // behavior invariance
  const G3 = ta.errors === 0 && !newAny; // type soundness + no new any
  const G4 = dL > 0; // size monotonicity at completion
  const admissible = G1 && G3 && G4;

  // Value / risk (weights are illustrative for separation; fitted later, §4.4).
  const gain = dL + 3 * dX + 0.5 * dDup;
  const risk = 0.1 * dsize + Math.max(0, dComplexity);
  const loss = admissible ? risk - gain : Infinity;

  return {
    name: control.name,
    kind: control.kind,
    before: mb,
    after: ma,
    dL,
    dX,
    dDup,
    dComplexity,
    typeErrorsAfter: ta.errors,
    typeCheckOk: ta.ok,
    newAny,
    diffSize: dsize,
    G1,
    G3,
    G4,
    admissible,
    behaviorNote,
    gain,
    risk,
    loss,
  };
}
