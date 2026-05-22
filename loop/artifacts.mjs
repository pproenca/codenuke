import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function resolveRef(repo, ref) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", ref], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function fenceArtifactStatus(config) {
  const artifact = readJson(config.fenceArtifact);
  if (!artifact?.regions || typeof artifact.regions !== "object") {
    return { artifact: null, usable: false, stale: false, reason: "missing" };
  }

  const baselineSha = resolveRef(config.repo, config.baseline);
  if (artifact.baselineSha && baselineSha && artifact.baselineSha !== baselineSha) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-sha" };
  }
  if (!artifact.baselineSha && artifact.baseline && artifact.baseline !== config.baseline) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-ref" };
  }

  return { artifact, usable: true, stale: false, reason: null };
}
