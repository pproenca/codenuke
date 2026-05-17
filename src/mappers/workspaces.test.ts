import { describe, expect, it } from "vitest";
import {
  packageWorkspacePatterns,
  packageRootsForWorkspacePatterns,
  parsePnpmWorkspace,
} from "./workspaces.js";
import { fixtureRoot, writeFixture } from "../test-helpers.js";

describe("workspace helpers", () => {
  it("expands package and pnpm workspace patterns with excludes and unsafe paths", async () => {
    const root = await fixtureRoot("clawnuke-workspace-helpers-");
    await writeFixture(
      root,
      "package.json",
      JSON.stringify({ workspaces: { packages: ["./packages/**", "../outside/*"] } }, null, 2),
    );
    await writeFixture(root, "packages/core/package.json", JSON.stringify({ name: "core" }));
    await writeFixture(root, "packages/core/src/index.ts", "export const core = true;\n");
    await writeFixture(
      root,
      "packages/core/plugins/worker/package.json",
      JSON.stringify({ name: "worker" }),
    );
    await writeFixture(root, "packages/legacy/package.json", JSON.stringify({ name: "legacy" }));
    await writeFixture(root, "../outside/escape/package.json", JSON.stringify({ name: "escape" }));

    const patterns = [
      ...packageWorkspacePatterns({ workspaces: { packages: ["./packages/**", "../outside/*"] } }),
      ...parsePnpmWorkspace("packages:\n  - '!packages/legacy'\n"),
    ];

    await expect(packageRootsForWorkspacePatterns(root, patterns)).resolves.toEqual([
      "packages/core",
      "packages/core/plugins/worker",
    ]);
  });
});
