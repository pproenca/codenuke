#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      ...options.env,
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
  const readiness = assertPackagedLoop(bin);
  console.log(`packaged CLI smoke loop ready=${readiness.ready}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function createFixture() {
  mkdirSync(fixtureRoot, { recursive: true });
  run("git", ["init"], { cwd: fixtureRoot });
  run("git", ["config", "user.email", "test@example.com"], { cwd: fixtureRoot });
  run("git", ["config", "user.name", "Test User"], { cwd: fixtureRoot });
  run("git", ["config", "commit.gpgsign", "false"], { cwd: fixtureRoot });
  write(
    "package.json",
    JSON.stringify(
      {
        name: "loop-smoke",
        type: "module",
      },
      null,
      2,
    ),
  );
  write(
    "src/index.ts",
    ["export function isPositive(value: number): boolean {", "  return value > 0;", "}", ""].join(
      "\n",
    ),
  );
  run("git", ["add", "."], { cwd: fixtureRoot });
  run("git", ["commit", "-m", "initial"], { cwd: fixtureRoot });
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

function assertPackagedLoop(bin) {
  const env = {
    CN_TEST: 'node -e "process.exit(0)"',
    CN_PROPOSER: "true",
  };
  const initialDoctor = runResult(bin, ["doctor"], { cwd: fixtureRoot, env });
  if (initialDoctor.status !== 2) {
    throw new Error(
      `expected doctor to report missing readiness gaps, got ${initialDoctor.status}`,
    );
  }
  if (!initialDoctor.stdout.includes("fence: missing")) {
    throw new Error("expected doctor to report missing fence artifact");
  }

  run(bin, ["fence", "1", "1337"], { cwd: fixtureRoot, env });
  const fence = JSON.parse(readFileSync(join(fixtureRoot, ".codenuke", "fence-fidelity.json")));
  if (!fence.regions?.src || fence.regions.src.total !== 1) {
    throw new Error("expected packaged fence to write a src region artifact");
  }

  run(bin, ["calibrate"], { cwd: fixtureRoot, env });
  const calibration = JSON.parse(readFileSync(join(fixtureRoot, ".codenuke", "calibration.json")));
  if (
    calibration.scales?.sL <= 0 ||
    calibration.scales?.sCx <= 0 ||
    calibration.scales?.sDup <= 0
  ) {
    throw new Error("expected packaged calibrate to write positive scales");
  }

  const readyDoctor = runResult(bin, ["doctor"], { cwd: fixtureRoot, env });
  if (readyDoctor.status !== 0) {
    throw new Error(`expected doctor to report ready, got ${readyDoctor.status}`);
  }
  return { ready: true };
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
