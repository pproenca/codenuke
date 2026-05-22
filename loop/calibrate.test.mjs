import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../bin/codenuke.mjs", import.meta.url));

function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
}

function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function commit(root, message) {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
}

function initRepo(root) {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
}

function runCalibrate(root) {
  const result = spawnSync("node", [cli, "calibrate"], {
    cwd: root,
    encoding: "utf8",
  });
  const artifact = JSON.parse(readFileSync(join(root, ".codenuke/calibration.json"), "utf8"));
  return { result, artifact };
}

describe("codenuke calibrate", () => {
  it("writes positive deterministic value scales", () => {
    const root = fixtureRoot("codenuke-calibrate-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "calibrate-fixture" }));
    write(root, "src/index.ts", "export const one = () => 1;\n");
    commit(root, "initial");
    write(root, "src/index.ts", "export const one = () => 1;\nexport const two = () => 2;\n");
    commit(root, "add two");

    const first = runCalibrate(root);
    const second = runCalibrate(root);

    expect(first.result.status).toBe(0);
    expect(first.artifact.baseline).toBe("HEAD");
    expect(first.artifact.baselineSha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.artifact.commitsSampled).toBeGreaterThanOrEqual(1);
    if (first.artifact.commitsSampled < 3) {
      expect(first.artifact.scales).toEqual({ sL: 150, sCx: 15, sDup: 5 });
    }
    expect(first.artifact.scales.sL).toBeGreaterThan(0);
    expect(first.artifact.scales.sCx).toBeGreaterThan(0);
    expect(first.artifact.scales.sDup).toBeGreaterThan(0);
    expect(second.artifact.scales).toEqual(first.artifact.scales);
  });
});
