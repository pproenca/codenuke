import { describe, expect, it } from "vitest";
import { codexArgs } from "./agent-adapter.mjs";

describe("Codex adapter args", () => {
  it("runs codex exec in the worktree with workspace-write sandbox by default", () => {
    expect(codexArgs("/tmp/worktree", { outputPath: "/tmp/out.txt", env: {} })).toEqual([
      "exec",
      "--cd",
      "/tmp/worktree",
      "--sandbox",
      "workspace-write",
      "--output-last-message",
      "/tmp/out.txt",
      "-",
    ]);
  });

  it("allows the sandbox, model, and reasoning effort to be configured from env", () => {
    expect(
      codexArgs("/tmp/worktree", {
        env: {
          CN_CODEX_SANDBOX: " read-only ",
          CN_MODEL: "gpt-5.5",
          CN_REASONING_EFFORT: "high",
        },
      }),
    ).toEqual([
      "exec",
      "--cd",
      "/tmp/worktree",
      "--sandbox",
      "read-only",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="high"',
      "-",
    ]);
  });

  it("can bypass Codex sandboxing when external isolation provides the boundary", () => {
    expect(
      codexArgs("/tmp/worktree", {
        env: { CN_CODEX_SANDBOX: "none" },
      }),
    ).toEqual(["exec", "--cd", "/tmp/worktree", "--dangerously-bypass-approvals-and-sandbox", "-"]);
  });
});
