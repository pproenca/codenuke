import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("TypeScript config", () => {
  it("keeps typechecking no-emit while the build config owns release emit settings", () => {
    const base = readConfig("tsconfig.json");
    const build = readConfig("tsconfig.build.json");

    expect(base.options).toMatchObject({
      noEmit: true,
    });
    expect(base.options.rootDir).toBeUndefined();
    expect(base.options.outDir).toBeUndefined();
    expect(base.options.declaration).toBeUndefined();
    expect(base.options.sourceMap).toBeUndefined();

    expect(build.options).toMatchObject({
      noEmit: false,
      rootDir: resolve(repoRoot, "src"),
      outDir: resolve(repoRoot, "dist"),
      declaration: true,
      sourceMap: true,
    });
  });

  it("uses explicit includes as the complete typecheck file set", () => {
    const config = readConfig("tsconfig.json");

    expect(config.raw.include).toEqual(["src/**/*.ts", "vitest.config.ts"]);
    expect(config.raw.exclude).toBeUndefined();

    const files = config.fileNames.map((fileName) => relative(repoRoot, fileName)).toSorted();

    expect(files).toContain("vitest.config.ts");
    expect(
      files.every((fileName) => fileName.startsWith("src/") || fileName === "vitest.config.ts"),
    ).toBe(true);
  });
});

function readConfig(file: string): ts.ParsedCommandLine {
  const configPath = join(repoRoot, file);
  const result = ts.readConfigFile(configPath, ts.sys.readFile);

  if (result.error) {
    throw new Error(ts.formatDiagnostic(result.error, formatHost()));
  }

  return ts.parseJsonConfigFileContent(result.config, ts.sys, repoRoot, undefined, configPath);
}

function formatHost(): ts.FormatDiagnosticsHost {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  };
}
