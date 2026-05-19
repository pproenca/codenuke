import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { nodeSeeds } from "./node.js";
import { repoIndexFromFiles } from "./repo-index.js";
import { emptyTaskGraph } from "./task-graph.js";
import type { MapperContext } from "./types.js";

describe("nodeSeeds", () => {
  it("keeps associated source-group tests ordered, capped, and command-preserving", async () => {
    const root = await fixtureRoot("codenuke-node-associated-tests-");
    const files = [
      "package.json",
      "src/api/a1.test.ts",
      "src/api/a2.test.ts",
      "src/api/a3.test.ts",
      "src/api/a4.test.ts",
      "src/api/a5.test.ts",
      "src/api/a6.test.ts",
      "src/api/a7.test.ts",
      "src/api/user.ts",
      "src/domain/service.ts",
      "tests/service.test.ts",
      "tests/user.test.ts",
    ];
    await Promise.all(
      files.map((path) =>
        writeFixture(
          root,
          path,
          path === "package.json"
            ? JSON.stringify({ scripts: { test: "vitest" } })
            : "export const value = true;\n",
        ),
      ),
    );
    const context: MapperContext = {
      projects: [
        {
          root: ".",
          name: "root",
          workspaceMember: true,
          packageJsonPath: "package.json",
          packageJson: { scripts: { test: "vitest" } },
          projectJsonPath: null,
          sourceRoot: null,
          projectType: null,
          targets: {},
          packageManager: "pnpm",
          nxPackageManager: "pnpm",
        },
      ],
      repoIndex: repoIndexFromFiles(files),
      taskGraph: emptyTaskGraph(),
    };

    const sourceSeed = (await nodeSeeds(root, context)).find(
      (seed) => seed.source === "node-source-group" && seed.symbol === "src",
    );

    expect(sourceSeed?.tests).toEqual([
      { path: "src/api/a1.test.ts", command: "pnpm test" },
      { path: "src/api/a2.test.ts", command: "pnpm test" },
      { path: "src/api/a3.test.ts", command: "pnpm test" },
      { path: "src/api/a4.test.ts", command: "pnpm test" },
      { path: "src/api/a5.test.ts", command: "pnpm test" },
      { path: "src/api/a6.test.ts", command: "pnpm test" },
      { path: "src/api/a7.test.ts", command: "pnpm test" },
      { path: "tests/service.test.ts", command: "pnpm test" },
    ]);
  });
});
