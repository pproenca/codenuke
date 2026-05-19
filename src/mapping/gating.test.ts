import { describe, expect, it } from "vitest";
import { detectProject } from "../platform/detect.js";
import { mapFeatures } from "./heuristic.js";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";

describe("mapper gating", () => {
  it("only runs mapper families whose repository signals are present", async () => {
    const root = await fixtureRoot("codenuke-map-gated-mappers-");
    await writeFixture(root, "package.json", JSON.stringify({ name: "fixture-app" }, null, 2));
    await writeFixture(root, "src/index.ts", "export const value = 1;\n");

    const project = await detectProject(root);
    const started: string[] = [];
    await mapFeatures(root, project, [], {
      onProgress: (event) => {
        if (event.event === "mapper-start") {
          started.push(event.mapper);
        }
      },
    });

    expect(started).toEqual(["node", "config"]);
  });
});
