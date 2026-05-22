import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, regionOf } from "./config.mjs";

async function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

async function write(root, path, contents) {
  const absolute = join(root, path);
  await mkdir(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
}

describe("zero-config source region detection", () => {
  it("uses the flat source directory as the single region when source exists directly under src", async () => {
    const root = await fixtureRoot("codenuke-flat-src-");
    await write(root, "src/index.ts", "export const run = () => true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe("src");
    expect(config.regions).toEqual(["src"]);
  });

  it("detects the first conventional source directory that contains source", async () => {
    const root = await fixtureRoot("codenuke-lib-src-");
    await write(root, "lib/index.ts", "export const run = () => true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe("lib");
    expect(config.regions).toEqual(["lib"]);
  });

  it("detects app and source conventional directories", async () => {
    const appRoot = await fixtureRoot("codenuke-app-src-");
    await write(appRoot, "app/index.ts", "export const app = true;\n");
    expect(loadConfig({}, appRoot).srcDir).toBe("app");
    expect(loadConfig({}, appRoot).regions).toEqual(["app"]);

    const sourceRoot = await fixtureRoot("codenuke-source-src-");
    await write(sourceRoot, "source/index.ts", "export const source = true;\n");
    expect(loadConfig({}, sourceRoot).srcDir).toBe("source");
    expect(loadConfig({}, sourceRoot).regions).toEqual(["source"]);
  });

  it("uses the repo root as the region when source exists only at the root", async () => {
    const root = await fixtureRoot("codenuke-root-src-");
    await write(root, "index.ts", "export const root = true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe(".");
    expect(config.regions).toEqual(["."]);
  });

  it("uses tsconfig rootDir before conventional source directories", async () => {
    const root = await fixtureRoot("codenuke-tsconfig-root-");
    await write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "custom" } }));
    await write(root, "custom/index.ts", "export const custom = true;\n");
    await write(root, "src/index.ts", "export const conventional = true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe("custom");
    expect(config.regions).toEqual(["custom"]);
  });

  it("uses tsconfig include globs before conventional source directories", async () => {
    const root = await fixtureRoot("codenuke-tsconfig-include-");
    await write(root, "tsconfig.json", JSON.stringify({ include: ["custom/**/*.ts"] }));
    await write(root, "custom/index.ts", "export const custom = true;\n");
    await write(root, "src/index.ts", "export const conventional = true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe("custom");
    expect(config.regions).toEqual(["custom"]);
  });

  it("uses package.json source hints before conventional source directories", async () => {
    const root = await fixtureRoot("codenuke-package-source-");
    await write(root, "package.json", JSON.stringify({ source: "custom/index.ts" }));
    await write(root, "custom/index.ts", "export const custom = true;\n");
    await write(root, "src/index.ts", "export const conventional = true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe("custom");
    expect(config.regions).toEqual(["custom"]);
  });

  it("does not let package bin paths override a conventional source directory", async () => {
    const root = await fixtureRoot("codenuke-package-bin-");
    await write(root, "package.json", JSON.stringify({ bin: { tool: "bin/tool.mjs" } }));
    await write(root, "bin/tool.mjs", "export const cli = true;\n");
    await write(root, "src/index.ts", "export const source = true;\n");

    const config = loadConfig({}, root);

    expect(config.srcDir).toBe("src");
    expect(config.regions).toEqual(["src"]);
  });
});

describe("region keys", () => {
  it("maps files directly under a flat source directory to the source-directory region", () => {
    expect(regionOf("src/index.ts", "src")).toBe("src");
  });

  it("maps nested source files to their immediate child region", () => {
    expect(regionOf("src/cli/main.ts", "src")).toBe("cli");
  });

  it("maps root source files to the root region", () => {
    expect(regionOf("index.ts", ".")).toBe(".");
  });
});

describe("zero-config test command detection", () => {
  it("detects local mocha as a terminating single-run test command", async () => {
    const root = await fixtureRoot("codenuke-mocha-test-");
    await write(root, "src/index.ts", "export const run = () => true;\n");
    await write(root, "node_modules/.bin/mocha", "#!/bin/sh\n");

    const config = loadConfig({}, root);

    expect(config.testCommand).toBe("node_modules/.bin/mocha");
  });
});
