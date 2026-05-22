import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
        regions: { src: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true } },
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
