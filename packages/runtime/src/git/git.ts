/**
 * Git service — all VCS IO via @effect/platform `Command` (argv, shell:false).
 *
 * Owns RULE-045 (worktree lifecycle / node_modules invariant), RULE-050
 * (`safeWorktreePath` — ONE guard), RULE-052 (git ref/pathspec safety),
 * RULE-053 (SHA reconcile, shared with orchestrator), RULE-061 (diff shortstat).
 *
 * Hardening notes (architecture §4, C8):
 *  - Subprocess `env` is an explicit ALLOWLIST (CWE-200), never full process.env.
 *  - Temp dirs via `mkdtemp` mode 0700; files 0600 + O_EXCL (CWE-377).
 *  - Every command is `Command.make("git", ...argv)` — never a shell string.
 *
 * The PURE guards (safeWorktreePath path checks, ref/pathspec validators) are
 * implemented for real and tested. The effectful worktree lifecycle is a stub
 * (`GitLive` → `Effect.die`).
 */
import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { allowlistEnv, GIT_ENV_ALLOWLIST } from "@codenuke/core"
import { Context, Data, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Local error fallback (authoritative `GitFailed` lives in @codenuke/core).
// ---------------------------------------------------------------------------
export class GitFailed extends Data.TaggedError("GitFailed")<{
  readonly command: string
  readonly message: string
}> {}

/** Path-safety failure (maps to PathEscape in the core ADT). */
export class PathEscape extends Data.TaggedError("PathEscape")<{
  readonly path: string
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// Env allowlist (CWE-200) — THE ONE allowlist lives in @codenuke/core; re-exported
// here for back-compat of git consumers. (No second copy — see RULE-050 ethos.)
// ---------------------------------------------------------------------------
export { allowlistEnv, GIT_ENV_ALLOWLIST }

// ---------------------------------------------------------------------------
// RULE-052 — git ref / pathspec safety (PURE, implemented for real).
// ---------------------------------------------------------------------------
export const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/
export const SAFE_PATH = /^[A-Za-z0-9._/-]+$/
export const SHA40 = /^[0-9a-f]{40}$/

/** A ref is safe iff it matches SAFE_REF, has no `..`, no NUL, no leading `-`. */
export const isSafeRef = (ref: string): boolean =>
  ref.length > 0 &&
  !ref.startsWith("-") &&
  !ref.includes("..") &&
  !ref.includes("\0") &&
  SAFE_REF.test(ref)

/** A pathspec is safe iff SAFE_PATH, not absolute, not `:`-prefixed, no `..`/NUL. */
export const isSafePathspec = (p: string): boolean =>
  p.length > 0 &&
  !p.startsWith("/") &&
  !p.startsWith(":") &&
  !p.startsWith("-") &&
  !p.includes("..") &&
  !p.includes("\0") &&
  SAFE_PATH.test(p)

/** A resolved object name must be a 40-hex SHA (RULE-053 reconcile precondition). */
export const isSha40 = (sha: string): boolean => SHA40.test(sha)

/** RULE-052 — assert a ref/path is safe, else fail with PathEscape. */
export const assertSafeRef = (ref: string): PathEscape | null =>
  isSafeRef(ref) ? null : new PathEscape({ path: ref, message: "unsafe git ref/path" })

export const assertSafePathspec = (p: string): PathEscape | null =>
  isSafePathspec(p) ? null : new PathEscape({ path: p, message: "unsafe git ref/path" })

// ---------------------------------------------------------------------------
// RULE-050 — safeWorktreePath: the ONE path guard (PURE half implemented).
//
// The pure string checks (empty / leading `/` / `..` / NUL / backslash) are
// implemented here for real; the filesystem half (realpath + lstat symlink
// rejection) is an Effect on the Git service (stubbed). Both the fence and the
// changecost variant must route through THIS — no second copy.
// ---------------------------------------------------------------------------
export const safeWorktreeRelPathChecks = (rel: string): PathEscape | null => {
  if (rel.length === 0) return new PathEscape({ path: rel, message: "empty path" })
  if (rel.startsWith("/")) return new PathEscape({ path: rel, message: "absolute path rejected" })
  if (rel.includes("..")) return new PathEscape({ path: rel, message: "path traversal `..` rejected" })
  if (rel.includes("\0")) return new PathEscape({ path: rel, message: "NUL byte rejected" })
  if (rel.includes("\\")) return new PathEscape({ path: rel, message: "backslash rejected" })
  return null
}

// ---------------------------------------------------------------------------
// Git service interface.
// ---------------------------------------------------------------------------
export interface ShortStat {
  readonly filesChanged: number
  readonly insertions: number
  readonly deletions: number
}

export class Git extends Context.Tag("@codenuke/runtime/Git")<
  Git,
  {
    /** RULE-045 — `git -C <repo> worktree add --detach -f <wt> <sha>`. */
    readonly worktreeAdd: (repo: string, worktree: string, sha: string) => Effect.Effect<void, GitFailed | PathEscape>
    /** RULE-045 — `worktree remove --force` → `prune` (tolerant). */
    readonly worktreeRemove: (repo: string, worktree: string) => Effect.Effect<void, GitFailed>
    /** `git reset --hard <ref>`. */
    readonly resetHard: (worktree: string, ref: string) => Effect.Effect<void, GitFailed | PathEscape>
    /** `git ls-tree -r --name-only <ref> -- <dir>` — tracked source paths at a ref. */
    readonly lsTree: (repo: string, ref: string, dir: string) => Effect.Effect<readonly string[], GitFailed | PathEscape>
    /** Stage everything + commit (no hooks) in `worktree`; returns the new commit SHA. */
    readonly commitAll: (worktree: string, message: string) => Effect.Effect<string, GitFailed>
    /** Discard all working-tree changes in `worktree` (`checkout -- .` + `clean -fd`). */
    readonly discardAll: (worktree: string) => Effect.Effect<void, GitFailed>
    /** `git update-ref <ref> <sha>` — move a ref without touching any working tree. */
    readonly updateRef: (repo: string, ref: string, sha: string) => Effect.Effect<void, GitFailed | PathEscape>
    /** `git rev-list --first-parent --max-count=<n> HEAD` — recent commit SHAs (newest first). */
    readonly revList: (repo: string, maxCount: number) => Effect.Effect<readonly string[], GitFailed>
    /** `git diff -z --name-only <refA> <refB> -- <dir>` — changed paths between two refs. */
    readonly diffNamesRange: (
      repo: string,
      refA: string,
      refB: string,
      dir: string,
    ) => Effect.Effect<readonly string[], GitFailed | PathEscape>
    /** RULE-061 — `git diff --shortstat HEAD -- <dir>`. */
    readonly diffShortStat: (worktree: string, dir: string) => Effect.Effect<ShortStat, GitFailed | PathEscape>
    /** `git diff -z --name-only HEAD -- <dir>` (changed source files). */
    readonly diffNames: (worktree: string, dir: string) => Effect.Effect<readonly string[], GitFailed | PathEscape>
    /** RULE-053 — `git rev-parse --verify --end-of-options <ref>^{commit}` → 40-hex SHA. */
    readonly resolveSha: (worktree: string, ref: string) => Effect.Effect<string, GitFailed | PathEscape>
    /** RULE-050 — full safe read of a worktree-relative file (string-checks + realpath/lstat). */
    readonly safeRead: (root: string, rel: string) => Effect.Effect<string, GitFailed | PathEscape>
    /** `git show <ref>:<rel>` — file contents at a ref; "" when absent at that ref. */
    readonly showAtRef: (repo: string, ref: string, rel: string) => Effect.Effect<string, GitFailed | PathEscape>
  }
>() {}

/**
 * RULE-061 — parse a `git diff --shortstat` line. PURE helper used by GitLive.
 * "3 files changed, 12 insertions(+), 7 deletions(-)" → {3,12,7}; missing
 * sections parse to 0.
 */
export const parseShortStat = (line: string): ShortStat => {
  const files = /(\d+) files? changed/.exec(line)
  const ins = /(\d+) insert/.exec(line)
  const del = /(\d+) delet/.exec(line)
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  }
}

/** RULE-061 — diffsize = insertions + deletions. */
export const diffSizeOf = (s: ShortStat): number => s.insertions + s.deletions

/**
 * GitLive — real read-side implementation (Slice 0).
 *
 * Every command is `Command.make("git", ...argv)` (argv, shell:false — the trust
 * boundary is the default). Reads (diff/show) + safeRead are implemented; the
 * worktree LIFECYCLE (add/remove/reset) stays stubbed for Slice 1.
 *
 * Requirements (CommandExecutor + FileSystem + Path) are captured at layer-build
 * time and provided into each method, so the service's methods present `R = never`
 * to consumers. NodeContext.layer satisfies them in the CLI.
 *
 * C8 NOTE (Slice 1): `Command.env(allowlistEnv(...))` sets the allowlisted vars but
 * does not yet CLEAR inherited env; strict clear-then-set (CWE-200) and the
 * realpath/lstat symlink half of RULE-050 land in Slice 1.
 */
export const GitLive = Layer.effect(
  Git,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const env = allowlistEnv(process.env)

    const gitString = (repo: string, args: readonly string[]): Effect.Effect<string, GitFailed> =>
      Command.string(
        Command.make("git", ...args).pipe(Command.workingDirectory(repo), Command.env(env)),
      ).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.mapError((e) => new GitFailed({ command: `git ${args.join(" ")}`, message: String(e) })),
      )

    const guardRef = (ref: string): Effect.Effect<void, PathEscape> => {
      const err = assertSafeRef(ref)
      return err ? Effect.fail(err) : Effect.void
    }
    const guardPathspec = (p: string): Effect.Effect<void, PathEscape> => {
      const err = assertSafePathspec(p)
      return err ? Effect.fail(err) : Effect.void
    }
    const guardRel = (rel: string): Effect.Effect<void, PathEscape> => {
      const err = safeWorktreeRelPathChecks(rel)
      return err ? Effect.fail(err) : Effect.void
    }

    return Git.of({
      // --- worktree lifecycle (Slice 1) ---
      // NOTE (RULE-045): node_modules linking + info/exclude hardening is a
      // follow-up; `--detach` keeps the checkout off any branch.
      worktreeAdd: (repo, worktree, sha) =>
        (isSha40(sha)
          ? Effect.void
          : Effect.fail(new GitFailed({ command: "git worktree add", message: `bad sha: ${sha}` }))
        ).pipe(
          Effect.zipRight(gitString(repo, ["worktree", "add", "--detach", "-f", worktree, sha])),
          Effect.asVoid,
        ),
      worktreeRemove: (repo, worktree) =>
        gitString(repo, ["worktree", "remove", "--force", worktree]).pipe(
          Effect.ignore,
          Effect.zipRight(gitString(repo, ["worktree", "prune"]).pipe(Effect.ignore)),
        ),
      resetHard: () => Effect.die("unimplemented: RULE-045 resetHard (Slice 1 follow-up)"),

      lsTree: (repo, ref, dir) =>
        guardRef(ref).pipe(
          Effect.zipRight(guardPathspec(dir)),
          Effect.zipRight(gitString(repo, ["ls-tree", "-r", "--name-only", ref, "--", dir])),
          Effect.map((out) =>
            out
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          ),
        ),

      commitAll: (worktree, message) =>
        gitString(worktree, ["add", "-A"]).pipe(
          Effect.zipRight(gitString(worktree, ["commit", "-m", message, "--no-verify"])),
          Effect.zipRight(gitString(worktree, ["rev-parse", "HEAD"])),
          Effect.map((s) => s.trim()),
        ),

      discardAll: (worktree) =>
        gitString(worktree, ["checkout", "--", "."]).pipe(
          Effect.zipRight(gitString(worktree, ["clean", "-fd"])),
          Effect.asVoid,
        ),

      updateRef: (repo, ref, sha) =>
        guardRef(ref).pipe(
          Effect.zipRight(gitString(repo, ["update-ref", ref, sha])),
          Effect.asVoid,
        ),

      revList: (repo, maxCount) =>
        gitString(repo, ["rev-list", "--first-parent", `--max-count=${Math.max(1, Math.floor(maxCount))}`, "HEAD"]).pipe(
          Effect.map((out) =>
            out
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          ),
        ),

      diffNamesRange: (repo, refA, refB, dir) =>
        guardRef(refA).pipe(
          Effect.zipRight(guardRef(refB)),
          Effect.zipRight(guardPathspec(dir)),
          Effect.zipRight(gitString(repo, ["diff", "-z", "--name-only", refA, refB, "--", dir])),
          Effect.map((out) => out.split("\0").filter((s) => s.length > 0)),
        ),

      // --- read side: implemented (Slice 0) ---
      diffShortStat: (repo, dir) =>
        guardPathspec(dir).pipe(
          Effect.zipRight(gitString(repo, ["diff", "--shortstat", "HEAD", "--", dir])),
          Effect.map(parseShortStat),
        ),

      diffNames: (repo, dir) =>
        guardPathspec(dir).pipe(
          Effect.zipRight(gitString(repo, ["diff", "-z", "--name-only", "HEAD", "--", dir])),
          Effect.map((out) => out.split("\0").filter((s) => s.length > 0)),
        ),

      resolveSha: (repo, ref) =>
        guardRef(ref).pipe(
          Effect.zipRight(
            gitString(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]),
          ),
          Effect.flatMap((out) => {
            const sha = out.trim()
            return isSha40(sha)
              ? Effect.succeed(sha)
              : Effect.fail(new GitFailed({ command: "git rev-parse", message: `not a sha: ${sha}` }))
          }),
        ),

      // `git show <ref>:<rel>` — "" when the file does not exist at that ref
      // (a newly-added working-tree file legitimately has no HEAD content).
      showAtRef: (repo, ref, rel) =>
        guardRef(ref).pipe(
          Effect.zipRight(guardPathspec(rel)),
          Effect.zipRight(
            gitString(repo, ["show", `${ref}:${rel}`]).pipe(Effect.orElseSucceed(() => "")),
          ),
        ),

      // RULE-050 — pure string checks now; realpath/lstat symlink rejection in Slice 1.
      safeRead: (root, rel) =>
        guardRel(rel).pipe(
          Effect.zipRight(
            fs
              .readFileString(path.join(root, rel))
              .pipe(Effect.mapError((e) => new GitFailed({ command: `read ${rel}`, message: String(e) }))),
          ),
        ),
    })
  }),
)
