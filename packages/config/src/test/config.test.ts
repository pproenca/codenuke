// Characterization + dual-execution tests for legacy/codenuke/loop/config.mjs.
// loadConfig is fs-side-effectful (scans the repo), so equivalence is proven on
// temp-dir repo fixtures. A fixed CN_PROGRAM is injected so the one install-relative
// field (program) is identical on both sides.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  isSourceFile,
  isUnderSourceDir,
  loadConfig,
  programPathFromModuleUrl,
  regionOf,
  slug,
  stripSourcePrefix,
} from "@codenuke/config";
import {
  isSourceFile as legacyIsSourceFile,
  isUnderSourceDir as legacyIsUnderSourceDir,
  loadConfig as legacyLoadConfig,
  regionOf as legacyRegionOf,
  slug as legacySlug,
} from "../../../../test-fixtures/legacy-loop/config.mjs";

type Env = Record<string, string | undefined>;
const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cn-config-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

// Fixed env so process.env and the install-relative `program` default don't leak in.
const env = (over: Env = {}): Env => ({ CN_PROGRAM: "/fixed/program.md", ...over });
const envWithoutProgram = (over: Env = {}): Env => ({ PATH: process.env.PATH, CN_PROGRAM: undefined, ...over });

const fixtures: { name: string; files: Record<string, string>; env?: Env }[] = [
  {
    name: "src/ with region subdirs + a co-located test",
    files: {
      "package.json": JSON.stringify({ name: "x" }),
      "src/alpha/a.ts": "export const a = 1;",
      "src/beta/b.ts": "export const b = 2;",
      "src/alpha/a.test.ts": "import { a } from './a'; if (a) {}",
    },
  },
  { name: "lib/ conventional, no src", files: { "package.json": "{}", "lib/x.ts": "export const x = 1;" } },
  {
    name: "tsconfig rootDir",
    files: {
      "package.json": "{}",
      "tsconfig.json": JSON.stringify({ compilerOptions: { rootDir: "source" } }),
      "source/y.ts": "export const y = 1;",
    },
  },
  {
    name: "codenuke.loop.json overrides (srcDir/fenceLB/weights/regions)",
    files: {
      "package.json": "{}",
      "src/a.ts": "export const a = 1;",
      "codenuke.loop.json": JSON.stringify({ srcDir: "src", fenceLB: 0.85, weights: { dL: 2 }, regions: ["a", "b"] }),
    },
  },
  {
    name: "pnpm lockfile → pnpm test",
    files: { "package.json": "{}", "pnpm-lock.yaml": "", "src/a.ts": "export const a = 1;" },
  },
  {
    name: "tsconfig include glob",
    files: {
      "package.json": "{}",
      "tsconfig.json": JSON.stringify({ include: ["app/**/*.ts"] }),
      "app/m/x.ts": "export const x = 1;",
    },
  },
  { name: "empty-ish repo (defaults)", files: { "package.json": "{}", "README.md": "# hi" } },
];

describe("loadConfig — dual-execution equivalence over repo fixtures", () => {
  for (const { name, files, env: over } of fixtures) {
    it(`matches legacy: ${name}`, () => {
      const dir = makeRepo(files);
      const e = env(over);
      expect(loadConfig(e, dir)).toEqual(legacyLoadConfig(e, dir));
    });
  }

  it("honors env overrides identically", () => {
    const dir = makeRepo({ "package.json": "{}", "src/a.ts": "export const a = 1;" });
    const e = env({
      CN_SRC: "src",
      CN_TARGET: "src/a",
      CN_REGIONS: "a, b , c",
      CN_TEST: "custom test cmd",
      CN_TYPECHECK: "tsc --noEmit",
      CN_BASE: "main",
      CN_TAG: "exp1",
      CN_FENCE_LB: "0.95",
      CN_WEIGHTS: JSON.stringify({ dCx: 9, r3: 2 }),
      CN_BUDGET: "12",
      CN_TIMEOUT: "60000",
    });
    expect(loadConfig(e, dir)).toEqual(legacyLoadConfig(e, dir));
  });
});

describe("loadConfig — literal source-prefix stripping", () => {
  it.each([
    ["src", "src", ""],
    ["src/", "src", ""],
    ["src/api", "src", "api"],
    ["src-api", "src", "src-api"],
    ["packages/app/src/api", "packages/app/src", "api"],
    ["packages/app/src/api/handlers", "packages/app/src", "api/handlers"],
    ["packages/app/srcish/api", "packages/app/src", "packages/app/srcish/api"],
    ["api", ".", "api"],
  ])("stripSourcePrefix(%s, %s) -> %s", (target, srcDir, expected) => {
    expect(stripSourcePrefix(target, srcDir)).toBe(expected);
  });

  it("derives the target child region when CN_SRC contains regex metacharacters", () => {
    const dir = makeRepo({
      "package.json": "{}",
      "src+/api/index.ts": "export const api = true;",
    });

    const config = loadConfig(env({ CN_SRC: "src+", CN_TARGET: "src+/api" }), dir);

    expect(config.region).toBe("api");
  });
});

describe("loadConfig — CN_WEIGHTS fail-closed parsing", () => {
  const repo = (): string => makeRepo({ "package.json": "{}", "src/a.ts": "export const a = 1;" });
  const loadWithWeights = (value: string) => loadConfig(env({ CN_WEIGHTS: value }), repo());

  function thrownBy(fn: () => unknown): unknown {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new Error("expected function to throw");
  }

  it("accepts a valid object and overrides numeric defaults without rejecting unknown keys", () => {
    const config = loadWithWeights(JSON.stringify({ dL: 2.5, dCx: 4, customSignal: 0.25 }));

    expect(config.weights).toMatchObject({
      dL: 2.5,
      dCx: 4,
      dDup: 0.35,
      customSignal: 0.25,
    });
  });

  it("fails closed on malformed JSON with a clear CN_WEIGHTS error", () => {
    const error = thrownBy(() => loadWithWeights("{"));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("CN_WEIGHTS");
    expect(error).not.toBeInstanceOf(SyntaxError);
  });

  it("rejects an explicitly empty CN_WEIGHTS value", () => {
    expect(() => loadWithWeights("")).toThrow(/CN_WEIGHTS/);
  });

  it.each([
    ["array", "[1,2]"],
    ["string", JSON.stringify("not weights")],
    ["null", "null"],
  ])("rejects non-object JSON: %s", (_name, value) => {
    expect(() => loadWithWeights(value)).toThrow(/CN_WEIGHTS/);
  });

  it.each([
    ["string value", JSON.stringify({ dL: "2" })],
    ["non-finite overflow", '{"dL":1e309}'],
  ])("rejects non-number or non-finite values: %s", (_name, value) => {
    expect(() => loadWithWeights(value)).toThrow(/CN_WEIGHTS/);
  });

  it.each([
    ["array", [1, 2]],
    ["null", null],
    ["string value", { dL: "2" }],
    ["non-finite number", { dL: Infinity }],
  ])("rejects invalid codenuke.loop.json weights: %s", (_name, weights) => {
    const dir = makeRepo({
      "package.json": "{}",
      "src/a.ts": "export const a = 1;",
      "codenuke.loop.json": JSON.stringify({ weights }),
    });

    expect(() => loadConfig(env(), dir)).toThrow(/weights/);
  });
});

describe("loadConfig — numeric overrides fail closed", () => {
  const repo = (): string => makeRepo({ "package.json": "{}", "src/a.ts": "export const a = 1;" });

  it.each([
    ["CN_FENCE_LB", "not-a-number"],
    ["CN_FENCE_LB", "1.5"],
    ["CN_TIMEOUT", "NaN"],
    ["CN_TIMEOUT", "0"],
  ])("rejects invalid env numeric override %s=%s", (key, value) => {
    expect(() => loadConfig(env({ [key]: value }), repo())).toThrow(
      key === "CN_FENCE_LB" ? /fenceLB/ : /proposerTimeoutMs/,
    );
  });

  it("rejects invalid codenuke.loop.json numeric overrides", () => {
    const dir = makeRepo({
      "package.json": "{}",
      "src/a.ts": "export const a = 1;",
      "codenuke.loop.json": JSON.stringify({ fenceLB: Number.NaN, proposerTimeoutMs: -1 }),
    });

    expect(() => loadConfig(env(), dir)).toThrow(/fenceLB|proposerTimeoutMs/);
  });
});

describe("program.md runtime data", () => {
  const packageLocalProgram = fileURLToPath(new URL("../main/program.md", import.meta.url));
  const packageLocalConfig = fileURLToPath(new URL("../main/config.ts", import.meta.url));

  it("defaults program to a package-local program.md when no env or file config overrides it", () => {
    const dir = makeRepo({ "package.json": "{}", "src/a.ts": "export const a = 1;" });

    const config = loadConfig(envWithoutProgram(), dir);

    expect(config.program).toBe(packageLocalProgram);
    expect(dirname(config.program)).toBe(dirname(packageLocalConfig));
  });

  it("ships the proposer contract as package-local program.md runtime data", () => {
    expect(existsSync(packageLocalProgram)).toBe(true);
    expect(readFileSync(packageLocalProgram, "utf8")).toContain("behavior-preserving reduction");
  });

  it("decodes URL-escaped install paths when deriving package-local program.md", () => {
    expect(programPathFromModuleUrl("file:///tmp/codenuke%20install/config/dist/config.js")).toBe(
      "/tmp/codenuke install/config/dist/program.md",
    );
  });
});

describe("pure helpers — dual-execution vs legacy", () => {
  const paths = [
    "src/a.ts", "src/a.test.ts", "a.d.ts", "src/x/y.tsx", "lib/z.accept.ts",
    "main.mjs", "x.json", "deep/nested/mod/file.js", "top.ts", "a.spec.tsx",
  ];

  it("isSourceFile matches legacy", () => {
    for (const p of paths) expect(isSourceFile(p)).toBe(legacyIsSourceFile(p));
  });

  it("regionOf matches legacy across srcDir values", () => {
    for (const p of paths) {
      for (const s of ["src", ".", "lib", "packages/x/src"]) {
        expect(regionOf(p, s)).toBe(legacyRegionOf(p, s));
      }
    }
  });

  it("isUnderSourceDir matches legacy", () => {
    for (const p of paths) {
      for (const s of ["src", ".", "lib"]) {
        expect(isUnderSourceDir(p, s)).toBe(legacyIsUnderSourceDir(p, s));
      }
    }
  });

  it("slug matches legacy", () => {
    for (const v of ["src/a", "./x/", "Foo Bar!", "", "...", "a//b", "/leading", "trailing/"]) {
      expect(slug(v)).toBe(legacySlug(v));
    }
  });
});
