import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  tokenize,
  lcsEditSize,
  editCost,
  verifyCost,
  buildImplementerPrompt,
} from "./changecost.mjs";

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

function initRepo(root) {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
}

function commit(root, message) {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function runChangecost(root, ref, implementer, tag) {
  const result = spawnSync("node", [cli, "changecost", ref], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CN_TEST: 'node -e "process.exit(0)"',
      CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
      CN_TAG: tag,
      CN_BETA: "0",
    },
  });
  const artifact = JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8"));
  return { result, artifact };
}

describe("edit size — formatting & comment invariant", () => {
  it("ignores whitespace and comments", () => {
    expect(tokenize("f.ts", `export const x=1*RATE;`)).toEqual(
      tokenize("f.ts", `// c\nexport const x = 1 * RATE; // trailing`),
    );
  });
  it("a reformat-only change has edit cost 0", () => {
    expect(
      editCost({ "src/m.ts": `const x=1;` }, { "src/m.ts": `// r\nconst x = 1;` }).tokens,
    ).toBe(0);
  });

  it("counts root-layout source files when srcDir is the repo root", () => {
    const result = editCost(
      { "index.ts": `export const value = 1;`, "index.test.ts": `expect(value).toBe(1);` },
      { "index.ts": `export const value = 2;`, "index.test.ts": `expect(value).toBe(2);` },
      ".",
    );

    expect(result.tokens).toBeGreaterThan(0);
    expect(result.perFile).toEqual({ "index.ts": result.tokens });
  });
});

describe("lcsEditSize", () => {
  it("counts insertions + deletions", () => {
    expect(lcsEditSize(["a", "b", "c"], ["a", "x", "c"])).toBe(2);
    expect(lcsEditSize([], ["a", "b"])).toBe(2);
  });

  it("is symmetric and zero for identical sequences", () => {
    const before = ["export", "const", "rate", "=", "1"];
    const after = ["export", "const", "rate", "=", "2", ";"];

    expect(lcsEditSize(before, before)).toBe(0);
    expect(lcsEditSize(before, after)).toBe(lcsEditSize(after, before));
  });
});

// Positive control (docs/spec.md T1): a concept duplicated k times costs ~k× to
// change. This is what makes "less code helps" true here, and editCost must capture it.
describe("edit cost scales with amplification", () => {
  const clean = `const RATE = 1.0;\nexport const a = 1 * RATE;\nexport const b = 2 * RATE;\nexport const c = 3 * RATE;`;
  const taxed = `export const a = 1 * 1.0;\nexport const b = 2 * 1.0;\nexport const c = 3 * 1.0;`;
  it("changing a deduplicated concept is cheaper than a duplicated one (~3×)", () => {
    const eClean = editCost(
      { "src/m.ts": clean },
      { "src/m.ts": clean.replace("RATE = 1.0", "RATE = 2.0") },
    ).tokens;
    const eTaxed = editCost(
      { "src/m.ts": taxed },
      { "src/m.ts": taxed.replaceAll("* 1.0", "* 2.0") },
    ).tokens;
    expect(eClean).toBeGreaterThan(0);
    expect(eTaxed).toBeGreaterThanOrEqual(eClean * 2.5);
  });
});

describe("verifyCost — safer = cheaper to verify", () => {
  const art = { regions: { cli: { p: 0.98 }, mappers: { p: 0.62 } } };
  it("low for a well-fenced region, high for a weak one, 1 for unmeasured", () => {
    expect(verifyCost(["cli"], art)).toBeCloseTo(0.02, 5);
    expect(verifyCost(["mappers"], art)).toBeCloseTo(0.38, 5);
    expect(verifyCost(["unknown"], art)).toBe(1);
  });
});

describe("change-cost implementer prompt", () => {
  it("passes the change request without leaking the hidden acceptance test body", () => {
    const prompt = buildImplementerPrompt(
      {
        prompt: "Add support for .mts files.",
        acceptPath: "src/ext.accept.test.ts",
      },
      "src",
    );

    expect(prompt).toContain("Add support for .mts files.");
    expect(prompt).toContain("src/ext.accept.test.ts");
    expect(prompt).toContain("hidden acceptance test");
    expect(prompt).not.toContain("expect(");
    expect(prompt).not.toContain("accepted = true");
  });
});

describe("codenuke changecost", () => {
  it("installs the hidden accept test after implementation and gates on it", () => {
    const root = fixtureRoot("codenuke-changecost-hidden-accept-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-hidden-accept" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      "codenuke.benchmark/value/meta.json",
      JSON.stringify({
        id: "value",
        title: "Change value",
        prompt: "Change the exported value to 2.",
        region: "src",
        acceptPath: "tests/value.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    const ref = commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-hidden-wt-${Date.now()}`);
    const implementer = join(root, "implementer.mjs");
    write(root, "implementer.mjs", "process.exit(0);\n");
    const testCommand =
      "node -e \"const fs=require('fs');const accept=fs.existsSync('tests/value.accept.test.ts');const src=fs.readFileSync('src/index.ts','utf8');process.exit(!accept || src.includes('value = 2') ? 0 : 1)\"";

    const result = spawnSync("node", [cli, "changecost", ref], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: testCommand,
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
        CN_WORKTREE: worktree,
        CN_TAG: `hidden-${Date.now()}`,
      },
    });
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("acceptance/suite RED");
    expect(artifact.results[0]).toMatchObject({ status: "not-done" });
    expect(existsSync(join(worktree, "tests/value.accept.test.ts"))).toBe(false);
    expect(existsSync(worktree)).toBe(false);
  });

  it("uses Codex as the default benchmark implementer", () => {
    const root = fixtureRoot("codenuke-changecost-default-codex-");
    const fakeBin = join(root, "fake-bin");
    const capture = join(root, "codex-args.json");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-default-codex" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      "codenuke.benchmark/value/meta.json",
      JSON.stringify({
        id: "value",
        title: "Change value",
        prompt: "Change the exported value to 2.",
        acceptPath: "tests/value.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    const ref = commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-default-codex-wt-${Date.now()}`);
    write(
      root,
      "fake-bin/codex",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex !== -1) writeFileSync(args[outputIndex + 1], "{}\\n");
writeFileSync("src/index.ts", "export const value = 2;\\n");
`,
    );
    chmodSync(join(fakeBin, "codex"), 0o755);
    const testCommand =
      "node -e \"const fs=require('fs');const accept=fs.existsSync('tests/value.accept.test.ts');const src=fs.readFileSync('src/index.ts','utf8');process.exit(!accept || src.includes('value = 2') ? 0 : 1)\"";

    const result = spawnSync("node", [cli, "changecost", ref], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        CN_TEST: testCommand,
        CN_WORKTREE: worktree,
        CN_TAG: `default-codex-${Date.now()}`,
      },
    });
    const args = JSON.parse(readFileSync(capture, "utf8"));
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("implementer=codex exec");
    expect(args).toContain("exec");
    expect(args[args.indexOf("--cd") + 1]).toBe(`${worktree}-changecost`);
    expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace-write");
    expect(artifact.results[0]).toMatchObject({ status: "done" });
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });

  it("rejects and cleans implementer edits outside non-test source", () => {
    const root = fixtureRoot("codenuke-changecost-surface-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-surface" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      "codenuke.benchmark/value/meta.json",
      JSON.stringify({
        id: "value",
        title: "Change value",
        prompt: "Change the exported value to 2.",
        region: "src",
        acceptPath: "src/value.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    const ref = commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-surface-wt-${Date.now()}`);
    const implementer = join(root, "implementer.mjs");
    write(
      root,
      "implementer.mjs",
      `
import { mkdirSync, writeFileSync } from "node:fs";
writeFileSync("src/index.ts", "export const value = 2;\\n");
mkdirSync("codenuke.benchmark/leak", { recursive: true });
writeFileSync("codenuke.benchmark/leak/meta.json", "{}\\n");
`,
    );

    const result = spawnSync("node", [cli, "changecost", ref], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
        CN_WORKTREE: worktree,
        CN_TAG: `surface-${Date.now()}`,
      },
    });
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("implementer touched outside source surface");
    expect(artifact.results[0].status).toBe("impl-bad-surface");
    expect(artifact.results[0].disallowed.join("\n")).toContain("codenuke.benchmark/leak");
    expect(existsSync(join(worktree, "codenuke.benchmark/leak/meta.json"))).toBe(false);
  });

  it("does not expose the held-out benchmark to the implementer worktree", () => {
    const root = fixtureRoot("codenuke-changecost-hidden-benchmark-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-hidden-benchmark" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      "codenuke.benchmark/value/meta.json",
      JSON.stringify({
        id: "value",
        title: "Change value",
        prompt: "Change the exported value to 2.",
        region: "src",
        acceptPath: "tests/value.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    const ref = commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-hidden-benchmark-wt-${Date.now()}`);
    const implementer = join(root, "implementer.mjs");
    write(
      root,
      "implementer.mjs",
      `
import { existsSync, writeFileSync } from "node:fs";
if (existsSync("codenuke.benchmark/value/accept.test.ts")) {
  writeFileSync("src/index.ts", "export const value = 2;\\n");
}
`,
    );
    const testCommand =
      "node -e \"const fs=require('fs');const accept=fs.existsSync('tests/value.accept.test.ts');const src=fs.readFileSync('src/index.ts','utf8');process.exit(!accept || src.includes('value = 2') ? 0 : 1)\"";

    const result = spawnSync("node", [cli, "changecost", ref], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: testCommand,
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
        CN_WORKTREE: worktree,
        CN_TAG: `hidden-benchmark-${Date.now()}`,
      },
    });
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8"));

    expect(result.status).toBe(0);
    expect(artifact.results[0]).toMatchObject({ status: "not-done" });
    expect(existsSync(worktree)).toBe(false);
  });

  it("removes the benchmark worktree when the baseline is red", () => {
    const root = fixtureRoot("codenuke-changecost-red-baseline-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-red-baseline" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      "codenuke.benchmark/value/meta.json",
      JSON.stringify({
        id: "value",
        title: "Change value",
        prompt: "Change the exported value to 2.",
        region: "src",
        acceptPath: "tests/value.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    const ref = commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-red-wt-${Date.now()}`);

    const result = spawnSync("node", [cli, "changecost", ref], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(1)"',
        CN_WORKTREE: worktree,
        CN_TAG: `red-${Date.now()}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("baseline RED");
    expect(existsSync(worktree)).toBe(false);
  });

  it("fails closed to full verification cost when the fence artifact is stale", () => {
    const root = fixtureRoot("codenuke-changecost-stale-fence-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-stale-fence" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      "codenuke.benchmark/value/meta.json",
      JSON.stringify({
        id: "value",
        title: "Change value",
        prompt: "Change the exported value to 2.",
        region: "src",
        acceptPath: "src/value.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        baselineSha: "0000000000000000000000000000000000000000",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );
    const ref = commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-stale-wt-${Date.now()}`);
    const implementer = join(root, "implementer.mjs");
    write(
      root,
      "implementer.mjs",
      'import { writeFileSync } from "node:fs";\nwriteFileSync("src/index.ts", "export const value = 2;\\n");\n',
    );

    const result = spawnSync("node", [cli, "changecost", ref], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
        CN_WORKTREE: worktree,
        CN_TAG: `stale-${Date.now()}`,
        CN_BETA: "10",
      },
    });
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8"));

    expect(result.status).toBe(0);
    expect(artifact.results[0]).toMatchObject({ status: "done", verifyFrac: 1 });
    expect(artifact.results[0].cost).toBe(artifact.results[0].editTokens + 10);
  });

  it("is deterministic with a scripted implementer and favors the deduplicated variant", () => {
    const root = fixtureRoot("codenuke-changecost-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "changecost-fixture" }));
    write(
      root,
      "src/rate.ts",
      `
export const a = 1 * 1.0;
export const b = 2 * 1.0;
export const c = 3 * 1.0;
`,
    );
    const duplicatedRef = commit(root, "duplicated");
    write(
      root,
      "src/rate.ts",
      `
const RATE = 1.0;
export const a = 1 * RATE;
export const b = 2 * RATE;
export const c = 3 * RATE;
`,
    );
    const deduplicatedRef = commit(root, "deduplicated");
    write(
      root,
      "codenuke.benchmark/rate/meta.json",
      JSON.stringify({
        id: "rate",
        title: "Change rate",
        prompt: "Change the rate from 1.0 to 2.0.",
        region: "src",
        acceptPath: "src/rate.accept.test.ts",
      }),
    );
    write(root, "codenuke.benchmark/rate/accept.test.ts", "export const accepted = true;\n");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );
    const implementer = join(root, "implementer.mjs");
    write(
      root,
      "implementer.mjs",
      `
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/rate.ts";
writeFileSync(path, readFileSync(path, "utf8").replaceAll("1.0", "2.0"));
`,
    );

    const duplicated = runChangecost(root, duplicatedRef, implementer, "dup");
    const duplicatedRepeat = runChangecost(root, duplicatedRef, implementer, "dup-repeat");
    const deduplicated = runChangecost(root, deduplicatedRef, implementer, "dedup");

    expect(duplicated.result.status).toBe(0);
    expect(duplicated.artifact.results[0]).toMatchObject({ status: "done", verifyFrac: 0 });
    expect(duplicatedRepeat.artifact.Vhat).toBe(duplicated.artifact.Vhat);
    expect(deduplicated.artifact.Vhat).toBeLessThan(duplicated.artifact.Vhat);
  });
});
