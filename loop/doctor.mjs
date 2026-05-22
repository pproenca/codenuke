#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "./config.mjs";

const C = loadConfig();

function runOk(command, cwd = C.repo, timeout = 30000) {
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

function commandAvailable(command) {
  if (!command) return false;
  return runOk(`command -v ${JSON.stringify(command)}`, C.repo, 5000);
}

function jsonExists(path) {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

const baselineExists = runOk(`git rev-parse --verify ${JSON.stringify(C.baseline)}`);
const baselineGreen = baselineExists && runOk(C.testCommand);
const typecheckOk = C.typeCheckCommand ? runOk(C.typeCheckCommand) : true;
const hasRegions = C.regions.length > 0;
const fencePresent = jsonExists(C.fenceArtifact);
const calibrationPath = `${C.repo}/.codenuke/calibration.json`;
const calibrationPresent = jsonExists(calibrationPath);
const proposerAvailable = process.env.CN_PROPOSER ? true : commandAvailable("claude");

const gaps = [];
if (!baselineExists) gaps.push(`baseline ${C.baseline} not found`);
if (!baselineGreen) gaps.push(`baseline test command is not green`);
if (!typecheckOk) gaps.push(`typecheck command is not green`);
if (!hasRegions) gaps.push(`no source regions detected`);
if (!fencePresent) gaps.push(`fence artifact missing`);
if (!calibrationPresent) gaps.push(`calibration missing`);
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
console.log(`fence: ${fencePresent ? "present" : "missing"} (${C.fenceArtifact})`);
console.log(`calibration: ${calibrationPresent ? "present" : "missing"} (${calibrationPath})`);
console.log(`proposer: ${proposerAvailable ? "available" : "missing"}`);

if (gaps.length > 0) {
  console.log(`not ready:`);
  for (const gap of gaps) console.log(`- ${gap}`);
  process.exit(2);
}

console.log(`ready`);
