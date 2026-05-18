import { describe, expect, it } from "vitest";
import { repoFilesUnderAny, repoFilesWithAnyExtension, repoIndexFromFiles } from "./repo-index.js";

describe("repo index queries", () => {
  it("returns stable file lists for prefix and extension lookups", () => {
    const index = repoIndexFromFiles([
      "src/index.ts",
      "src/routes/home.tsx",
      "src/routes/home.test.tsx",
      "tests/index.test.ts",
      "README.md",
    ]);

    expect(repoFilesUnderAny(index, ["src/routes", "tests"])).toEqual([
      "src/routes/home.test.tsx",
      "src/routes/home.tsx",
      "tests/index.test.ts",
    ]);
    expect(repoFilesWithAnyExtension(index, [".TSX"])).toEqual([
      "src/routes/home.test.tsx",
      "src/routes/home.tsx",
    ]);
  });
});
