/**
 * Proposer process management. Migrated from `legacy/codenuke/loop/agent-adapter.mjs`.
 * Spawns the proposer in its own detached process group so a timeout kills the whole
 * tree (SIGTERM → SIGKILL after 1s). The default codex path uses an arg-array (no
 * shell); `runShellGroup` is the explicit opt-in for an operator-configured
 * `CN_PROPOSER` command string (trusted config, per the trusted-repos-only decision).
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-046 (proposer isolation), RULE-047
 */
import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly ok: boolean;
  readonly out: string;
  readonly timedOut: boolean;
}

export interface ProgressReporter {
  emit(line: string): void;
}

export interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
  readonly timeout?: number;
  readonly input?: string;
  readonly progress?: ProgressReporter;
  readonly progressLabel?: string;
  readonly heartbeatMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 15000;

/** Run a command in its own process group; returns captured output, kills the group on timeout. */
export function runProcessGroup(
  command: string,
  args: readonly string[] = [],
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const label = opts.progressLabel ?? (opts.shell ? "shell command" : command);
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      detached: true,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const timeout = opts.timeout ?? 300000;
    const startedAt = Date.now();
    let done = false;
    let timedOut = false;
    opts.progress?.emit(`process start: ${label}`);
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid != null) {
          process.kill(-child.pid, signal);
        }
      } catch {
        /* already dead */
      }
    };
    const heartbeat = setInterval(() => {
      if (!done) {
        opts.progress?.emit(`process still running: ${label} elapsed=${Date.now() - startedAt}ms`);
      }
    }, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    heartbeat.unref();
    const timer = setTimeout(() => {
      timedOut = true;
      opts.progress?.emit(`process timeout: ${label} after ${timeout}ms`);
      killGroup("SIGTERM");
      setTimeout(() => {
        if (!done) {
          killGroup("SIGKILL");
        }
      }, 1000).unref();
    }, timeout);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", (error) => {
      done = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      opts.progress?.emit(`process error: ${label} ${String(error)}`);
      resolve({ ok: false, out: String(error), timedOut: false });
    });
    child.on("close", (code) => {
      done = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (code !== 0 && !timedOut) {
        killGroup("SIGTERM");
      }
      opts.progress?.emit(
        `process exit: ${label} status=${code === 0 && !timedOut ? "ok" : timedOut ? "timeout" : "failed"} elapsed=${Date.now() - startedAt}ms`,
      );
      resolve({ ok: code === 0 && !timedOut, out: Buffer.concat(out).toString(), timedOut });
    });
    if (opts.input != null) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Opt-in shell path for an operator-configured `CN_PROPOSER` command string. */
export const runShellGroup = (cmd: string, opts: ProcessOptions = {}): Promise<ProcessResult> =>
  runProcessGroup(cmd, [], {
    ...opts,
    shell: true,
    progressLabel: opts.progressLabel ?? "shell command",
  });

/** Build the `codex exec` CLI args from environment (sandbox, model, reasoning effort). */
export function codexArgs(
  cwd: string,
  options: { env?: NodeJS.ProcessEnv; outputPath?: string } = {},
): string[] {
  const env = options.env ?? process.env;
  const args = ["exec", "--cd", cwd];
  const sandbox = env.CN_CODEX_SANDBOX?.trim();
  if (sandbox === "bypass" || sandbox === "none") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", sandbox && sandbox.length > 0 ? sandbox : "workspace-write");
  }
  if (env.CN_MODEL) {
    args.push("--model", env.CN_MODEL);
  }
  if (env.CN_REASONING_EFFORT) {
    args.push("-c", `model_reasoning_effort="${env.CN_REASONING_EFFORT}"`);
  }
  if (options.outputPath) {
    args.push("--output-last-message", options.outputPath);
  }
  args.push("-");
  return args;
}

/** Run the codex proposer with the prompt on stdin (arg-array, no shell). */
export function runCodexAgent(
  prompt: string,
  opts: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    outputPath?: string;
    progress?: ProgressReporter;
    progressLabel?: string;
    heartbeatMs?: number;
  },
): Promise<ProcessResult> {
  return runProcessGroup("codex", codexArgs(opts.cwd, opts), {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeout,
    input: prompt,
    progress: opts.progress,
    progressLabel: opts.progressLabel ?? "codex proposer",
    heartbeatMs: opts.heartbeatMs,
  });
}
