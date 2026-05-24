/**
 * Subprocess environment allowlist (C8 / CWE-200). The ONE place that decides
 * which parent-process env vars are forwarded to codenuke-owned subprocesses
 * (git, the test/typecheck/implementer commands, the proposer). Shared by both
 * `@codenuke/runtime` (git, commands) and `@codenuke/fence` (the mutation
 * runner's test command) so there is a single allowlist, not a per-package copy.
 *
 * NOTE (Slice 1): `allowlistEnv` BUILDS the allowlisted env; callers still pass it
 * to `Command.env(...)`. Strict clear-then-set (so non-allowlisted inherited vars
 * are dropped at the OS boundary) is finalized when the command substrate is
 * hardened — tracked as a C8 follow-up.
 */

/** Env vars forwarded to codenuke-owned subprocesses. */
export const SUBPROCESS_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "GIT_DIR",
  "GIT_WORK_TREE",
] as const;

/** Back-compat alias (the git service historically named it this). */
export const GIT_ENV_ALLOWLIST = SUBPROCESS_ENV_ALLOWLIST;

/** Build an allowlisted env from a parent env (drops everything not allowed), plus extras. */
export const allowlistEnv = (
  parent: Record<string, string | undefined>,
  extra: Record<string, string> = {},
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of SUBPROCESS_ENV_ALLOWLIST) {
    const v = parent[key];
    if (typeof v === "string") out[key] = v;
  }
  return { ...out, ...extra };
};
