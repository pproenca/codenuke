/**
 * Safe subprocess substrate for codenuke. Security remediation of
 * `legacy/codenuke/loop/shell.mjs` (CWE-78): the legacy module ran every command
 * through `execSync(commandString)` with `quoteShellArg = JSON.stringify`, which
 * does NOT neutralize shell metacharacters — `$(...)`/backticks executed.
 *
 * This substrate never builds a shell command string. Every call is
 * `spawn(file, args)` with `shell: false`, so arguments are passed to the OS
 * verbatim and can never be reinterpreted as shell syntax. There is, by design,
 * no `quoteShellArg` export and no way to run an arbitrary command string.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — Security (CWE-78), MODERNIZATION_BRIEF Phase 3
 */
import { spawn } from "node:child_process";

export interface CommandSpec {
  readonly file: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
}

/** Subset of execFile options callers need. Note: `shell` is intentionally absent. */
export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly stdio?: "ignore" | "pipe" | "inherit" | ReadonlyArray<"ignore" | "pipe" | "inherit">;
  readonly signal?: AbortSignal;
  readonly progress?: { emit(line: string): void };
  readonly progressLabel?: string;
  readonly heartbeatMs?: number;
}

/** Outcome of {@link tryRun}. */
export interface TryResult {
  readonly ok: boolean;
  /** stdout + stderr concatenated (stderr is captured on failure). */
  readonly out: string;
  /** True when the process was killed by a timeout (SIGTERM / ETIMEDOUT). */
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_HEARTBEAT_MS = 15000;

export const commandDisplay = (command: CommandSpec): string =>
  [command.file, ...(command.args ?? [])].join(" ");

function envStrings(env: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env ?? process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function mergeEnv(
  base: Record<string, string | undefined> | undefined,
  override: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return { ...envStrings(base), ...override };
}

function append(out: Buffer[], chunk: Buffer, maxBuffer: number): void {
  const current = out.reduce((sum, value) => sum + value.length, 0);
  const remaining = maxBuffer - current;
  if (remaining <= 0) {
    return;
  }
  out.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
}

async function runProcess(
  command: CommandSpec,
  options: ExecOptions = {},
): Promise<TryResult> {
  const startedAt = Date.now();
  const timeout = command.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const label = options.progressLabel ?? commandDisplay(command);
  const out: Buffer[] = [];
  let timedOut = false;
  let done = false;
  let settled = false;
  let childPid: number | undefined;

  return await new Promise<TryResult>((resolve) => {
    const finish = (result: Omit<TryResult, "elapsedMs">): void => {
      if (settled) {
        return;
      }
      settled = true;
      done = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    };
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (childPid != null) {
          process.kill(-childPid, signal);
        }
      } catch {
        try {
          if (childPid != null) {
            process.kill(childPid, signal);
          }
        } catch {
          /* already dead */
        }
      }
    };

    options.progress?.emit(`process start: ${label}`);
    const child = spawn(command.file, [...(command.args ?? [])], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: mergeEnv(options.env, command.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    childPid = child.pid;

    const abort = (): void => {
      timedOut = true;
      options.progress?.emit(`process timeout: ${label} after ${timeout}ms`);
      killGroup("SIGTERM");
      setTimeout(() => {
        if (!done) {
          killGroup("SIGKILL");
        }
      }, 1000).unref();
    };
    const timer = setTimeout(abort, timeout);
    timer.unref();
    const heartbeat = setInterval(() => {
      if (!done) {
        options.progress?.emit(`process still running: ${label} elapsed=${Date.now() - startedAt}ms`);
      }
    }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    heartbeat.unref();

    const onAbort = (): void => abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => append(out, chunk, maxBuffer));
    child.stderr.on("data", (chunk: Buffer) => append(out, chunk, maxBuffer));
    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      options.progress?.emit(`process error: ${label} ${String(error)}`);
      finish({
        ok: false,
        out: String(error),
        timedOut: false,
        exitCode: null,
        signal: null,
      });
    });
    child.on("close", (code, signal) => {
      options.signal?.removeEventListener("abort", onAbort);
      const ok = code === 0 && !timedOut;
      options.progress?.emit(
        `process exit: ${label} status=${ok ? "ok" : timedOut ? "timeout" : "failed"} elapsed=${Date.now() - startedAt}ms`,
      );
      finish({
        ok,
        out: Buffer.concat(out).toString(),
        timedOut,
        exitCode: code,
        signal,
      });
    });
  });
}

/**
 * Run `file` with `args` (no shell). Returns stdout as a string; throws on a
 * nonzero exit, like `execFileSync`. Arguments are never shell-interpreted.
 */
export async function run(
  file: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<string> {
  const result = await runProcess({ file, args }, options);
  if (!result.ok) {
    const error = new Error(result.out || `${file} exited ${result.exitCode ?? result.signal ?? "unknown"}`);
    Object.assign(error, result);
    throw error;
  }
  return result.out;
}

/**
 * Like {@link run} but never throws: returns `{ ok, out, timedOut }`. On failure
 * `out` holds the process's stdout+stderr. Mirrors the legacy `tryCommand`.
 */
export function tryRun(
  file: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<TryResult> {
  return runProcess({ file, args }, options);
}

export function tryRunCommand(
  command: CommandSpec,
  options: ExecOptions = {},
): Promise<TryResult> {
  return runProcess(command, options);
}

/**
 * True iff `file` resolves on PATH. Implemented injection-safely: `file` is
 * passed as the positional `$1` to `sh -c 'command -v -- "$1"'`, so it is data
 * the shell never parses as script. The `--` end-of-options marker stops a
 * leading-dash name (e.g. `-v`, `-p`) from being read as an option to the
 * `command` builtin — a soundness fix over the legacy probe, which returned a
 * false-positive `true` for such names. Mirrors the legacy `commandAvailable`.
 */
export async function commandAvailable(file: string, options: ExecOptions = {}): Promise<boolean> {
  if (!file) {
    return false;
  }
  return (
    await tryRun("sh", ["-c", 'command -v -- "$1"', "sh", file], {
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
    })
  ).ok;
}
