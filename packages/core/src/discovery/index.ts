import ts from "typescript";
import type { Opportunity } from "../domain/index.ts";
import type { Files } from "../measure/index.ts";
import { hashString, hashUnknown } from "../metric/index.ts";

const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u;

const scriptKind = (name: string): ts.ScriptKind =>
  name.endsWith(".jsx")
    ? ts.ScriptKind.JSX
    : /\.(?:t|j)sx$/u.test(name)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(name));

const stableOpportunity = (input: Omit<Opportunity, "id" | "inputHash"> & { readonly seed: unknown }): Opportunity => {
  const inputHash = hashUnknown(input.seed);
  return {
    ...input,
    inputHash,
    id: `${input.kind}:${hashString(`${input.kind}:${input.region}:${input.files.join(",")}:${inputHash}`)}`,
  };
};

const normalizeIdentifiers = (text: string): string =>
  text
    .replace(/\b[A-Za-z_$][\w$]*\b/gu, "ID")
    .replace(/\b\d+(?:\.\d+)?\b/gu, "NUM")
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/gu, "STR")
    .replace(/\s+/gu, " ")
    .trim();

interface FunctionShape {
  readonly file: string;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly body: string;
  readonly normalized: string;
  readonly exported: boolean;
}

const functionShapes = (file: string, sf: ts.SourceFile): FunctionShape[] => {
  const shapes: FunctionShape[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      shapes.push({
        file,
        name: node.name.text,
        parameters: node.parameters.map((p) => p.name.getText(sf)),
        body: node.body.getText(sf),
        normalized: normalizeIdentifiers(node.body.getText(sf)),
        exported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return shapes;
};

const wrapperTarget = (shape: FunctionShape): string | null => {
  const params = shape.parameters.join("\\s*,\\s*");
  const re = new RegExp(`^\\{\\s*return\\s+([A-Za-z_$][\\w$]*)\\s*\\(\\s*${params}\\s*\\)\\s*;?\\s*\\}$`, "u");
  const match = re.exec(shape.body.replace(/\s+/gu, " "));
  return match?.[1] ?? null;
};

export const discoverOpportunities = (
  files: Files,
  region = ".",
): Opportunity[] => {
  const opportunities: Opportunity[] = [];
  const sourceEntries = Object.entries(files)
    .filter(([file]) => SOURCE_RE.test(file))
    .sort(([a], [b]) => a.localeCompare(b));

  const allFunctions: FunctionShape[] = [];
  const identifierCounts = new Map<string, number>();
  const subtreeGroups = new Map<string, { files: Set<string>; count: number; examples: string[] }>();

  for (const [file, text] of sourceEntries) {
    const sf = parse(file, text);
    allFunctions.push(...functionShapes(file, sf));
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        identifierCounts.set(node.text, (identifierCounts.get(node.text) ?? 0) + 1);
      }
      if (
        ts.isBlock(node) ||
        ts.isIfStatement(node) ||
        ts.isCallExpression(node) ||
        ts.isReturnStatement(node)
      ) {
        const snippet = normalizeIdentifiers(node.getText(sf));
        if (snippet.length >= 24) {
          const current = subtreeGroups.get(snippet) ?? { files: new Set<string>(), count: 0, examples: [] };
          current.files.add(file);
          current.count += 1;
          if (current.examples.length < 2) current.examples.push(node.getText(sf).slice(0, 160));
          subtreeGroups.set(snippet, current);
        }
      }
      if (ts.isIfStatement(node) && node.expression.kind === ts.SyntaxKind.TrueKeyword) {
        opportunities.push(
          stableOpportunity({
            kind: "local-simplification",
            region,
            files: [file],
            estimatedGain: 1,
            evidence: { reason: "if-true", snippet: node.getText(sf).slice(0, 160) },
            seed: { file, pos: node.pos, kind: "if-true" },
          }),
        );
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  for (const [fingerprint, group] of [...subtreeGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.count < 2) continue;
    const filesForGroup = [...group.files].sort();
    opportunities.push(
      stableOpportunity({
        kind: "duplicate-subtree",
        region,
        files: filesForGroup,
        estimatedGain: group.count - 1,
        evidence: { count: group.count, examples: group.examples },
        seed: { fingerprint, files: filesForGroup, count: group.count },
      }),
    );
  }

  for (const shape of allFunctions.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`))) {
    const target = wrapperTarget(shape);
    if (target === null) continue;
    opportunities.push(
      stableOpportunity({
        kind: "wrapper-chain",
        region,
        files: [shape.file],
        estimatedGain: 1,
        evidence: { wrapper: shape.name, target },
        seed: { file: shape.file, wrapper: shape.name, target },
      }),
    );
  }

  for (const shape of allFunctions.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`))) {
    if (shape.exported) continue;
    if ((identifierCounts.get(shape.name) ?? 0) !== 1) continue;
    opportunities.push(
      stableOpportunity({
        kind: "unused-symbol",
        region,
        files: [shape.file],
        estimatedGain: 1,
        evidence: { symbol: shape.name, reason: "declared-once-in-corpus" },
        seed: { file: shape.file, symbol: shape.name, kind: "unused-symbol" },
      }),
    );
  }

  const byShape = new Map<string, FunctionShape[]>();
  for (const shape of allFunctions) {
    const key = `${shape.parameters.length}:${shape.normalized}`;
    byShape.set(key, [...(byShape.get(key) ?? []), shape]);
  }
  for (const [key, shapes] of [...byShape.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const names = shapes.map((s) => `${s.file}:${s.name}`).sort();
    if (names.length < 2) continue;
    opportunities.push(
      stableOpportunity({
        kind: "similar-function",
        region,
        files: [...new Set(shapes.map((s) => s.file))].sort(),
        estimatedGain: names.length - 1,
        evidence: { functions: names },
        seed: { key, names },
      }),
    );
  }

  return opportunities.sort((a, b) => a.id.localeCompare(b.id));
};
