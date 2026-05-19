import { describe, expect, it } from "vitest";
import { defaultConfig } from "../platform/config.js";
import type { FeatureRecord, ProjectRecord } from "../platform/types.js";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { selectReviewGuidance } from "./guidance.js";
import { buildReviewPrompt } from "./prompt.js";

describe("guidance selection", () => {
  it("selects signal-first guidance from observable owned-code shapes", async () => {
    const root = await fixtureRoot("codenuke-guidance-selection-");
    await writeFixture(
      root,
      "src/index.ts",
      [
        "export function run(input: string, mode: string, status: string, kind: string, flag: string) {",
        "  if (mode === 'a') {",
        "    if (status === 'ready') {",
        "      const marker = input.trim();",
        "      console.log(input);",
        "      return marker;",
        "      console.log(input);",
        "    }",
        "  } else if (mode === 'b') {",
        "    const marker = input.trim();",
        "    console.log(input);",
        "    return marker;",
        "    console.log(input);",
        "  } else if (mode === 'c') {",
        "    console.log(input);",
        "  } else if (mode === 'd') {",
        "    console.log(input);",
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const selection = await selectReviewGuidance(root, feature("src/index.ts"));

    expect(selection.detectedShapes).toEqual(
      expect.arrayContaining(["long-parameter-list", "repeated-lines"]),
    );
    expect(selection.selected.map((entry) => entry.resourceId)).toEqual(
      expect.arrayContaining([
        "catalog.dispensables.duplicate-code",
        "catalog.bloaters.long-parameter-list",
        "techniques.composing-methods.extract-method",
      ]),
    );
    expect(selection.selected[0]?.reason).toContain("owned files show");
  });

  it("places selected guidance before repository file blocks in review prompts", async () => {
    const root = await fixtureRoot("codenuke-guidance-prompt-");
    await writeFixture(
      root,
      "src/index.ts",
      "export function run(a: string, b: string, c: string, d: string) { return a + b + c + d; }\n",
    );
    const prompt = await buildReviewPrompt(
      root,
      project(root),
      feature("src/index.ts"),
      defaultConfig(),
    );

    expect(prompt).toContain("Selected refactoring guidance:");
    expect(prompt.indexOf("Selected refactoring guidance:")).toBeLessThan(
      prompt.indexOf("Files:\n--- src/index.ts"),
    );
    expect(prompt).toContain("guidance.applied entries");
  });
});

function feature(path: string): FeatureRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    featureId: "feat_guidance",
    title: "Guidance fixture",
    summary: "Guidance fixture",
    kind: "library",
    source: "test",
    confidence: "high",
    entrypoints: [{ path, symbol: null, route: null, command: null }],
    ownedFiles: [{ path, reason: "fixture" }],
    contextFiles: [],
    tests: [],
    tags: [],
    trustBoundaries: [],
    status: "pending",
    lock: null,
    findingIds: [],
    patchAttemptIds: [],
    analysisHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

function project(root: string): ProjectRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    projectId: "proj_guidance",
    name: "guidance",
    rootPath: root,
    git: { remoteUrl: null, defaultBranch: null, currentBranch: null, headSha: null },
    detected: {
      languages: ["typescript"],
      frameworks: [],
      packageManagers: [],
      commands: { typecheck: null, lint: null, format: null, test: null },
    },
    createdAt: now,
    updatedAt: now,
  };
}
