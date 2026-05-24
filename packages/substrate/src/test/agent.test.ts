// codexArgs: dual-execution vs legacy. Process management: integration.
import { describe, expect, it } from "vitest";

import { codexArgs, runProcessGroup, runShellGroup } from "@codenuke/substrate";
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
    const r = await runProcessGroup("node", ["-e", "setInterval(() => {}, 1000)"], { timeout: 200 });
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
});

describe("runShellGroup — opt-in shell path (operator-configured proposer)", () => {
  it("runs a shell command string", async () => {
    const r = await runShellGroup("printf hello");
    expect(r.ok).toBe(true);
    expect(r.out).toContain("hello");
  });
});
