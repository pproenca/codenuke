import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "./test-helpers.js";

describe("writeFixture", () => {
  it("creates parent directories before writing nested fixture contents", async () => {
    const root = await fixtureRoot("codenuke-write-fixture-");

    await writeFixture(root, "nested/path/file.txt", "fixture contents");

    await expect(readFile(join(root, "nested/path/file.txt"), "utf8")).resolves.toBe(
      "fixture contents",
    );
  });
});
