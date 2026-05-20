import { describe, expect, it } from "vitest";
import { expandPathGlob, globSegmentRegExp, pathGlobMatches, pathHasGlob } from "./path-globs.js";

describe("path glob helpers", () => {
  it("matches one path segment with star and question wildcards", () => {
    const matcher = globSegmentRegExp("pkg-*-?");

    expect(matcher.test("pkg-core-a")).toBe(true);
    expect(matcher.test("pkg--z")).toBe(true);
    expect(matcher.test("pkg-core-aa")).toBe(false);
    expect(matcher.test("pkg-core/a")).toBe(false);
  });

  it("treats regexp metacharacters as literal path text", () => {
    const matcher = globSegmentRegExp("lib.+(core)");

    expect(matcher.test("lib.+(core)")).toBe(true);
    expect(matcher.test("libXxcore")).toBe(false);
  });

  it("matches recursive double-star path patterns", () => {
    expect(pathGlobMatches("packages/**", "packages/core")).toBe(true);
    expect(pathGlobMatches("packages/**", "packages/core/plugins/worker")).toBe(true);
    expect(pathGlobMatches("packages/*", "packages/core/plugins")).toBe(false);
  });

  it("expands globs through caller-provided directory entries and acceptance checks", async () => {
    const tree = new Map<string, string[]>([
      ["", ["apps", "packages"]],
      ["apps", ["web", "docs"]],
      ["packages", ["core", "legacy"]],
      ["packages/core", ["plugin"]],
      ["packages/core/plugin", ["worker"]],
    ]);
    const packages = new Set(["apps/web", "packages/core", "packages/core/plugin/worker"]);

    await expect(
      expandPathGlob({
        pattern: "packages/**",
        entries: async (base) => tree.get(base) ?? [],
        accepts: async (path) => packages.has(path),
      }),
    ).resolves.toEqual(["packages/core", "packages/core/plugin/worker"]);
  });

  it("can keep double-star as a single segment for existing Cargo member semantics", async () => {
    const tree = new Map<string, string[]>([
      ["", ["crates"]],
      ["crates", ["core", "nested"]],
      ["crates/nested", ["inner"]],
    ]);
    const packages = new Set(["crates/core", "crates/nested/inner"]);

    await expect(
      expandPathGlob({
        pattern: "crates/**",
        recursiveDoubleStar: false,
        entries: async (base) => tree.get(base) ?? [],
        accepts: async (path) => packages.has(path),
      }),
    ).resolves.toEqual(["crates/core"]);
  });

  it("detects segment wildcard syntax", () => {
    expect(pathHasGlob("packages/*")).toBe(true);
    expect(pathHasGlob("packages/core")).toBe(false);
  });
});
