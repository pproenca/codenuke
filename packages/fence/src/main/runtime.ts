/**
 * Side-effectful fence audit/replay runtime.
 *
 * This is the adapter over the pure mutation core. It preserves the legacy
 * audit/replay contracts while using the modern execution/worktree substrate.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-006..009, RULE-043
 */
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { fenceArtifactStatus } from "@codenuke/artifacts";
import { loadConfig, type Config } from "@codenuke/config";
import { run } from "@codenuke/exec";
import { linkWorktreeNodeModules, removeWorktree, runShellGroup } from "@codenuke/substrate";
import {
  applyMutant,
  assertReplayBaselineGreen,
  assertReplaySourcesUnchanged,
  baselineRedResult,
  canReuseFilteredAuditArtifact,
  collectSites,
  createAuditPlan,
  createFenceArtifact,
  fenceGitCommandPlan,
  filesFromGitLsTree,
  mergeFilteredAuditArtifact,
  regionRecordFromResults,
  replaySurvivors,
  safeWorktreePath,
  type FenceArtifact,
  type PlannedMutation,
  type RegionRecord,
} from "./fence.js";

type Env = Record<string, string | undefined>;
type TestStatus = "green" | "fail" | "timeout";

export interface FenceCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
}

export type RuntimeEvent =
  | {
      readonly type: "audit-start";
      readonly repo: string;
      readonly baseline: string;
      readonly baselineSha: string;
      readonly srcDir: string;
      readonly target: string;
      readonly regions: readonly string[];
      readonly testCommand: string;
      readonly worktree: string;
      readonly artifact: string;
      readonly cap: number;
      readonly seed: number;
    }
  | {
      readonly type: "phase";
      readonly label: string;
      readonly index: number;
      readonly total: number;
    }
  | {
      readonly type: "region-plan";
      readonly region: string;
      readonly sites: number;
      readonly sampled: number;
    }
  | {
      readonly type: "mutation-progress";
      readonly region: string;
      readonly done: number;
      readonly total: number;
      readonly overallDone: number;
      readonly overallTotal: number;
      readonly caught: number;
      readonly survivors: number;
      readonly elapsedMs: number;
    }
  | {
      readonly type: "region-result";
      readonly region: string;
      readonly caught: number;
      readonly total: number;
      readonly p: number;
      readonly lo: number;
      readonly hi: number;
      readonly threshold: number;
      readonly admissible: boolean;
      readonly survivors: readonly PlannedMutation[];
    }
  | { readonly type: "artifact"; readonly path: string }
  | { readonly type: "message"; readonly message: string };

export interface RuntimeReporter {
  emit(event: RuntimeEvent): void;
}

export interface FenceCommandOptions {
  readonly reporter?: RuntimeReporter;
}

const TIMEOUT_MS = 45000;

const writeArtifact = (path: string, value: unknown): void => {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(value, null, 2));
};

const output = (lines: readonly string[]): string =>
  `${lines.join("\n")}${lines.length ? "\n" : ""}`;

const seconds = (ms: number): string => `${Math.floor(ms / 1000)}s`;

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const mutationLocation = (site: PlannedMutation): string => {
  return `${site.rel}:${site.start} operator ${site.op}`;
};

export function renderRuntimeEvent(event: RuntimeEvent): string[] {
  switch (event.type) {
    case "audit-start":
      return [
        "fence audit",
        `repo: ${event.repo}`,
        `baseline: ${event.baseline} -> ${event.baselineSha.slice(0, 12)}`,
        `source: ${event.srcDir}`,
        `target: ${event.target}`,
        `regions: ${event.regions.join(", ")}`,
        `test command: ${event.testCommand}`,
        `worktree: ${event.worktree}`,
        `artifact: ${event.artifact}`,
        `cap: ${event.cap} mutations/region`,
        `seed: ${event.seed}`,
      ];
    case "phase":
      return [`[${event.index}/${event.total}] ${event.label}`];
    case "region-plan":
      return [`  ${event.region}: ${event.sites} mutation sites -> sampling ${event.sampled}`];
    case "mutation-progress": {
      const avg = event.done > 0 ? event.elapsedMs / event.done : 0;
      const remaining = event.done > 0 ? Math.max(0, event.total - event.done) * avg : 0;
      return [
        `  ${event.region.padEnd(12)} ${event.done}/${event.total}  caught=${event.caught} survivors=${event.survivors} elapsed=${seconds(event.elapsedMs)} avg=${event.done > 0 ? seconds(avg) : "-"} eta=${event.done > 0 ? seconds(remaining) : "-"}`,
        `  overall ${event.overallDone}/${event.overallTotal} complete`,
      ];
    }
    case "region-result": {
      const survived = event.total - event.caught;
      const lines = [
        `== ${event.region}`,
        `mutations tested: ${event.total}`,
        `caught by tests: ${event.caught}`,
        `survived: ${survived}`,
        `fence score: ${percent(event.p)}`,
        `confidence lower bound: ${percent(event.lo)}`,
        `threshold: ${percent(event.threshold)}`,
        `status: ${event.admissible ? "ADMISSIBLE" : "BLOCKED"}`,
      ];
      if (!event.admissible && survived > 0) {
        lines.push(
          "",
          `meaning: tests missed ${survived} behavior changes. codenuke may add characterization tests before reducing this region.`,
          "",
          "survivors:",
          ...event.survivors.slice(0, 3).map((site) => `  ${mutationLocation(site)}`),
        );
        if (event.survivors.length > 3) {
          lines.push(`  ... ${event.survivors.length - 3} more in the fence artifact`);
        }
      }
      return lines;
    }
    case "artifact":
      return ["", `-> ${event.path}`];
    case "message":
      return [event.message];
  }
  return [];
}

export const textReporter = (writeLine: (line: string) => void): RuntimeReporter => ({
  emit(event) {
    for (const line of renderRuntimeEvent(event)) {
      writeLine(line);
    }
  },
});

function recordEvent(
  out: string[],
  reporter: RuntimeReporter | undefined,
  event: RuntimeEvent,
): void {
  out.push(...renderRuntimeEvent(event));
  reporter?.emit(event);
}

async function runTests(
  config: Config,
  cwd: string,
  env: NodeJS.ProcessEnv,
  reporter?: RuntimeReporter,
): Promise<TestStatus> {
  reporter?.emit({ type: "message", message: "  running test command" });
  const result = await runShellGroup(config.testCommand, { cwd, env, timeout: TIMEOUT_MS });
  if (result.ok) {
    return "green";
  }
  return result.timedOut ? "timeout" : "fail";
}

function filesIn(config: Config, region: string, baselineSha: string): string[] {
  const plan = fenceGitCommandPlan({ baseline: config.baseline, srcDir: config.srcDir, region });
  return filesFromGitLsTree(
    run("git", plan.filesInRegion(baselineSha), {
      cwd: config.repo,
    }),
  );
}

function readJson<T>(path: string, _shape?: (value: unknown) => value is T): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function cleanup(config: Config, worktree: string): string | null {
  removeWorktree(config.repo, worktree);
  if (!existsSync(worktree)) {
    return null;
  }
  try {
    rmSync(worktree, { recursive: true, force: true });
    run("git", ["worktree", "prune"], { cwd: config.repo });
  } catch {
    /* surfaced by the existence check below */
  }
  return existsSync(worktree) ? `failed to remove fence worktree: ${worktree}` : null;
}

const appendCleanupFailure = (stderr: string, failure: string | null): string =>
  failure ? `${stderr}${stderr.endsWith("\n") ? "" : "\n"}${failure}\n` : stderr;

async function auditFence(
  args: readonly string[],
  env: Env,
  cwd: string,
  options: FenceCommandOptions = {},
): Promise<FenceCommandResult> {
  const config = loadConfig(env, cwd);
  const cap = Number(args[0]) || 60;
  const seed = Number(args[1]) || 1337;
  const filteredRegions = args[2] ? args[2].split(",").filter(Boolean) : null;
  const regions = filteredRegions ?? config.regions;
  const worktree = `${config.worktree}-fence`;
  const out: string[] = [];

  if (regions.length === 0) {
    return { exitCode: 1, stdout: `no source regions detected under ${config.srcDir}/\n` };
  }

  try {
    const auditPlan = fenceGitCommandPlan({
      baseline: config.baseline,
      srcDir: config.srcDir,
      region: regions[0],
    });
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 1,
      total: 6,
      label: "resolving baseline",
    });
    const baselineSha = run("git", auditPlan.resolveBaseline, { cwd: config.repo }).trim();
    recordEvent(out, options.reporter, {
      type: "audit-start",
      repo: config.repo,
      baseline: config.baseline,
      baselineSha,
      srcDir: config.srcDir,
      target: config.target,
      regions,
      testCommand: config.testCommand,
      worktree,
      artifact: config.fenceArtifact,
      cap,
      seed,
    });
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 2,
      total: 6,
      label: "creating isolated worktree",
    });
    removeWorktree(config.repo, worktree);
    run("git", ["worktree", "add", "-f", worktree, baselineSha], { cwd: config.repo, env });
    linkWorktreeNodeModules(config.repo, worktree);
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 3,
      total: 6,
      label: "checking baseline tests",
    });
    if ((await runTests(config, worktree, env as NodeJS.ProcessEnv, options.reporter)) !== "green") {
      const red = baselineRedResult();
      writeArtifact(config.fenceArtifact, red.artifact);
      for (const message of red.stdout) {
        recordEvent(out, options.reporter, { type: "message", message });
      }
      const cleanupFailure = cleanup(config, worktree);
      return {
        exitCode: red.exitCode,
        stdout: output(out),
        ...(cleanupFailure ? { stderr: `${cleanupFailure}\n` } : {}),
      };
    }

    recordEvent(out, options.reporter, {
      type: "phase",
      index: 4,
      total: 6,
      label: "scanning mutation sites",
    });
    const filesByRegion: Record<string, { rel: string; text: string }[]> = {};
    for (const region of regions) {
      filesByRegion[region] = [];
      for (const rel of filesIn(config, region, baselineSha)) {
        try {
          filesByRegion[region].push({
            rel,
            text: readFileSync(safeWorktreePath(worktree, rel), "utf8"),
          });
        } catch {
          /* source vanished between git listing and worktree read */
        }
      }
    }

    const plan = createAuditPlan({ regions, filesByRegion, capPerRegion: cap, seed });
    for (const region of regions) {
      const candidateCount =
        filesByRegion[region]?.reduce(
          (count, file) => count + collectSites(file.rel, file.text).length,
          0,
        ) ?? 0;
      recordEvent(out, options.reporter, {
        type: "region-plan",
        region,
        sites: candidateCount,
        sampled: plan[region]?.length ?? 0,
      });
    }

    const previousArtifact = filteredRegions ? readJson<FenceArtifact>(config.fenceArtifact) : null;
    let artifact = createFenceArtifact({
      baseline: config.baseline,
      baselineSha,
      generatedAt: new Date().toISOString(),
      threshold: config.thresholds.fenceLB,
      capPerRegion: cap,
      seed,
      regions: {},
    });
    if (previousArtifact && canReuseFilteredAuditArtifact(previousArtifact, artifact)) {
      artifact = { ...artifact, regions: previousArtifact.regions ?? {} };
    } else if (previousArtifact) {
      recordEvent(out, options.reporter, {
        type: "message",
        message:
          "  filtered refresh: previous artifact not reusable for this baseline/cap/seed; dropping stale regions",
      });
    }

    let done = 0;
    const total = Object.values(plan).reduce((sum, sites) => sum + sites.length, 0);
    const t0 = Date.now();
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 5,
      total: 6,
      label: `running mutation audit: 0/${total} complete`,
    });
    for (const region of regions) {
      const statuses: TestStatus[] = [];
      const regionPlan = plan[region] ?? [];
      let regionCaught = 0;
      let regionSurvivors = 0;
      if (regionPlan.length > 0) {
        recordEvent(out, options.reporter, {
          type: "mutation-progress",
          region,
          done: 0,
          total: regionPlan.length,
          overallDone: done,
          overallTotal: total,
          caught: 0,
          survivors: 0,
          elapsedMs: Date.now() - t0,
        });
      }
      for (const site of regionPlan) {
        const path = safeWorktreePath(worktree, site.rel);
        const original = readFileSync(path, "utf8");
        writeFileSync(path, applyMutant(original, site));
        let status: TestStatus = "fail";
        try {
          status = await runTests(config, worktree, env as NodeJS.ProcessEnv, options.reporter);
          statuses.push(status);
        } finally {
          writeFileSync(path, original);
        }
        if (status === "green") {
          regionSurvivors += 1;
        } else {
          regionCaught += 1;
        }
        done += 1;
        if (statuses.length % 10 === 0 || statuses.length === regionPlan.length) {
          recordEvent(out, options.reporter, {
            type: "mutation-progress",
            region,
            done: statuses.length,
            total: regionPlan.length,
            overallDone: done,
            overallTotal: total,
            caught: regionCaught,
            survivors: regionSurvivors,
            elapsedMs: Date.now() - t0,
          });
        }
      }
      const record = regionRecordFromResults({
        plan: plan[region] ?? [],
        statuses,
        threshold: config.thresholds.fenceLB,
      });
      artifact = {
        ...artifact,
        regions: { ...artifact.regions, [region]: record },
      };
      recordEvent(out, options.reporter, {
        type: "region-result",
        region,
        caught: record.caught,
        total: record.total,
        p: record.p,
        lo: record.lo,
        hi: record.hi,
        threshold: config.thresholds.fenceLB,
        admissible: record.admissible,
        survivors: record.survivorSpecs,
      });
      writeArtifact(config.fenceArtifact, artifact);
    }

    if (
      filteredRegions &&
      previousArtifact &&
      canReuseFilteredAuditArtifact(previousArtifact, artifact)
    ) {
      artifact = mergeFilteredAuditArtifact(previousArtifact, artifact, filteredRegions);
      writeArtifact(config.fenceArtifact, artifact);
    }
    const cleanupFailure = cleanup(config, worktree);
    if (cleanupFailure) {
      return { exitCode: 1, stdout: output(out), stderr: `${cleanupFailure}\n` };
    }
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 6,
      total: 6,
      label: "writing fence artifact",
    });
    recordEvent(out, options.reporter, { type: "artifact", path: config.fenceArtifact });
    for (const [region, record] of Object.entries(artifact.regions)) {
      recordEvent(out, options.reporter, {
        type: "message",
        message: `  ${region.padEnd(12)} ${record.caught}/${record.total}  lo=${(record.lo * 100).toFixed(1)}%  ${record.admissible ? "ADMISSIBLE" : "BLOCKED"}`,
      });
    }
    return { exitCode: 0, stdout: output(out) };
  } catch (error) {
    const cleanupFailure = cleanup(config, worktree);
    const stderr = `${error instanceof Error ? error.message : String(error)}\n`;
    return {
      exitCode: 1,
      stdout: output(out),
      stderr: appendCleanupFailure(stderr, cleanupFailure),
    };
  }
}

async function replayFence(
  args: readonly string[],
  env: Env,
  cwd: string,
  options: FenceCommandOptions = {},
): Promise<FenceCommandResult> {
  const config = loadConfig(env, cwd);
  const region = args[0];
  const worktree = args[1] ?? config.worktree;
  const out: string[] = [];
  if (!region) {
    return { exitCode: 1, stdout: "", stderr: "usage: fence replay <region> [worktree]\n" };
  }
  const status = fenceArtifactStatus(config);
  if (!status.usable || status.artifact?.schemaVersion !== 1) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `fence artifact not usable for replay: ${status.reason ?? "invalid-schema"}\n`,
    };
  }
  const artifact = status.artifact as unknown as FenceArtifact;
  if (!artifact.regions?.[region]) {
    return { exitCode: 1, stdout: "", stderr: `no region ${region} in artifact\n` };
  }
  recordEvent(out, options.reporter, {
    type: "phase",
    index: 1,
    total: 4,
    label: `replaying fence survivors for ${region}`,
  });
  try {
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 2,
      total: 4,
      label: "checking replay baseline",
    });
    assertReplaySourcesUnchanged({
      artifact,
      region,
      readBaseline: (rel) =>
        run("git", ["show", `${artifact.baselineSha}:${rel}`], { cwd: config.repo }),
      readWorktree: (rel) => readFileSync(safeWorktreePath(worktree, rel), "utf8"),
      worktreeRoot: worktree,
    });
    assertReplayBaselineGreen(await runTests(config, worktree, env as NodeJS.ProcessEnv, options.reporter));
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)} — abort replay\n`,
    };
  }

  const previous = artifact.regions[region];
  const statuses: TestStatus[] = [];
  recordEvent(out, options.reporter, {
    type: "phase",
    index: 3,
    total: 4,
    label: `replaying survivors: 0/${previous.survivorSpecs.length} complete`,
  });
  for (const site of previous.survivorSpecs) {
    const path = safeWorktreePath(worktree, site.rel);
    let original: string;
    try {
      original = readFileSync(path, "utf8");
    } catch {
      statuses.push("green");
      continue;
    }
    writeFileSync(path, applyMutant(original, site));
    try {
      statuses.push(await runTests(config, worktree, env as NodeJS.ProcessEnv, options.reporter));
    } finally {
      writeFileSync(path, original);
    }
    recordEvent(out, options.reporter, {
      type: "phase",
      index: 3,
      total: 4,
      label: `replaying survivors: ${statuses.length}/${previous.survivorSpecs.length} complete`,
    });
  }
  const next = replaySurvivors({
    artifact,
    region,
    statuses,
    threshold: config.thresholds.fenceLB,
  });
  writeArtifact(config.fenceArtifact, next);
  const record: RegionRecord = next.regions[region];
  recordEvent(out, options.reporter, {
    type: "phase",
    index: 4,
    total: 4,
    label: "writing replayed fence artifact",
  });
  recordEvent(out, options.reporter, {
    type: "message",
    message: `${region}: ${record.caught}/${record.total} = ${(record.p * 100).toFixed(0)}%  CI95 [${(record.lo * 100).toFixed(1)}, ${(record.hi * 100).toFixed(1)}]  ${record.admissible ? "ADMISSIBLE ✓" : "BLOCKED ✗"}`,
  });
  return { exitCode: 0, stdout: `${out.at(-1) ?? ""}\n` };
}

export async function runFenceCommand(
  args: readonly string[],
  env: Env = process.env,
  cwd = process.cwd(),
  options: FenceCommandOptions = {},
): Promise<FenceCommandResult> {
  if (args[0] === "replay") {
    return replayFence(args.slice(1), env, cwd, options);
  }
  return auditFence(args, env, cwd, options);
}
