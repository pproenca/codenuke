import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { nearbyTests, walk } from "./shared.js";

describe("walk", () => {
  it("returns the same sorted files for overlapping directory prefixes", async () => {
    const root = await fixtureRoot("codenuke-walk-overlap-");
    await writeFixture(root, "src/foo/a.test.ts", "test('a', () => {});\n");
    await writeFixture(root, "src/foo/nested/c.test.ts", "test('c', () => {});\n");
    await writeFixture(root, "src/bar/b.test.ts", "test('b', () => {});\n");

    await expect(walk(root, ["src/foo", "src"])).resolves.toEqual([
      "src/bar/b.test.ts",
      "src/foo/a.test.ts",
      "src/foo/nested/c.test.ts",
    ]);
  });

  it("keeps child prefixes when skipped ancestors prevent parent coverage", async () => {
    const root = await fixtureRoot("codenuke-walk-skipped-overlap-");
    await writeFixture(root, "src/generated/foo/a.test.ts", "test('a', () => {});\n");
    await writeFixture(root, "src/other.test.ts", "test('other', () => {});\n");

    const files = await walk(
      root,
      ["src/generated/foo", "src"],
      (path) => path === "src/generated",
    );

    expect(files).toEqual(["src/generated/foo/a.test.ts", "src/other.test.ts"]);
  });

  it("honors root gitignore patterns while walking", async () => {
    const root = await fixtureRoot("codenuke-walk-gitignore-");
    await writeFixture(
      root,
      ".gitignore",
      ["tmp/", "cache/", "*.log", "!important.log", "/scripts/*.gen.ts"].join("\n"),
    );
    await writeFixture(root, "cache", "keep file sharing ignored directory name\n");
    await writeFixture(root, "src/app.ts", "export const app = true;\n");
    await writeFixture(root, "tmp/cache.ts", "export const cache = true;\n");
    await writeFixture(root, "debug.log", "debug\n");
    await writeFixture(root, "important.log", "keep\n");
    await writeFixture(root, "scripts/build.gen.ts", "export const generated = true;\n");
    await writeFixture(root, "src/scripts/build.gen.ts", "export const nested = true;\n");

    await expect(walk(root, [""])).resolves.toEqual([
      ".gitignore",
      "cache",
      "important.log",
      "src/app.ts",
      "src/scripts/build.gen.ts",
    ]);
  });
});

describe("nearby tests", () => {
  it("can discover tests from indexed candidate files", async () => {
    const root = await fixtureRoot("codenuke-nearby-index-");
    await writeFixture(root, "src/app.ts", "export const app = true;\n");

    const tests = await nearbyTests(
      root,
      "src/app.ts",
      "pnpm test",
      [],
      [],
      ["src/app.test.ts", "src/other.test.ts", "docs/app.test.md"],
    );

    expect(tests).toEqual([{ path: "src/app.test.ts", command: "pnpm test" }]);
  });
});
