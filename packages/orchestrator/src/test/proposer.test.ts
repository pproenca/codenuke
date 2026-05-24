import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliProposerAdapter,
  CodexSdkProposerAdapter,
  ShellProposerAdapter,
  codexOptions,
  selectProposerAdapter,
  type ProposerRequest,
} from "../main/proposer.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0).toReversed()) {
    rmSync(root, { recursive: true, force: true });
  }
});

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "codenuke-proposer-"));
  roots.push(path);
  mkdirSync(join(path, ".codenuke"), { recursive: true });
  return path;
}

function request(repo: string): ProposerRequest {
  return {
    mode: "reduce",
    prompt: "Make one reduction",
    promptFile: join(repo, ".codenuke", "prompt.md"),
    repo,
    worktree: repo,
    regionKey: "api",
    regionTarget: "src/api/",
    timeoutMs: 30000,
    budgetUsd: "8",
    env: { ...process.env },
  };
}

describe("proposer adapter selection", () => {
  it("preserves shell override and keeps Codex CLI as the default", () => {
    expect(selectProposerAdapter({ CN_PROPOSER: "node proposer.mjs" })).toBeInstanceOf(
      ShellProposerAdapter,
    );
    expect(selectProposerAdapter({})).toBeInstanceOf(CodexCliProposerAdapter);
    expect(selectProposerAdapter({ CN_CODEX_PROVIDER: "cli" })).toBeInstanceOf(
      CodexCliProposerAdapter,
    );
    expect(selectProposerAdapter({ CN_CODEX_PROVIDER: "sdk" })).toBeInstanceOf(
      CodexSdkProposerAdapter,
    );
  });
});

describe("CodexSdkProposerAdapter", () => {
  it("passes the active region environment to the SDK client", () => {
    const repo = root();
    const options = codexOptions({
      ...request(repo),
      env: { CN_TARGET: "src", EXTRA: "kept" },
    });

    expect(options.env).toMatchObject({
      CN_REGION: "api",
      CN_TARGET: "src/api/",
      EXTRA: "kept",
    });
  });

  it("persists and resumes a thread per mode and region target", async () => {
    const repo = root();
    const started: unknown[] = [];
    const resumed: string[] = [];
    const prompts: string[] = [];
    const adapter = new CodexSdkProposerAdapter(async () => ({
      startThread(options) {
        started.push(options);
        return {
          id: "thread-started",
          async run(input) {
            prompts.push(typeof input === "string" ? input : JSON.stringify(input));
            return { items: [], finalResponse: "changed one file", usage: null };
          },
        };
      },
      resumeThread(id, options) {
        resumed.push(id);
        started.push(options);
        return {
          id,
          async run(input) {
            prompts.push(typeof input === "string" ? input : JSON.stringify(input));
            return { items: [], finalResponse: "changed one more file", usage: null };
          },
        };
      },
    }));

    const first = await adapter.propose(request(repo));
    const second = await adapter.propose(request(repo));
    const state = JSON.parse(
      readFileSync(join(repo, ".codenuke", "proposer-threads.json"), "utf8"),
    ) as {
      readonly threads: Record<string, { readonly threadId: string }>;
    };

    expect(first).toMatchObject({
      ok: true,
      provider: "codex-sdk",
      threadId: "thread-started",
      summary: "changed one file",
    });
    expect(second).toMatchObject({
      ok: true,
      provider: "codex-sdk",
      threadId: "thread-started",
      summary: "changed one more file",
    });
    expect(prompts).toEqual(["Make one reduction", "Make one reduction"]);
    expect(resumed).toEqual(["thread-started"]);
    expect(started).toHaveLength(2);
    expect(started[0]).toMatchObject({
      workingDirectory: repo,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });
    expect(state.threads["reduce:src/api"]?.threadId).toBe("thread-started");
    expect(readFileSync(join(repo, ".codenuke", "prompt.md"), "utf8")).toBe("Make one reduction");
  });

  it("reports SDK failures without creating thread state", async () => {
    const repo = root();
    const adapter = new CodexSdkProposerAdapter(async () => ({
      startThread() {
        return {
          id: "thread-started",
          async run() {
            throw new Error("sdk denied");
          },
        };
      },
      resumeThread() {
        throw new Error("unexpected resume");
      },
    }));

    const result = await adapter.propose(request(repo));

    expect(result).toMatchObject({
      ok: false,
      provider: "codex-sdk",
      out: "sdk denied",
      error: "sdk denied",
    });
    expect(existsSync(join(repo, ".codenuke", "proposer-threads.json"))).toBe(false);
  });
});
