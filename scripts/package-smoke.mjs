#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const moduleRequire = createRequire(import.meta.url);
const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), "codenuke-pack-smoke-"));
const fixtureRoot = join(tmp, "fixture");
const installRoot = join(tmp, "installed");
const npmCache = join(tmp, "npm-cache");

function write(path, contents) {
  const full = join(fixtureRoot, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, runOptions(command, options, options.stdio ?? "pipe"));
}

function runResult(command, args, options = {}) {
  const result = spawnSync(command, args, runOptions(command, options, "pipe"));
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runOptions(command, options, stdio) {
  return {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache,
      npm_config_update_notifier: "false",
    },
    shell: needsWindowsShell(command) ? (process.env.ComSpec ?? true) : false,
    stdio,
  };
}

function needsWindowsShell(command) {
  return (
    process.platform === "win32" && (!command.includes("/") || /\.(?:cmd|bat)$/iu.test(command))
  );
}

try {
  createFixture();
  const bin = packAndInstallCli();
  assertPackagedCliBasics(bin);
  const mapped = assertPackagedMapping(bin);
  assertPackagedResources();
  console.log(`packaged CLI smoke mapped ${mapped.features} features`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function createFixture() {
  write(
    "pyproject.toml",
    [
      "[project]",
      'name = "mixed-app"',
      'dependencies = ["fastapi", "pytest"]',
      "",
      "[tool.pytest.ini_options]",
      'testpaths = ["tests"]',
      "",
    ].join("\n"),
  );
  write("app/__init__.py", "");
  write(
    "app/main.py",
    [
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
      '@app.post("/webhook")',
      "async def webhook() -> dict[str, str]:",
      '    return {"status": "ok"}',
      "",
    ].join("\n"),
  );
  write("tests/test_ingest.py", "def test_ingest() -> None:\n    assert True\n");
  write("pnpm-workspace.yaml", ["packages:", "  - frontend", ""].join("\n"));
  write(
    "frontend/package.json",
    JSON.stringify(
      {
        name: "frontend",
        scripts: { test: "vitest run" },
        dependencies: { next: "1.0.0" },
      },
      null,
      2,
    ),
  );
  write("frontend/src/app/dashboard/page.tsx", "export default function Page() { return null; }\n");
  write("frontend/src/app/dashboard/page.test.tsx", "test('dashboard', () => {});\n");
}

function packAndInstallCli() {
  const packOutput = JSON.parse(
    run("npm", ["pack", "--json", "--cache", npmCache, "--pack-destination", tmp], {
      stdio: "pipe",
    }),
  );
  const tarball = join(tmp, packFilename(packOutput));
  const dependencyPaths = runtimeDependencyPaths();
  mkdirSync(installRoot, { recursive: true });
  run("npm", [
    "install",
    "--offline",
    "--omit=dev",
    "--cache",
    npmCache,
    "--prefix",
    installRoot,
    tarball,
    ...dependencyPaths,
  ]);

  const bin = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "codenuke.cmd" : "codenuke",
  );
  return bin;
}

function assertPackagedCliBasics(bin) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = run(bin, ["--version"]).trim();
  if (version !== packageJson.version) {
    throw new Error(`expected packaged CLI version ${packageJson.version}, got ${version}`);
  }
  const invalidCommand = runResult(bin, ["does-not-exist"]);
  if (invalidCommand.status !== 2) {
    throw new Error(
      `expected packaged CLI invalid command to exit 2, got ${invalidCommand.status}`,
    );
  }
  if (!invalidCommand.stderr.startsWith("error: unknown command: does-not-exist\n")) {
    throw new Error(
      `expected packaged CLI invalid command stderr to start with error:, got ${JSON.stringify(
        invalidCommand.stderr,
      )}`,
    );
  }
}

function assertPackagedMapping(bin) {
  run(bin, ["--root", fixtureRoot, "init", "--force", "--json"]);
  const mapped = JSON.parse(run(bin, ["--root", fixtureRoot, "map", "--json"]));
  const features = readMappedFeatures(fixtureRoot);
  const sources = new Set(features.map((feature) => feature.source));
  const titles = new Set(features.map((feature) => feature.title));

  if (mapped.features < 4) {
    throw new Error(
      `expected packaged CLI to map several fixture features, got ${mapped.features}`,
    );
  }
  if (!sources.has("python-project")) {
    throw new Error("expected packaged CLI to include Python project mapping");
  }
  if (!sources.has("python-fastapi-route")) {
    throw new Error("expected packaged CLI to include FastAPI route mapping");
  }
  if (!titles.has("frontend route /dashboard")) {
    throw new Error("expected packaged CLI to include nested Next workspace route mapping");
  }
  return mapped;
}

function readMappedFeatures(projectRoot) {
  const featureDir = join(projectRoot, ".codenuke", "features");
  return readdirSync(featureDir).map((file) =>
    JSON.parse(readFileSync(join(featureDir, file), "utf8")),
  );
}

function assertPackagedResources() {
  const resourceManifest = join(
    installRoot,
    "node_modules",
    "codenuke",
    "resources",
    "refactoring",
    "manifest.json",
  );
  if (!existsSync(resourceManifest)) {
    throw new Error("expected packaged CLI to include refactoring resources");
  }
}

function packFilename(output) {
  const filename = Array.isArray(output) ? output[0]?.filename : null;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack did not report a tarball filename");
  }
  return filename;
}

function runtimeDependencyPaths() {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return Object.keys(packageJson.dependencies ?? {}).map((name) =>
    dirname(moduleRequire.resolve(`${name}/package.json`)),
  );
}
