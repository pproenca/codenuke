import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../bin/codenuke.mjs", import.meta.url));

async function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

async function write(root, path, contents) {
  const absolute = join(root, path);
  await mkdir(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
}

function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

describe("codenuke fence", () => {
  it("keys a flat src artifact to the src region and scans src files", async () => {
    const root = await fixtureRoot("codenuke-fence-flat-");
    await write(root, "package.json", JSON.stringify({ name: "fence-flat" }));
    await write(
      root,
      "src/index.ts",
      "export const isLower = (left: number, right: number) => left < right;\n",
    );
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test User"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "initial"]);

    const result = spawnSync("node", [cli, "fence", "5", "123"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TAG: `flat-${Date.now()}`,
      },
    });

    expect(result.status).toBe(0);
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/fence-fidelity.json"), "utf8"));
    expect(Object.keys(artifact.regions)).toEqual(["src"]);
    expect(artifact.regions.src.total).toBeGreaterThan(0);
  });

  it("rejects replay when source changed instead of tests only", async () => {
    const root = await fixtureRoot("codenuke-fence-replay-source-");
    await write(root, "package.json", JSON.stringify({ name: "fence-replay-source" }));
    await write(
      root,
      "src/index.ts",
      "export const isLower = (left: number, right: number) => left < right;\n",
    );
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test User"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "initial"]);
    const originalArtifact = {
      baseline: "HEAD",
      generatedAt: "2026-05-22T00:00:00.000Z",
      method: "ast-aware",
      threshold: 0.9,
      capPerRegion: 60,
      seed: 1337,
      regions: {
        src: {
          caught: 0,
          total: 1,
          p: 0,
          lo: 0,
          hi: 1,
          admissible: false,
          survivorSpecs: [{ rel: "src/index.ts", start: 64, end: 65, repl: ">", op: "<→>" }],
        },
      },
    };
    await write(root, ".codenuke/fence-fidelity.json", JSON.stringify(originalArtifact));
    await write(
      root,
      "src/index.ts",
      "export const isLower = (left: number, right: number) => left <= right;\n",
    );

    const result = spawnSync("node", [cli, "fence", "replay", "src", root], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("source changed");
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/fence-fidelity.json"), "utf8"));
    expect(artifact.regions.src).toEqual(originalArtifact.regions.src);
  });

  it("replays prior survivors monotonically when source is unchanged", async () => {
    const root = await fixtureRoot("codenuke-fence-replay-monotone-");
    const source = "export const isLower = (left: number, right: number) => left < right;\n";
    await write(root, "package.json", JSON.stringify({ name: "fence-replay-monotone" }));
    await write(root, "src/index.ts", source);
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test User"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "initial"]);
    const start = source.indexOf("<");
    await write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 0,
            total: 1,
            p: 0,
            lo: 0,
            hi: 1,
            admissible: false,
            survivorSpecs: [{ rel: "src/index.ts", start, end: start + 1, repl: ">", op: "<→>" }],
          },
        },
      }),
    );

    const result = spawnSync("node", [cli, "fence", "replay", "src", root], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: `node -e "const fs=require('fs');process.exit(fs.readFileSync('src/index.ts','utf8').includes(' > ')?1:0)"`,
      },
    });

    expect(result.status).toBe(0);
    const artifact = JSON.parse(readFileSync(join(root, ".codenuke/fence-fidelity.json"), "utf8"));
    expect(artifact.regions.src.total).toBe(1);
    expect(artifact.regions.src.caught).toBe(1);
    expect(artifact.regions.src.lo).toBeGreaterThan(0);
    expect(artifact.regions.src.survivorSpecs).toEqual([]);
  });
});
