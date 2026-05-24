/**
 * Safe subprocess substrate for codenuke. Security remediation of
 * `legacy/codenuke/loop/shell.mjs` (CWE-78): the legacy module ran every command
 * through `execSync(commandString)` with `quoteShellArg = JSON.stringify`, which
 * does NOT neutralize shell metacharacters — `$(...)`/backticks executed.
 *
 * This substrate never builds a shell command string. Every call is
 * `execFile(file, args)` with `shell: false`, so arguments are passed to the OS
 * verbatim and can never be reinterpreted as shell syntax. There is, by design,
 * no `quoteShellArg` export and no way to run an arbitrary command string.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — Security (CWE-78), MODERNIZATION_BRIEF Phase 3
 */
import { execFileSync } from "node:child_process";

/** Subset of execFile options callers need. Note: `shell` is intentionally absent. */
export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly stdio?: "ignore" | "pipe" | "inherit" | ReadonlyArray<"ignore" | "pipe" | "inherit">;
}

/** Outcome of {@link tryRun}. */
export interface TryResult {
  readonly ok: boolean;
  /** stdout + stderr concatenated (stderr is captured on failure). */
  readonly out: string;
  /** True when the process was killed by a timeout (SIGTERM / ETIMEDOUT). */
  readonly timedOut: boolean;
}

type NodeExecOptions = Parameters<typeof execFileSync>[2];
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Run `file` with `args` (no shell). Returns stdout as a string; throws on a
 * nonzero exit, like `execFileSync`. Arguments are never shell-interpreted.
 */
export function run(file: string, args: readonly string[], options: ExecOptions = {}): string {
  const result = execFileSync(file, [...args], {
    maxBuffer: DEFAULT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
    shell: false,
  } as NodeExecOptions);
  return result ? result.toString() : "";
}

/**
 * Like {@link run} but never throws: returns `{ ok, out, timedOut }`. On failure
 * `out` holds the process's stdout+stderr. Mirrors the legacy `tryCommand`.
 */
export function tryRun(
  file: string,
  args: readonly string[],
  options: ExecOptions = {},
): TryResult {
  try {
    return { ok: true, out: run(file, args, options), timedOut: false };
  } catch (error) {
    const e = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      signal?: string;
      code?: string;
    };
    return {
      ok: false,
      out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? ""),
      timedOut: e.signal === "SIGTERM" || e.code === "ETIMEDOUT",
    };
  }
}

/**
 * True iff `file` resolves on PATH. Implemented injection-safely: `file` is
 * passed as the positional `$1` to `sh -c 'command -v -- "$1"'`, so it is data
 * the shell never parses as script. The `--` end-of-options marker stops a
 * leading-dash name (e.g. `-v`, `-p`) from being read as an option to the
 * `command` builtin — a soundness fix over the legacy probe, which returned a
 * false-positive `true` for such names. Mirrors the legacy `commandAvailable`.
 */
export function commandAvailable(file: string, options: ExecOptions = {}): boolean {
  if (!file) {
    return false;
  }
  return tryRun("sh", ["-c", 'command -v -- "$1"', "sh", file], {
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
  }).ok;
}
