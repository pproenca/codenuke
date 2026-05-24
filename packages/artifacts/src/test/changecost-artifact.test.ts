import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeCostArtifactStatus } from "@codenuke/artifacts";
import { wilson } from "@codenuke/stats";
import { afterAll, describe, expect, it } from "vitest";

const created: string[] = [];

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "cn-changecost-artifact-"));
  created.push(dir);
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  return { dir, head };
}

function writeArtifact(dir: string, artifact: unknown): void {
  mkdirSync(join(dir, ".codenuke"), { recursive: true });
  writeFileSync(join(dir, ".codenuke", "changecost.json"), JSON.stringify(artifact, null, 2));
}

function writeFenceArtifact(dir: string, head: string): void {
  const region = wilson(8, 10);
  const fenceRegion = {
    caught: 8,
    total: 10,
    p: region.p,
    lo: region.lo,
    hi: region.hi,
    admissible: region.lo >= 0.9,
    survivorSpecs: [
      { rel: "src/a.ts", start: 0, end: 1, repl: "x", op: "survivor-1" },
      { rel: "src/b.ts", start: 0, end: 1, repl: "x", op: "survivor-2" },
    ],
  };
  mkdirSync(join(dir, ".codenuke"), { recursive: true });
  writeFileSync(
    join(dir, ".codenuke", "fence-fidelity.json"),
    JSON.stringify(
      {
        baseline: "HEAD",
        baselineSha: head,
        generatedAt: new Date().toISOString(),
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          parser: fenceRegion,
          runner: fenceRegion,
          config: fenceRegion,
        },
      },
      null,
      2,
    ),
  );
}

const cfg = (dir: string) => ({
  repo: dir,
  baseline: "HEAD",
  fenceArtifact: join(dir, ".codenuke", "fence-fidelity.json"),
  thresholds: { fenceLB: 0.9 },
});

function validChangeCostArtifact() {
  return {
    schemaVersion: 1,
    ref: "HEAD",
    beta: 60,
    Vhat: 38,
    done: 2,
    total: 4,
    results: [
      {
        id: "add-parser",
        status: "done",
        editTokens: 18,
        filesTouched: 1,
        regions: ["parser"],
        verifyFrac: 0.2,
        cost: 30,
      },
      {
        id: "wire-cache",
        status: "impl-fail",
      },
      {
        id: "tighten-gate",
        status: "not-done",
      },
      {
        id: "split-runner",
        status: "done",
        editTokens: 34,
        filesTouched: 2,
        regions: ["runner", "config"],
        verifyFrac: 0.2,
        cost: 46,
      },
    ],
  };
}

const updateResult = (
  artifact: ReturnType<typeof validChangeCostArtifact>,
  id: string,
  update: Record<string, unknown>,
) =>
  artifact.results.map((result) => (result.id === id ? Object.assign({}, result, update) : result));

async function expectInvalid(artifact: unknown): Promise<void> {
  const { dir, head } = makeRepo();
  writeFenceArtifact(dir, head);
  writeArtifact(dir, artifact);
  const status = await changeCostArtifactStatus(cfg(dir));
  expect(status.usable).toBe(false);
  expect(status.reason).toBe("invalid");
}

describe("changeCostArtifactStatus", () => {
  it("is missing when .codenuke/changecost.json does not exist", async () => {
    const { dir } = makeRepo();
    const status = await changeCostArtifactStatus(cfg(dir));
    expect(status.artifact).toBeNull();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("missing");
  });

  it("is usable for a schemaVersion 1 report whose derived values match", async () => {
    const { dir, head } = makeRepo();
    writeFenceArtifact(dir, head);
    writeArtifact(dir, validChangeCostArtifact());
    const status = await changeCostArtifactStatus(cfg(dir));
    expect(status.usable).toBe(true);
    expect(status.reason).toBeNull();
  });

  it("accepts Vhat=null when no benchmark rows complete", async () => {
    const { dir } = makeRepo();
    writeArtifact(dir, {
      schemaVersion: 1,
      ref: "HEAD",
      beta: 60,
      Vhat: null,
      done: 0,
      total: 2,
      results: [
        { id: "wire-cache", status: "impl-fail" },
        { id: "tighten-gate", status: "not-done" },
      ],
    });
    const status = await changeCostArtifactStatus(cfg(dir));
    expect(status.usable).toBe(true);
    expect(status.reason).toBeNull();
  });

  it("uses the runtime no-fence fallback verifyFrac of 1", async () => {
    const { dir } = makeRepo();
    writeArtifact(dir, {
      schemaVersion: 1,
      ref: "HEAD",
      beta: 60,
      Vhat: 78,
      done: 1,
      total: 1,
      results: [
        {
          id: "add-parser",
          status: "done",
          editTokens: 18,
          filesTouched: 1,
          regions: ["parser"],
          verifyFrac: 1,
          cost: 78,
        },
      ],
    });
    const status = await changeCostArtifactStatus(cfg(dir));
    expect(status.usable).toBe(true);
    expect(status.reason).toBeNull();
  });

  it("rejects an otherwise valid unversioned report", async () => {
    const { schemaVersion: _schemaVersion, ...unversioned } = validChangeCostArtifact();
    await expectInvalid(unversioned);
  });

  it("rejects malformed result rows", async () => {
    await expectInvalid({
      ...validChangeCostArtifact(),
      results: [
        {
          id: "add-parser",
          status: "done",
          editTokens: 18,
          filesTouched: 1,
          regions: "parser",
          verifyFrac: 0.2,
          cost: 30,
        },
      ],
      done: 1,
      total: 1,
      Vhat: 30,
    });
  });

  it("rejects reports whose total does not match the number of results", async () => {
    await expectInvalid({ ...validChangeCostArtifact(), total: 99 });
  });

  it("rejects reports whose Vhat is not the mean of done result costs", async () => {
    await expectInvalid({ ...validChangeCostArtifact(), Vhat: 37 });
  });

  it("rejects reports whose done count is not recomputed from done results", async () => {
    await expectInvalid({ ...validChangeCostArtifact(), done: 3 });
  });

  it("rejects done rows whose cost does not equal editTokens + beta * verifyFrac", async () => {
    const artifact = validChangeCostArtifact();
    await expectInvalid({
      ...artifact,
      results: updateResult(artifact, "add-parser", { cost: 31 }),
    });
  });

  it("rejects done rows whose verifyFrac is not derived from the current fence", async () => {
    const artifact = validChangeCostArtifact();
    await expectInvalid({
      ...artifact,
      Vhat: 32,
      results: updateResult(artifact, "add-parser", { verifyFrac: 0, cost: 18 }),
    });
  });

  it("rejects invalid numeric beta, Vhat, and replay values", async () => {
    const artifact = validChangeCostArtifact();
    for (const invalid of [
      { ...artifact, beta: "60" },
      { ...artifact, Vhat: "38" },
      { ...artifact, results: updateResult(artifact, "add-parser", { verifyFrac: -0.1 }) },
      { ...artifact, results: updateResult(artifact, "add-parser", { verifyFrac: 1.1 }) },
      { ...artifact, results: updateResult(artifact, "add-parser", { editTokens: 18.5 }) },
    ]) {
      await expectInvalid(invalid);
    }
  });

  it("rejects unknown result status values", async () => {
    const artifact = validChangeCostArtifact();
    await expectInvalid({
      ...artifact,
      results: artifact.results.map((result) =>
        result.id === "wire-cache" ? Object.assign({}, result, { status: "skipped" }) : result,
      ),
    });
  });
});
