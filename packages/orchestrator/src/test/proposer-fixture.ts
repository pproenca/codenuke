import { tryRun } from "@codenuke/exec";
import { proposerEnv, type ProposerAdapter } from "../main/proposer.js";

export function nodeCommandEnv(prefix: "CN_TEST" | "CN_TYPECHECK", path: string): Record<string, string> {
  return {
    [`${prefix}_FILE`]: process.execPath,
    [`${prefix}_ARGS_JSON`]: JSON.stringify([path]),
  };
}

export function scriptedProposerAdapter(scriptPath: string): ProposerAdapter {
  return {
    provider: "codex-sdk",
    async propose(request) {
      const result = await tryRun(process.execPath, [scriptPath], {
        cwd: request.worktree,
        env: proposerEnv(request),
        timeout: request.timeoutMs,
      });
      return {
        ok: result.ok,
        out: result.out,
        timedOut: result.timedOut,
        provider: "codex-sdk",
        elapsedMs: result.elapsedMs,
        commandEvents: [],
        fileChanges: [],
      };
    },
  };
}
