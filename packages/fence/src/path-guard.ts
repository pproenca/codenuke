/**
 * RULE-050 — `safeWorktreePath` traversal/symlink guard (the RULE-050 FIX: ONE
 * guard, routed through by every worktree read).
 *
 * The legacy code had TWO divergent implementations and bypassed the guard on
 * the judge's read path (CWE-22/CWE-59). The rewrite has a single guard. This
 * module implements the PURE, synchronous part of it:
 *
 *   reject if: empty, leading "/", contains "..", contains "\0", or contains
 *              "\\" (the changecost-variant hardening, now unified), then
 *   resolve(root, rel) must stay under root.
 *
 * The EFFECTFUL part — `realpath(root)` succeeds, `lstat(target)` is not a
 * symlink, `realpath(target)` stays under root — is the filesystem symlink
 * check and lives in the audit service (audit.ts), skipped in this scaffold.
 *
 * On rejection we throw the cross-package `PathEscape` tagged error (from
 * @codenuke/core) so the CLI tag→exit-code map can branch on it.
 */

import { PathEscape } from "@codenuke/core";
import * as NodePath from "node:path";

/**
 * RULE-050 — pure path-guard. Returns the resolved absolute path under `root`
 * if `rel` is safe; throws `PathEscape` otherwise.
 *
 * Pure rejection rules (no I/O):
 *   1. empty `rel`
 *   2. leading "/" (absolute)
 *   3. contains a ".." path segment (traversal)
 *   4. contains a NUL byte "\0"
 *   5. contains a backslash "\\" (Windows-separator / escape smuggling)
 *   6. `resolve(root, rel)` escapes `root` (defense-in-depth after 1–3)
 *
 * @throws {PathEscape} when `rel` violates any rule above.
 */
export const safeWorktreePath = (root: string, rel: string): string => {
  if (rel === "") throw new PathEscape({ path: rel, reason: "empty path" });
  if (rel.startsWith("/")) throw new PathEscape({ path: rel, reason: "absolute path" });
  if (rel.includes("\0")) throw new PathEscape({ path: rel, reason: "NUL byte" });
  if (rel.includes("\\")) throw new PathEscape({ path: rel, reason: "backslash" });

  // ".." as a *path segment* in either separator orientation.
  const segments = rel.split(/[/\\]/);
  if (segments.includes("..")) throw new PathEscape({ path: rel, reason: "traversal (..)" });

  const resolvedRoot = NodePath.resolve(root);
  const resolved = NodePath.resolve(resolvedRoot, rel);
  const rootWithSep = resolvedRoot.endsWith(NodePath.sep) ? resolvedRoot : resolvedRoot + NodePath.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(rootWithSep)) {
    throw new PathEscape({ path: rel, reason: "resolves outside root" });
  }

  return resolved;
};

/**
 * Non-throwing predicate form for callers that want a boolean rather than the
 * tagged error (e.g. the determinism property test). True ⇔ `rel` is safe.
 */
export const isSafeWorktreePath = (root: string, rel: string): boolean => {
  try {
    safeWorktreePath(root, rel);
    return true;
  } catch {
    return false;
  }
};
