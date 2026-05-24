/**
 * Behavior-fence mutation core. Migrated from the pure logic of
 * `legacy/codenuke/loop/fence.mjs` (a CLI script): AST mutation-site generation,
 * mutant application, deterministic sampling, and the Wilson admissibility bar.
 * The audit loop (spawns the target test suite per mutant) and the monotonic
 * `replay` are engine-level orchestration, not part of this library.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-006, RULE-007, RULE-008, RULE-043
 */
import ts from "typescript";
import { lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { wilson } from "@codenuke/stats";

/** The operator-flip mutation table (RULE-007). */
export const OPERATORS: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.LessThanToken]: ">",
  [ts.SyntaxKind.GreaterThanToken]: "<",
  [ts.SyntaxKind.LessThanEqualsToken]: ">=",
  [ts.SyntaxKind.GreaterThanEqualsToken]: "<=",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "!==",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "===",
  [ts.SyntaxKind.AmpersandAmpersandToken]: "||",
  [ts.SyntaxKind.BarBarToken]: "&&",
};

/** A single injectable behavior change (RULE-007). */
export interface MutationSite {
  readonly start: number;
  readonly end: number;
  readonly repl: string;
  readonly op: string;
}

/** A mutation site pinned to a repository-relative source file. */
export interface PlannedMutation extends MutationSite {
  readonly rel: string;
}

export interface RegionRecord {
  readonly caught: number;
  readonly total: number;
  readonly p: number;
  readonly lo: number;
  readonly hi: number;
  readonly admissible: boolean;
  readonly survivorSpecs: readonly PlannedMutation[];
}

export interface FenceArtifact {
  readonly schemaVersion: 1;
  readonly baseline: string;
  readonly baselineSha: string;
  readonly generatedAt: string;
  readonly method: "ast-aware";
  readonly threshold: number;
  readonly capPerRegion: number;
  readonly seed: number;
  readonly regions: Record<string, RegionRecord>;
}

/** Collect all mutation sites in a source file: operator flips, startsWith↔endsWith, return true↔false. */
export function collectSites(name: string, text: string): MutationSite[] {
  const kind = name.endsWith(".jsx")
    ? ts.ScriptKind.JSX
    : /\.(t|j)sx$/u.test(name)
      ? ts.ScriptKind.TSX
      : name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const sites: MutationSite[] = [];
  const push = (start: number, end: number, repl: string): void => {
    sites.push({ start, end, repl, op: `${text.slice(start, end)}→${repl}` });
  };
  (function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && OPERATORS[node.operatorToken.kind] !== undefined) {
      push(node.operatorToken.getStart(sf), node.operatorToken.getEnd(), OPERATORS[node.operatorToken.kind]!);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const nm = node.expression.name.text;
      if (nm === "startsWith" || nm === "endsWith") {
        push(
          node.expression.name.getStart(sf),
          node.expression.name.getEnd(),
          nm === "startsWith" ? "endsWith" : "startsWith",
        );
      }
    } else if (
      ts.isReturnStatement(node) &&
      node.expression &&
      (node.expression.kind === ts.SyntaxKind.TrueKeyword || node.expression.kind === ts.SyntaxKind.FalseKeyword)
    ) {
      const isTrue = node.expression.kind === ts.SyntaxKind.TrueKeyword;
      push(node.expression.getStart(sf), node.expression.getEnd(), isTrue ? "false" : "true");
    }
    ts.forEachChild(node, visit);
  })(sf);
  return sites;
}

/** Apply a mutation site to source text. */
export const applyMutant = (text: string, site: MutationSite): string =>
  text.slice(0, site.start) + site.repl + text.slice(site.end);

/** Seeded PRNG — matches the legacy fence sampler exactly (note the `a |= 0`). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic in-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Deterministically sample up to `cap` sites with a seeded shuffle (RULE-008). */
export function sampleSites(sites: readonly MutationSite[], cap: number, seed: number): MutationSite[] {
  return shuffle([...sites], mulberry32(seed)).slice(0, cap);
}

/** A region is admissible iff its Wilson lower bound clears the threshold (RULE-006). */
export const isAdmissible = (caught: number, total: number, threshold: number): boolean =>
  wilson(caught, total).lo >= threshold;

const isSourceFile = (path: string): boolean =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(path) && !path.endsWith(".d.ts") && !/\.(test|spec|accept)\./u.test(path);

/** Legacy region → git pathspec mapping for fence audits. */
export const regionPath = (srcDir: string, region: string): string =>
  srcDir === "." || region === srcDir ? srcDir : `${srcDir}/${region}`;

/** Parse `git ls-tree -r -z --name-only` output and keep only counted source files. */
export const filesFromGitLsTree = (output: string): string[] =>
  output.split("\0").filter((path) => path.length > 0 && isSourceFile(path));

/** Arg-vector plan for the git commands the fence runtime executes. */
export function fenceGitCommandPlan(input: {
  readonly baseline: string;
  readonly srcDir: string;
  readonly region: string;
}): {
  readonly resolveBaseline: readonly string[];
  readonly filesInRegion: (ref: string) => readonly string[];
} {
  return {
    resolveBaseline: ["rev-parse", "--verify", "--end-of-options", input.baseline],
    filesInRegion: (ref) => ["ls-tree", "-r", "-z", "--name-only", ref, "--", regionPath(input.srcDir, input.region)],
  };
}

export function createFenceArtifact(input: {
  readonly baseline: string;
  readonly baselineSha: string;
  readonly generatedAt: string;
  readonly threshold: number;
  readonly capPerRegion: number;
  readonly seed: number;
  readonly regions: Record<string, RegionRecord>;
}): FenceArtifact {
  return {
    schemaVersion: 1,
    baseline: input.baseline,
    baselineSha: input.baselineSha,
    generatedAt: input.generatedAt,
    method: "ast-aware",
    threshold: input.threshold,
    capPerRegion: input.capPerRegion,
    seed: input.seed,
    regions: input.regions,
  };
}

/** Legacy fail-closed baseline-red result, with an explicit cleanup signal. */
export const baselineRedResult = (): {
  readonly ok: false;
  readonly exitCode: 1;
  readonly artifact: { readonly error: "baseline red" };
  readonly stdout: readonly string[];
  readonly cleanupWorktree: true;
} => ({
  ok: false,
  exitCode: 1,
  artifact: { error: "baseline red" },
  stdout: ["baseline RED — abort"],
  cleanupWorktree: true,
});

/** Build the per-region sampled mutation plan (RULE-007/008). */
export function createAuditPlan(input: {
  readonly regions: readonly string[];
  readonly filesByRegion: Record<string, readonly { readonly rel: string; readonly text: string }[]>;
  readonly capPerRegion: number;
  readonly seed: number;
}): Record<string, readonly PlannedMutation[]> {
  const rng = mulberry32(input.seed);
  const plan: Record<string, PlannedMutation[]> = {};
  for (const region of input.regions) {
    const candidates: PlannedMutation[] = [];
    for (const file of input.filesByRegion[region] ?? []) {
      for (const site of collectSites(file.rel, file.text)) candidates.push({ rel: file.rel, ...site });
    }
    shuffle(candidates, rng);
    plan[region] = candidates.slice(0, input.capPerRegion);
  }
  return plan;
}

/** Only a green mutant survives; fail and timeout are caught (RULE-009). */
export function recordMutationResult(
  site: PlannedMutation,
  status: "green" | "fail" | "timeout",
): { readonly caught: boolean; readonly survivorSpec: PlannedMutation | null } {
  return status === "green" ? { caught: false, survivorSpec: site } : { caught: true, survivorSpec: null };
}

/** Derive a fence region record from the sampled plan and test outcomes. */
export function regionRecordFromResults(input: {
  readonly plan: readonly PlannedMutation[];
  readonly statuses: readonly ("green" | "fail" | "timeout")[];
  readonly threshold: number;
}): RegionRecord {
  const survivorSpecs: PlannedMutation[] = [];
  let caught = 0;
  input.plan.forEach((site, index) => {
    const result = recordMutationResult(site, input.statuses[index] ?? "green");
    if (result.caught) caught += 1;
    else if (result.survivorSpec) survivorSpecs.push(result.survivorSpec);
  });
  const w = wilson(caught, input.plan.length);
  return {
    caught,
    total: input.plan.length,
    p: w.p,
    lo: w.lo,
    hi: w.hi,
    admissible: w.lo >= input.threshold,
    survivorSpecs,
  };
}

/** Merge a filtered refresh while preserving unrefreshed prior regions. */
export function mergeFilteredAuditArtifact(
  previous: FenceArtifact,
  refresh: FenceArtifact,
  filteredRegions: readonly string[],
): FenceArtifact {
  const regions: Record<string, RegionRecord> = { ...previous.regions };
  for (const region of filteredRegions) {
    if (refresh.regions[region]) regions[region] = refresh.regions[region];
  }
  return { ...refresh, regions };
}

/** True when preserved filtered-audit regions still belong to the same measurement frame. */
export function canReuseFilteredAuditArtifact(previous: FenceArtifact, refresh: FenceArtifact): boolean {
  return (
    previous.schemaVersion === 1 &&
    previous.baselineSha === refresh.baselineSha &&
    previous.method === refresh.method &&
    previous.threshold === refresh.threshold &&
    previous.capPerRegion === refresh.capPerRegion &&
    previous.seed === refresh.seed
  );
}

const isUnsafeRel = (rel: string): boolean =>
  rel === "" || rel.startsWith("/") || rel.split("/").includes("..");

/** Resolve a worktree-relative source path and reject traversal/symlink escapes before I/O. */
export function safeWorktreePath(worktreeRoot: string, rel: string): string {
  if (isUnsafeRel(rel)) throw new Error(`unsafe survivor path before replay: ${rel}`);
  let root: string;
  try {
    root = realpathSync(worktreeRoot);
  } catch {
    throw new Error(`source changed before replay: ${rel}`);
  }
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`unsafe survivor path before replay: ${rel}`);
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(target);
  } catch {
    throw new Error(`source changed before replay: ${rel}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`unsafe survivor path before replay: ${rel}`);
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    throw new Error(`source changed before replay: ${rel}`);
  }
  if (realTarget !== root && !realTarget.startsWith(`${root}${sep}`)) {
    throw new Error(`unsafe survivor path before replay: ${rel}`);
  }
  return target;
}

/** Replay can only retest survivors whose source file is unchanged and safely inside the worktree. */
export function assertReplaySourcesUnchanged(input: {
  readonly artifact: FenceArtifact;
  readonly region: string;
  readonly readBaseline: (rel: string) => string;
  readonly readWorktree: (rel: string) => string;
  readonly worktreeRoot?: string;
}): void {
  const specs = input.artifact.regions[input.region]?.survivorSpecs ?? [];
  for (const rel of new Set(specs.map((spec) => spec.rel))) {
    if (input.worktreeRoot) safeWorktreePath(input.worktreeRoot, rel);
    let baselineSource: string;
    let currentSource: string;
    try {
      baselineSource = input.readBaseline(rel);
      currentSource = input.readWorktree(rel);
    } catch {
      throw new Error(`source changed before replay: ${rel}`);
    }
    if (baselineSource !== currentSource) throw new Error(`source changed before replay: ${rel}`);
  }
}

export function assertReplayBaselineGreen(status: "green" | "fail" | "timeout"): void {
  if (status !== "green") throw new Error("worktree baseline not green");
}

/** Monotonic replay: fixed total, caught increases as prior survivors are killed (RULE-043). */
export function replaySurvivors(input: {
  readonly artifact: FenceArtifact;
  readonly region: string;
  readonly statuses: readonly ("green" | "fail" | "timeout")[];
  readonly threshold: number;
}): FenceArtifact {
  const previous = input.artifact.regions[input.region];
  if (!previous) throw new Error(`no region ${input.region} in artifact`);
  const still: PlannedMutation[] = [];
  previous.survivorSpecs.forEach((spec, index) => {
    if ((input.statuses[index] ?? "green") === "green") still.push(spec);
  });
  const caught = previous.total - still.length;
  const w = wilson(caught, previous.total);
  return {
    ...input.artifact,
    regions: {
      ...input.artifact.regions,
      [input.region]: {
        caught,
        total: previous.total,
        p: w.p,
        lo: w.lo,
        hi: w.hi,
        admissible: w.lo >= input.threshold,
        survivorSpecs: still,
      },
    },
  };
}
