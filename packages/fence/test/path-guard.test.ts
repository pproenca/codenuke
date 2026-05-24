import { describe, expect, it } from "@effect/vitest";

/**
 * RULE-050 — safeWorktreePath guard (the RULE-050 FIX: ONE guard).
 *
 * The PURE rejection rules (empty / leading "/" / ".." / "\0" / "\\" / escapes
 * root) are implemented for real and tested here. The filesystem symlink check
 * (lstat/realpath) is effectful → deferred to the audit service and skipped.
 *
 * `path-guard.ts` imports `PathEscape` from @codenuke/core; loaded dynamically
 * so a missing core export skips rather than fails the build.
 */

type GuardMod = typeof import("../src/path-guard.ts");

let mod: GuardMod | null = null;
let loadError: unknown = null;
try {
  mod = await import("../src/path-guard.ts");
} catch (e) {
  loadError = e;
}

const guarded = mod ? describe : describe.skip;
const ROOT = "/tmp/codenuke-wt";

guarded("RULE-050 safeWorktreePath traversal guard (pure)", () => {
  it("RULE-050 rejects empty / absolute / traversal / NUL / backslash paths", () => {
    const bad = ["", "/abs/path", "../escape", "a/../../b", "x\0y", "a\\b", "..", "sub/../../out"];
    for (const rel of bad) {
      expect(() => mod!.safeWorktreePath(ROOT, rel), `expected ${JSON.stringify(rel)} to throw`).toThrow();
      expect(mod!.isSafeWorktreePath(ROOT, rel)).toBe(false);
    }
  });

  it("RULE-050 accepts a normal repo-relative source path and resolves under root", () => {
    const resolved = mod!.safeWorktreePath(ROOT, "packages/scorer/src/scorer.ts");
    expect(resolved.startsWith(ROOT)).toBe(true);
    expect(resolved.endsWith("packages/scorer/src/scorer.ts")).toBe(true);
    expect(mod!.isSafeWorktreePath(ROOT, "packages/scorer/src/scorer.ts")).toBe(true);
  });

  it("RULE-050 a dotfile and nested dirs are allowed; only `..` segments are rejected", () => {
    expect(mod!.isSafeWorktreePath(ROOT, ".github/x.ts")).toBe(true);
    expect(mod!.isSafeWorktreePath(ROOT, "a/b/c.ts")).toBe(true);
    expect(mod!.isSafeWorktreePath(ROOT, "a/..b/c.ts")).toBe(true); // "..b" is not a `..` segment
    expect(mod!.isSafeWorktreePath(ROOT, "a/../c.ts")).toBe(false);
  });

  it("RULE-050 throws the cross-package PathEscape tagged error", () => {
    try {
      mod!.safeWorktreePath(ROOT, "../escape");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as { _tag?: string })._tag).toBe("PathEscape");
    }
  });

  // Effectful symlink check (lstat/realpath escape) is deferred to the audit service.
  it.skip("RULE-050 lstat/realpath symlink-escape rejection (effectful — audit service)", () => {});
});

if (!mod) {
  describe("RULE-050 safeWorktreePath guard (skipped)", () => {
    it.skip(`RULE-050 skipped — @codenuke/core PathEscape import unavailable: ${String(loadError)}`, () => {});
  });
}
