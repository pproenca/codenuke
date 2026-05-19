import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { cCppSeeds } from "./c-cpp.js";
import { repoIndexFromFiles } from "./repo-index.js";
import { emptyTaskGraph } from "./task-graph.js";
import type { MapperContext } from "./types.js";

describe("cCppSeeds", () => {
  it("keeps CMake executable and library target_sources merged with distinct seed semantics", async () => {
    const root = await fixtureRoot("codenuke-cmake-target-sources-");
    const files = [
      "CMakeLists.txt",
      "cmake/targets.cmake",
      "src/app_test.cpp",
      "src/core.cpp",
      "src/core_extra.cpp",
      "src/support.cpp",
    ];
    await writeFixture(
      root,
      "CMakeLists.txt",
      [
        "project(Demo)",
        "include(cmake/targets)",
        "add_executable(${PROJECT_NAME}_tests src/app_test.cpp)",
        "add_library(core src/core.cpp)",
      ].join("\n"),
    );
    await writeFixture(
      root,
      "cmake/targets.cmake",
      [
        "target_sources(${PROJECT_NAME}_tests PRIVATE ${PROJECT_SOURCE_DIR}/src/support.cpp)",
        "target_sources(core PRIVATE ${PROJECT_SOURCE_DIR}/src/core_extra.cpp)",
      ].join("\n"),
    );
    await writeFixture(root, "src/app_test.cpp", "int main() { return 0; }\n");
    await writeFixture(root, "src/support.cpp", "int helper() { return 1; }\n");
    await writeFixture(root, "src/core.cpp", "int core() { return 2; }\n");
    await writeFixture(root, "src/core_extra.cpp", "int core_extra() { return 3; }\n");
    const context: MapperContext = {
      projects: [],
      repoIndex: repoIndexFromFiles(files),
      taskGraph: emptyTaskGraph(),
    };

    const seeds = (await cCppSeeds(root, context)).map((seed) => ({
      source: seed.source,
      kind: seed.kind,
      entryPath: seed.entryPath,
      title: seed.title,
      tags: seed.tags,
      trustBoundaries: seed.trustBoundaries,
      ownedFiles: seed.ownedFiles,
      contextFiles: seed.contextFiles,
      tests: seed.tests,
      skipNearbyTests: seed.skipNearbyTests,
    }));

    expect(seeds).toEqual([
      {
        source: "cmake-test",
        kind: "test-suite",
        entryPath: "src/app_test.cpp",
        title: "CMake test suite Demo_tests",
        tags: ["cpp", "test"],
        trustBoundaries: [],
        ownedFiles: [
          { path: "src/app_test.cpp", reason: "target source" },
          { path: "src/support.cpp", reason: "target source" },
        ],
        contextFiles: [
          { path: "CMakeLists.txt", reason: "CMake test target declaration" },
          { path: "cmake/targets.cmake", reason: "CMake target source declaration" },
        ],
        tests: [{ path: "src/app_test.cpp", command: null }],
        skipNearbyTests: true,
      },
      {
        source: "cmake-lib",
        kind: "library",
        entryPath: "src/core.cpp",
        title: "CMake library core",
        tags: ["cpp", "library"],
        trustBoundaries: [],
        ownedFiles: [
          { path: "src/core.cpp", reason: "target source" },
          { path: "src/core_extra.cpp", reason: "target source" },
        ],
        contextFiles: [
          { path: "CMakeLists.txt", reason: "CMake target declaration" },
          { path: "cmake/targets.cmake", reason: "CMake target source declaration" },
        ],
        tests: undefined,
        skipNearbyTests: undefined,
      },
    ]);
  });
});
