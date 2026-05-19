import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { nodeSeeds } from "./node.js";
import { repoIndexFromFiles } from "./repo-index.js";
import { emptyTaskGraph } from "./task-graph.js";
import type { MapperContext } from "./types.js";

describe("nodeSeeds", () => {
  it("chunks oversized semantic source buckets with sorted file slices", async () => {
    const root = await fixtureRoot("codenuke-node-semantic-chunks-");
    const sourceFiles = [
      "src/config-zeta.ts",
      "src/config-alpha.ts",
      "src/config-beta.ts",
      "src/config-delta.ts",
      "src/config-epsilon.ts",
      "src/config-eta.ts",
      "src/config-gamma.ts",
      "src/config-iota.ts",
      "src/config-kappa.ts",
      "src/config-lambda.ts",
      "src/config-mu.ts",
      "src/config-nu.ts",
      "src/config-theta.ts",
    ];
    const files = ["package.json", ...sourceFiles];
    await Promise.all(
      files.map((path) =>
        writeFixture(
          root,
          path,
          path === "package.json" ? JSON.stringify({ scripts: { test: "vitest" } }) : "",
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

    const semanticGroups = (await nodeSeeds(root, context))
      .filter((seed) => seed.source === "node-source-group")
      .map((seed) => ({
        symbol: seed.symbol,
        ownedFiles: seed.ownedFiles?.map((file) => file.path),
      }));

    expect(semanticGroups).toEqual([
      {
        symbol: "src/:config#1",
        ownedFiles: [
          "src/config-alpha.ts",
          "src/config-beta.ts",
          "src/config-delta.ts",
          "src/config-epsilon.ts",
          "src/config-eta.ts",
          "src/config-gamma.ts",
          "src/config-iota.ts",
          "src/config-kappa.ts",
          "src/config-lambda.ts",
          "src/config-mu.ts",
          "src/config-nu.ts",
          "src/config-theta.ts",
        ],
      },
      {
        symbol: "src/:config#2",
        ownedFiles: ["src/config-zeta.ts"],
      },
    ]);
  });

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

  it("keeps Rails app JavaScript sources while excluding Rails assets", async () => {
    const root = await fixtureRoot("codenuke-node-rails-package-");
    const files = [
      "Gemfile",
      "app/assets/application.js",
      "app/javascript/controllers/menu.ts",
      "app/javascript/controllers/menu.test.ts",
      "config/application.rb",
      "package.json",
      "src/server.ts",
      "tests/server.test.ts",
    ];
    await Promise.all(
      files.map((path) =>
        writeFixture(
          root,
          path,
          path === "Gemfile"
            ? 'source "https://rubygems.org"\ngem "rails"\n'
            : path === "package.json"
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

    const sourceSeeds = (await nodeSeeds(root, context)).filter(
      (seed) => seed.source === "node-source-group",
    );
    const ownedPaths = sourceSeeds.flatMap(
      (seed) => seed.ownedFiles?.map((file) => file.path) ?? [],
    );

    expect(ownedPaths).toEqual(["src/server.ts", "app/javascript/controllers/menu.ts"]);
    expect(sourceSeeds.find((seed) => seed.symbol === "src")?.tests).toEqual([
      { path: "tests/server.test.ts", command: "pnpm test" },
    ]);
  });
});
