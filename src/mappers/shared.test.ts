import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../test-helpers.js";
import { walk } from "./shared.js";

describe("walk", () => {
  it("returns the same sorted files for overlapping directory prefixes", async () => {
    const root = await fixtureRoot("clawnuke-walk-overlap-");
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
    const root = await fixtureRoot("clawnuke-walk-skipped-overlap-");
    await writeFixture(root, "src/generated/foo/a.test.ts", "test('a', () => {});\n");
    await writeFixture(root, "src/other.test.ts", "test('other', () => {});\n");

    const files = await walk(
      root,
      ["src/generated/foo", "src"],
      (path) => path === "src/generated",
    );

    expect(files).toEqual(["src/generated/foo/a.test.ts", "src/other.test.ts"]);
  });
});
