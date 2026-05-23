#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CALIBRATION_SCALES, MIN_CALIBRATION_COMMITS } from "./artifacts.mjs";
import { measure } from "./measure.mjs";
import { isSourceFile, loadConfig } from "./config.mjs";
import { quoteShellArg as quote, runCommand } from "./shell.mjs";

const C = loadConfig();

function sh(command) {
  return runCommand(command, { cwd: C.repo });
}

function trySh(command) {
  try {
    return sh(command);
  } catch {
    return "";
  }
}

function sourcePath() {
  return C.srcDir === "." ? "." : C.srcDir;
}

function filesAt(ref) {
  return trySh(`git ls-tree -r --name-only ${quote(ref)} -- ${quote(sourcePath())}`)
    .split("\n")
    .map((line) => line.trim())
    .filter(isSourceFile);
}

function showAt(ref, path) {
  try {
    return sh(`git show ${quote(ref)}:${quote(path)}`);
  } catch {
    return null;
  }
}

function snapshot(ref) {
  const files = {};
  for (const path of filesAt(ref)) {
    const content = showAt(ref, path);
    if (content !== null) files[path] = content;
  }
  return files;
}

function commitPairs() {
  return trySh(
    `git rev-list --first-parent --max-count=80 ${quote(C.baseline)} -- ${quote(sourcePath())}`,
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((commit) => {
      const parent = trySh(`git rev-list --parents -n 1 ${quote(commit)}`)
        .trim()
        .split(/\s+/u)[1];
      return parent ? [{ parent, commit }] : [];
    });
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function positiveScale(values, fallback) {
  const scale = median(values.filter((value) => value > 0));
  return scale > 0 ? scale : fallback;
}

const deltas = [];
for (const { parent, commit } of commitPairs()) {
  const before = measure(snapshot(parent));
  const after = measure(snapshot(commit));
  const delta = {
    dL: Math.abs(after.L - before.L),
    dCx: Math.abs(after.complexity - before.complexity),
    dDup: Math.abs(after.dupMass - before.dupMass),
  };
  if (delta.dL > 0 || delta.dCx > 0 || delta.dDup > 0) deltas.push(delta);
}

const enoughHistory = deltas.length >= MIN_CALIBRATION_COMMITS;
const scales = enoughHistory
  ? {
      sL: positiveScale(
        deltas.map((delta) => delta.dL),
        DEFAULT_CALIBRATION_SCALES.sL,
      ),
      sCx: positiveScale(
        deltas.map((delta) => delta.dCx),
        DEFAULT_CALIBRATION_SCALES.sCx,
      ),
      sDup: positiveScale(
        deltas.map((delta) => delta.dDup),
        DEFAULT_CALIBRATION_SCALES.sDup,
      ),
    }
  : DEFAULT_CALIBRATION_SCALES;

const artifact = {
  baseline: C.baseline,
  baselineSha: sh(`git rev-parse --verify ${quote(C.baseline)}`).trim(),
  generatedAt: new Date().toISOString(),
  commitsSampled: deltas.length,
  scales,
};

mkdirSync(`${C.repo}/.codenuke`, { recursive: true });
writeFileSync(`${C.repo}/.codenuke/calibration.json`, JSON.stringify(artifact, null, 2));

console.log(
  `calibration @ ${C.baseline} commits=${deltas.length}${enoughHistory ? "" : " fallback=defaults"} sL=${scales.sL} sCx=${scales.sCx} sDup=${scales.sDup}`,
);
