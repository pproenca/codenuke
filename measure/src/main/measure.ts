/**
 * Source measurement for codenuke's value metric. Migrated from
 * `legacy/codenuke/loop/measure.mjs` — keeping ONLY the three quantities the live
 * scorer/calibration consume (L, complexity, dupMass). The legacy file's probe
 * subsystem (`runProbes`/`scoreControl`/transpile, RULE-016) and unused outputs
 * (`any`/`cloneSites`/`dupRate`/`kappa`, RULE-017) are intentionally dropped.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-003, RULE-004, RULE-005
 */
import ts from "typescript";

/** The measured quantities the value/risk metric is built from. */
export interface Measurement {
  /** Total AST node count over non-test files — formatting/rename-invariant size (RULE-003). */
  readonly L: number;
  /** Summed cyclomatic complexity (RULE-004). */
  readonly complexity: number;
  /** Duplicate-window mass: copies of a repeated token window beyond the first (RULE-005). */
  readonly dupMass: number;
}

/** Map of file name → source text. */
export type Files = Readonly<Record<string, string>>;

const CLONE_WINDOW = 12; // token-window size for clone detection
const MIN_CONTENT = 5; // min distinct content tokens for a window to count (filters boilerplate)

const isTest = (name: string): boolean =>
  /\.(test|spec)\.[tj]sx?$/.test(name) || name.includes("__tests__");
const isTsx = (name: string): boolean => name.endsWith(".tsx");
const scriptKind = (name: string): ts.ScriptKind =>
  isTsx(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(name));

/** L: total AST nodes (RULE-003). */
function astNodeCount(sf: ts.SourceFile): number {
  let n = 0;
  const walk = (node: ts.Node): void => {
    n += 1;
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return n;
}

/** Cyclomatic complexity: 1 + one per decision point (RULE-004). */
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
  const variant = isTsx(name) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const stripped = text
    .split(/\r?\n/u)
    .filter((line) => !/^\s*import\b/u.test(line) && !/^\s*export\b[^;]*\bfrom\b/u.test(line))
    .join("\n");
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, variant, stripped);
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
 * Duplicate-window mass (RULE-005): slide a 12-token window over each non-test
 * file; a window counts only with ≥ 5 distinct content tokens; mass is the number
 * of copies of each repeated window beyond the first.
 */
function duplicateMass(files: Files): number {
  const counts = new Map<string, number>();
  for (const [name, text] of Object.entries(files)) {
    if (isTest(name)) continue;
    const tokens = tokenStream(name, text);
    for (let i = 0; i + CLONE_WINDOW <= tokens.length; i += 1) {
      const window = tokens.slice(i, i + CLONE_WINDOW);
      const distinctContent = new Set<string>();
      for (const token of window) if (token.content) distinctContent.add(token.text);
      if (distinctContent.size < MIN_CONTENT) continue;
      const key = window.map((token) => token.key).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let mass = 0;
  for (const count of counts.values()) if (count >= 2) mass += count - 1;
  return mass;
}

/**
 * Measure a set of source files: total AST nodes, summed cyclomatic complexity,
 * and duplicate-window mass — over non-test files only.
 */
export function measure(files: Files): Measurement {
  let L = 0;
  let comp = 0;
  for (const [name, text] of Object.entries(files)) {
    if (isTest(name)) continue;
    const sf = parse(name, text);
    L += astNodeCount(sf);
    comp += complexity(sf);
  }
  return { L, complexity: comp, dupMass: duplicateMass(files) };
}
