/**
 * Measure (RULE-003/004/005) — the only thing that parses source. It computes the
 * three quantities the value/risk metric is built from (L, complexity, dupMass)
 * over a set of NON-TEST source files, via the TypeScript compiler API.
 *
 * Ported from the legacy `measure(files)` (which itself migrated `loop/measure.mjs`),
 * keeping ONLY the live quantities. The probe subsystem (RULE-016) and the dead
 * outputs (`any`/`cloneSites`/`dupRate`/`kappa`, RULE-017) are intentionally dropped.
 *
 * The measurement is PURE — `(files) ⇒ Measurement`, no IO, no Effect — so it can
 * be unit-tested directly and reused by the effectful shell (the runtime reads the
 * files; this just measures them). The `Measure` service is a thin DI seam over the
 * pure function for callers that prefer injection.
 *
 * @see docs/spec/BEHAVIOR_CONTRACT.md — RULE-003, RULE-004, RULE-005
 */
import { Context, Effect, Layer } from "effect";
import ts from "typescript";
import type { Measurement } from "../domain/index.ts";

/** Map of file name → source text. */
export type Files = Readonly<Record<string, string>>;

const CLONE_WINDOW = 12; // token-window size for clone detection (RULE-005)
const MIN_CONTENT = 5; // min distinct content tokens for a window to count (RULE-005)

const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u;
const TEST_RE = /\.(?:test|spec)\.[tj]sx?$/u;

/** RULE-033 — a file is a test file (excluded from measurement). */
export const isTestFile = (name: string): boolean =>
  TEST_RE.test(name) || name.includes("__tests__");

/** RULE-033 — a measurable source file: a source extension that is not a test. */
export const isSourceFile = (name: string): boolean =>
  SOURCE_RE.test(name) && !isTestFile(name);

const isJsxLike = (name: string): boolean => /\.(?:t|j)sx$/u.test(name);

const scriptKind = (name: string): ts.ScriptKind =>
  name.endsWith(".jsx")
    ? ts.ScriptKind.JSX
    : isJsxLike(name)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(name));

/** RULE-003 — L: total AST nodes (formatting/rename-invariant size). */
function astNodeCount(sf: ts.SourceFile): number {
  let n = 0;
  const walk = (node: ts.Node): void => {
    n += 1;
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return n;
}

/** RULE-004 — cyclomatic complexity: 1 + one per decision point. */
function complexity(sf: ts.SourceFile): number {
  let c = 1;
  const walk = (node: ts.Node): void => {
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
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          c += 1;
        }
        break;
      }
      default:
        break;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return c;
}

interface Token {
  readonly key: string;
  readonly content: boolean;
  readonly text: string;
}

/** Token stream for clone detection — import / re-export lines stripped (idiom, not logic). */
function tokenStream(name: string, text: string): Token[] {
  const langVariant = isJsxLike(name)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const stripped = text
    .split(/\r?\n/u)
    .filter(
      (line) =>
        !/^\s*import\b/u.test(line) && !/^\s*export\b[^;]*\bfrom\b/u.test(line),
    )
    .join("\n");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    langVariant,
    stripped,
  );
  const tokens: Token[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    const content =
      kind === ts.SyntaxKind.Identifier ||
      kind === ts.SyntaxKind.StringLiteral ||
      kind === ts.SyntaxKind.NumericLiteral ||
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === ts.SyntaxKind.JsxText;
    const txt = content ? scanner.getTokenText().trim() : "";
    tokens.push({ key: content ? `${kind}:${txt}` : String(kind), content, text: txt });
    kind = scanner.scan();
  }
  return tokens;
}

/**
 * RULE-005 — duplicate-window mass: slide a 12-token window over each non-test
 * file; a window counts only with ≥ 5 distinct content tokens; mass is the number
 * of copies of each repeated window beyond the first.
 */
function duplicateMass(files: Files): number {
  const counts = new Map<string, number>();
  for (const [name, text] of Object.entries(files)) {
    if (isTestFile(name)) continue;
    const tokens = tokenStream(name, text);
    for (let i = 0; i + CLONE_WINDOW <= tokens.length; i += 1) {
      const window = tokens.slice(i, i + CLONE_WINDOW);
      const distinctContent = new Set<string>();
      for (const token of window) {
        if (token.content) distinctContent.add(token.text);
      }
      if (distinctContent.size < MIN_CONTENT) continue;
      const key = JSON.stringify(window.map((token) => token.key));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let mass = 0;
  for (const count of counts.values()) {
    if (count >= 2) mass += count - 1;
  }
  return mass;
}

/**
 * RULE-003/004/005 — measure a set of source files: total AST nodes, summed
 * cyclomatic complexity, and duplicate-window mass, over NON-TEST files only.
 */
export const measureFiles = (files: Files): Measurement => {
  let L = 0;
  let comp = 0;
  for (const [name, text] of Object.entries(files)) {
    if (isTestFile(name)) continue;
    const sf = parse(name, text);
    L += astNodeCount(sf);
    comp += complexity(sf);
  }
  return { L, complexity: comp, dupMass: duplicateMass(files) };
};

/** Convenience: measure a single source string (defaults to a `.ts` filename). */
export const measureText = (text: string, fileName = "source.ts"): Measurement =>
  measureFiles({ [fileName]: text });

/**
 * Measure service — a thin DI seam over the pure `measureFiles`. Kept so callers
 * can inject a measurement strategy; the implementation is pure (no IO), which is
 * why `MeasureLive` needs no requirements.
 */
export class Measure extends Context.Tag("@codenuke/core/Measure")<
  Measure,
  {
    readonly measureFiles: (files: Files) => Effect.Effect<Measurement>;
  }
>() {}

export const MeasureLive: Layer.Layer<Measure> = Layer.succeed(
  Measure,
  Measure.of({
    measureFiles: (files) => Effect.succeed(measureFiles(files)),
  }),
);
