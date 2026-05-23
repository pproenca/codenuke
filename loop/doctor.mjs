#!/usr/bin/env node
import { execSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { calibrationArtifactStatus, fenceArtifactStatus } from "./artifacts.mjs";
import { loadConfig, slug } from "./config.mjs";
import { commandAvailable } from "./shell.mjs";

const C = loadConfig();
const WT = `${C.worktree}-doctor-${slug(Date.now())}`;
const COMMAND_TIMEOUT = 300000;

function runOk(command, cwd = C.repo, timeout = COMMAND_TIMEOUT) {
  try {
    execSync(command, {
      cwd,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

function isolatedChecks() {
  if (!runOk(`git rev-parse --verify ${JSON.stringify(C.baseline)}`, C.repo)) {
    return { baselineExists: false, baselineGreen: false, typecheckOk: false };
  }
  try {
    runOk(`git worktree remove --force ${JSON.stringify(WT)}`, C.repo, 10000);
    execSync(`git worktree add -f ${JSON.stringify(WT)} ${JSON.stringify(C.baseline)}`, {
      cwd: C.repo,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      symlinkSync(`${C.repo}/node_modules`, `${WT}/node_modules`);
    } catch {}
    const baselineGreen = runOk(C.testCommand, WT);
    const typecheckOk = C.typeCheckCommand ? runOk(C.typeCheckCommand, WT) : true;
    return { baselineExists: true, baselineGreen, typecheckOk };
  } catch {
    return { baselineExists: true, baselineGreen: false, typecheckOk: false };
  } finally {
    try {
      rmSync(`${WT}/node_modules`, { force: true });
    } catch {}
    runOk(`git worktree remove --force ${JSON.stringify(WT)}`, C.repo, 10000);
    runOk("git worktree prune", C.repo, 10000);
  }
}

const { baselineExists, baselineGreen, typecheckOk } = isolatedChecks();
const hasRegions = C.regions.length > 0;
const fenceStatus = fenceArtifactStatus(C);
const fencePresent = fenceStatus.artifact != null;
const fenceUsable = fenceStatus.usable;
const calibrationPath = `${C.repo}/.codenuke/calibration.json`;
const calibrationStatus = calibrationArtifactStatus(C);
const calibrationPresent = calibrationStatus.artifact != null;
const calibrationUsable = calibrationStatus.usable;
const proposerAvailable = process.env.CN_PROPOSER
  ? true
  : commandAvailable("codex", { cwd: C.repo, env: process.env, timeout: 5000 });

const gaps = [];
if (!baselineExists) gaps.push(`baseline ${C.baseline} not found`);
if (!baselineGreen) gaps.push(`baseline test command is not green`);
if (!typecheckOk) gaps.push(`typecheck command is not green`);
if (!hasRegions) gaps.push(`no source regions detected`);
if (!fencePresent) gaps.push(`fence artifact missing`);
else if (fenceStatus.stale) gaps.push(`fence artifact stale`);
else if (!fenceUsable) gaps.push(`fence artifact invalid`);
if (!calibrationPresent) gaps.push(`calibration missing`);
else if (calibrationStatus.stale) gaps.push(`calibration stale`);
else if (!calibrationUsable) gaps.push(`calibration invalid`);
if (!proposerAvailable) gaps.push(`proposer unavailable`);

console.log(`doctor`);
console.log(`repo: ${C.repo}`);
console.log(`baseline: ${baselineGreen ? "green" : "not-ready"} (${C.baseline})`);
console.log(`srcDir: ${C.srcDir}`);
console.log(`regions: ${hasRegions ? C.regions.join(",") : "none"}`);
console.log(`test: ${baselineGreen ? "green" : "not-ready"} (${C.testCommand})`);
console.log(
  `typecheck: ${C.typeCheckCommand ? (typecheckOk ? "green" : "not-ready") + ` (${C.typeCheckCommand})` : "skipped"}`,
);
console.log(
  `fence: ${fenceUsable ? "present" : fenceStatus.stale ? "stale" : fencePresent ? "invalid" : "missing"} (${C.fenceArtifact})`,
);
console.log(
  `calibration: ${calibrationUsable ? "present" : calibrationStatus.stale ? "stale" : calibrationPresent ? "invalid" : "missing"} (${calibrationPath})`,
);
console.log(`proposer: ${proposerAvailable ? "available" : "missing"}`);

if (gaps.length > 0) {
  console.log(`not ready:`);
  for (const gap of gaps) console.log(`- ${gap}`);
  process.exit(2);
}

console.log(`ready`);
