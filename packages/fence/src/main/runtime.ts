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
  type RegionRecord,
} from "./fence.js";

type Env = Record<string, string | undefined>;
type TestStatus = "green" | "fail" | "timeout";

export interface FenceCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
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

async function runTests(config: Config, cwd: string, env: NodeJS.ProcessEnv): Promise<TestStatus> {
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
    const baselineSha = run("git", auditPlan.resolveBaseline, { cwd: config.repo }).trim();
    removeWorktree(config.repo, worktree);
    run("git", ["worktree", "add", "-f", worktree, baselineSha], { cwd: config.repo, env });
    linkWorktreeNodeModules(config.repo, worktree);
    out.push(
      `fence audit (AST-aware) @ ${config.baseline}  cap=${cap}/region  seed=${seed}  regions=${regions.join(",")}`,
    );
    if ((await runTests(config, worktree, env as NodeJS.ProcessEnv)) !== "green") {
      const red = baselineRedResult();
      writeArtifact(config.fenceArtifact, red.artifact);
      out.push(...red.stdout);
      const cleanupFailure = cleanup(config, worktree);
      return {
        exitCode: red.exitCode,
        stdout: output(out),
        ...(cleanupFailure ? { stderr: `${cleanupFailure}\n` } : {}),
      };
    }

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
      out.push(`  ${region}: ${candidateCount} sites -> sampling ${plan[region]?.length ?? 0}`);
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
      out.push(
        "  filtered refresh: previous artifact not reusable for this baseline/cap/seed; dropping stale regions",
      );
    }

    let done = 0;
    const total = Object.values(plan).reduce((sum, sites) => sum + sites.length, 0);
    const t0 = Date.now();
    for (const region of regions) {
      const statuses: TestStatus[] = [];
      for (const site of plan[region] ?? []) {
        const path = safeWorktreePath(worktree, site.rel);
        const original = readFileSync(path, "utf8");
        writeFileSync(path, applyMutant(original, site));
        try {
          statuses.push(await runTests(config, worktree, env as NodeJS.ProcessEnv));
        } finally {
          writeFileSync(path, original);
        }
        done += 1;
        if (done % 10 === 0) {
          out.push(`  [${done}/${total} ${((Date.now() - t0) / 1000) | 0}s]`);
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
      out.push(
        `== ${region}: ${record.caught}/${record.total} = ${(record.p * 100).toFixed(0)}%  CI95 [${(record.lo * 100).toFixed(1)}, ${(record.hi * 100).toFixed(1)}]  ${record.admissible ? "ADMISSIBLE ✓" : "BLOCKED ✗"}`,
      );
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
    out.push("", `-> ${config.fenceArtifact}`);
    for (const [region, record] of Object.entries(artifact.regions)) {
      out.push(
        `  ${region.padEnd(12)} ${record.caught}/${record.total}  lo=${(record.lo * 100).toFixed(1)}%  ${record.admissible ? "ADMISSIBLE" : "BLOCKED"}`,
      );
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
): Promise<FenceCommandResult> {
  const config = loadConfig(env, cwd);
  const region = args[0];
  const worktree = args[1] ?? config.worktree;
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
  try {
    assertReplaySourcesUnchanged({
      artifact,
      region,
      readBaseline: (rel) =>
        run("git", ["show", `${artifact.baselineSha}:${rel}`], { cwd: config.repo }),
      readWorktree: (rel) => readFileSync(safeWorktreePath(worktree, rel), "utf8"),
      worktreeRoot: worktree,
    });
    assertReplayBaselineGreen(await runTests(config, worktree, env as NodeJS.ProcessEnv));
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)} — abort replay\n`,
    };
  }

  const previous = artifact.regions[region];
  const statuses: TestStatus[] = [];
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
      statuses.push(await runTests(config, worktree, env as NodeJS.ProcessEnv));
    } finally {
      writeFileSync(path, original);
    }
  }
  const next = replaySurvivors({
    artifact,
    region,
    statuses,
    threshold: config.thresholds.fenceLB,
  });
  writeArtifact(config.fenceArtifact, next);
  const record: RegionRecord = next.regions[region];
  return {
    exitCode: 0,
    stdout: `${region}: ${record.caught}/${record.total} = ${(record.p * 100).toFixed(0)}%  CI95 [${(record.lo * 100).toFixed(1)}, ${(record.hi * 100).toFixed(1)}]  ${record.admissible ? "ADMISSIBLE ✓" : "BLOCKED ✗"}\n`,
  };
}

export async function runFenceCommand(
  args: readonly string[],
  env: Env = process.env,
  cwd = process.cwd(),
): Promise<FenceCommandResult> {
  if (args[0] === "replay") {
    return replayFence(args.slice(1), env, cwd);
  }
  return auditFence(args, env, cwd);
}
