import { describe, expect, it } from "@effect/vitest"
import {
  allowlistEnv,
  assertSafePathspec,
  assertSafeRef,
  diffSizeOf,
  GIT_ENV_ALLOWLIST,
  isSafePathspec,
  isSafeRef,
  isSha40,
  parseShortStat,
  PathEscape,
  safeWorktreeRelPathChecks,
} from "../src/git/git.ts"

describe("git — RULE-052 (ref / pathspec safety guards)", () => {
  it("RULE-052 a ref starting with '-' is unsafe", () => {
    expect(isSafeRef("-x")).toBe(false)
    expect(assertSafeRef("-x")).toBeInstanceOf(PathEscape)
  })

  it("RULE-052 a ref containing '..' or NUL is unsafe", () => {
    expect(isSafeRef("foo..bar")).toBe(false)
    expect(isSafeRef("foo\0bar")).toBe(false)
  })

  it("RULE-052 a valid branch ref is safe", () => {
    expect(isSafeRef("autoresearch/run")).toBe(true)
    expect(assertSafeRef("HEAD")).toBeNull()
  })

  it("RULE-052 an absolute or ':'-prefixed pathspec is unsafe", () => {
    expect(isSafePathspec("/abs")).toBe(false)
    expect(isSafePathspec(":/foo")).toBe(false)
    expect(isSafePathspec("a/../b")).toBe(false)
    expect(assertSafePathspec("/abs")).toBeInstanceOf(PathEscape)
  })

  it("RULE-052 a relative source pathspec is safe", () => {
    expect(isSafePathspec("src/scorer")).toBe(true)
    expect(assertSafePathspec("src/scorer")).toBeNull()
  })

  it("RULE-052 a resolved object name must be a 40-hex SHA", () => {
    expect(isSha40("0".repeat(40))).toBe(true)
    expect(isSha40("HEAD")).toBe(false)
    expect(isSha40("0".repeat(39))).toBe(false)
  })
})

describe("git — RULE-050 (safeWorktreePath string checks)", () => {
  it("RULE-050 empty / absolute / '..' / NUL / backslash are each rejected", () => {
    for (const bad of ["", "/abs", "../escape", "a\0b", "a\\b"]) {
      expect(safeWorktreeRelPathChecks(bad)).toBeInstanceOf(PathEscape)
    }
  })

  it("RULE-050 a clean relative path passes the string checks", () => {
    expect(safeWorktreeRelPathChecks("src/scorer/scorer.ts")).toBeNull()
  })
})

describe("git — RULE-061 (diff shortstat parse + diffsize)", () => {
  it("RULE-061 ' 3 files changed, 12 insertions(+), 7 deletions(-)' → diffsize 19", () => {
    const s = parseShortStat(" 3 files changed, 12 insertions(+), 7 deletions(-)")
    expect(s).toEqual({ filesChanged: 3, insertions: 12, deletions: 7 })
    expect(diffSizeOf(s)).toBe(19)
  })

  it("RULE-061 a line with only insertions parses deletions to 0", () => {
    const s = parseShortStat(" 1 file changed, 4 insertions(+)")
    expect(s.deletions).toBe(0)
    expect(diffSizeOf(s)).toBe(4)
  })
})

describe("git — env allowlist (CWE-200 hardening)", () => {
  it("allowlistEnv keeps only allowed keys and merges extras", () => {
    const out = allowlistEnv(
      { PATH: "/usr/bin", SECRET: "leak", HOME: "/home/u" },
      { GIT_DIR: "/repo/.git" },
    )
    expect(out.PATH).toBe("/usr/bin")
    expect(out.HOME).toBe("/home/u")
    expect(out.GIT_DIR).toBe("/repo/.git")
    expect("SECRET" in out).toBe(false)
    expect(GIT_ENV_ALLOWLIST).toContain("PATH")
  })
})
