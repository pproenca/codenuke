import { codexArgs, runProcessGroup } from "@codenuke/substrate";
// codexArgs: dual-execution vs legacy. Process management: integration.
import { describe, expect, it } from "vitest";
import { codexArgs as legacyCodexArgs } from "../../../../test-fixtures/legacy-loop/agent-adapter.mjs";

describe("codexArgs — dual-execution vs legacy", () => {
  const envs: Record<string, string>[] = [
    {},
    { CN_CODEX_SANDBOX: "bypass" },
    { CN_CODEX_SANDBOX: "none" },
    { CN_CODEX_SANDBOX: "read-only" },
    { CN_CODEX_SANDBOX: "  " },
    { CN_MODEL: "gpt-5" },
    { CN_REASONING_EFFORT: "high" },
    { CN_MODEL: "x", CN_REASONING_EFFORT: "medium", CN_CODEX_SANDBOX: "danger-full-access" },
  ];
  it("matches legacy across env permutations (with and without outputPath)", () => {
    for (const env of envs) {
      expect(codexArgs("/wd", { env })).toEqual(legacyCodexArgs("/wd", { env }));
      expect(codexArgs("/wd", { env, outputPath: "/out.txt" })).toEqual(
        legacyCodexArgs("/wd", { env, outputPath: "/out.txt" }),
      );
    }
  });
});

describe("runProcessGroup — integration", () => {
  it("captures output and resolves ok for a successful command", async () => {
    const r = await runProcessGroup("node", ["-e", "process.stdout.write('hi')"]);
    expect(r.ok).toBe(true);
    expect(r.out).toContain("hi");
    expect(r.timedOut).toBe(false);
  });

  it("reports failure (nonzero exit) without a timeout", async () => {
    const r = await runProcessGroup("node", ["-e", "process.exit(3)"]);
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
  });

  it("kills the group and flags timedOut on timeout", async () => {
    const r = await runProcessGroup("node", ["-e", "setInterval(() => {}, 1000)"], {
      timeout: 200,
    });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("passes input on stdin", async () => {
    const r = await runProcessGroup(
      "node",
      ["-e", "process.stdin.on('data', (d) => process.stdout.write(d))"],
      { input: "echoed" },
    );
    expect(r.out).toContain("echoed");
  });

  it("emits process start and exit progress without streaming child output", async () => {
    const progress: string[] = [];
    const r = await runProcessGroup("node", ["-e", "process.stdout.write('secret-child-output')"], {
      progress: { emit: (line) => progress.push(line) },
      progressLabel: "short task",
    });

    expect(r.ok).toBe(true);
    expect(r.out).toContain("secret-child-output");
    expect(progress).toEqual([
      expect.stringContaining("process start: short task"),
      expect.stringContaining("process exit: short task status=ok"),
    ]);
    expect(progress.join("\n")).not.toContain("secret-child-output");
  });

  it("emits heartbeat progress for a delayed command", async () => {
    const progress: string[] = [];
    const r = await runProcessGroup("node", ["-e", "setTimeout(() => {}, 80)"], {
      heartbeatMs: 10,
      progress: { emit: (line) => progress.push(line) },
      progressLabel: "slow task",
      timeout: 1000,
    });

    expect(r.ok).toBe(true);
    expect(progress.some((line) => line.includes("process still running: slow task"))).toBe(true);
    expect(progress.at(-1)).toContain("process exit: slow task status=ok");
  });
});

describe("runProcessGroup — shell-free contract", () => {
  it("does not interpret metacharacters through a shell", async () => {
    const r = await runProcessGroup("node", [
      "-e",
      "process.stdout.write(process.argv[1] ?? '')",
      "$(printf injected)",
    ]);
    expect(r.ok).toBe(true);
    expect(r.out).toBe("$(printf injected)");
  });
});
