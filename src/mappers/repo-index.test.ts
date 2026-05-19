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

  it("matches prefixes exactly without scanning sibling prefixes", () => {
    const index = repoIndexFromFiles([
      "src/route.ts",
      "src/routes/home.ts",
      "src/routes-admin/home.ts",
      "src/routes",
      "src/routes/deep/file.ts",
    ]);

    expect(repoFilesUnderAny(index, ["src/routes"])).toEqual([
      "src/routes",
      "src/routes/deep/file.ts",
      "src/routes/home.ts",
    ]);
  });

  it("deduplicates overlapping prefixes while preserving sorted repo order", () => {
    const index = repoIndexFromFiles([
      "docs/readme.md",
      "packages/app/src/index.ts",
      "packages/app/src/server.ts",
      "packages/app/src/server.test.ts",
      "packages/app/src/server",
      "packages/app/src/server/handler.ts",
      "packages/app/src/server/handler.test.ts",
      "packages/app/src/server.generated.ts",
      "packages/app/test/server.test.ts",
    ]);

    expect(
      repoFilesUnderAny(index, [
        "packages/app/src/server",
        "packages/app/src",
        "packages/app/src/server/",
      ]),
    ).toEqual([
      "packages/app/src/index.ts",
      "packages/app/src/server",
      "packages/app/src/server.generated.ts",
      "packages/app/src/server.test.ts",
      "packages/app/src/server.ts",
      "packages/app/src/server/handler.test.ts",
      "packages/app/src/server/handler.ts",
    ]);
  });
});
