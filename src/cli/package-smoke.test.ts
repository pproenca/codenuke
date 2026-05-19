import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("package smoke script", () => {
  it("packs, installs, and exercises the packaged CLI mapping contract", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "codenuke-package-smoke-test-"));
    const fakeBin = join(scratch, "bin");
    const npmLog = join(scratch, "npm.log");
    try {
      await writeFakeNpm(fakeBin);

      const result = spawnSync(process.execPath, ["scripts/package-smoke.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PACKAGE_SMOKE_FAKE_NPM_LOG: npmLog,
          PACKAGE_SMOKE_PROJECT_ROOT: process.cwd(),
          PATH: `${fakeBin}${delimiter}${process.env["PATH"] ?? ""}`,
        },
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("packaged CLI smoke mapped 4 features\n");
      const npmCommands = (await readFile(npmLog, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(npmCommands).toHaveLength(2);
      expect(npmCommands[0]?.slice(0, 2)).toEqual(["pack", "--json"]);
      expect(npmCommands[1]?.slice(0, 4)).toEqual([
        "install",
        "--offline",
        "--omit=dev",
        "--cache",
      ]);
      expect(npmCommands[1]).toContain("--prefix");
      expect(npmCommands[1]?.some((arg) => arg.endsWith("codenuke-smoke.tgz"))).toBe(true);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

async function writeFakeNpm(fakeBin: string): Promise<void> {
  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    join(fakeBin, "npm"),
    [
      "#!/usr/bin/env node",
      "const { appendFileSync, chmodSync, mkdirSync, writeFileSync } = require('node:fs');",
      "const { join } = require('node:path');",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.PACKAGE_SMOKE_FAKE_NPM_LOG, `${JSON.stringify(args)}\\n`);",
      "if (args[0] === 'pack') {",
      "  console.log(JSON.stringify([{ filename: 'codenuke-smoke.tgz' }]));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'install') {",
      "  const prefix = args[args.indexOf('--prefix') + 1];",
      "  const binDir = join(prefix, 'node_modules', '.bin');",
      "  const resourceDir = join(prefix, 'node_modules', 'codenuke', 'resources', 'refactoring');",
      "  mkdirSync(binDir, { recursive: true });",
      "  mkdirSync(resourceDir, { recursive: true });",
      "  writeFileSync(join(resourceDir, 'manifest.json'), '{}\\n');",
      "  if (process.platform === 'win32') {",
      "    writeFileSync(join(binDir, 'codenuke.js'), fakeCliSource());",
      "    writeFileSync(join(binDir, 'codenuke.cmd'), '@echo off\\r\\nnode \"%~dp0\\\\codenuke.js\" %*\\r\\n');",
      "  } else {",
      "    const cliPath = join(binDir, 'codenuke');",
      "    writeFileSync(cliPath, fakeCliSource());",
      "    chmodSync(cliPath, 0o755);",
      "  }",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
      "function fakeCliSource() {",
      "  return `#!/usr/bin/env node\\n${fakeCliBody()}`;",
      "}",
      "function fakeCliBody() {",
      "  return String.raw`",
      "const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');",
      "const { join } = require('node:path');",
      "const args = process.argv.slice(2);",
      "const projectRoot = process.env.PACKAGE_SMOKE_PROJECT_ROOT;",
      "const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));",
      "if (args[0] === '--version') {",
      "  process.stdout.write(packageJson.version + '\\n');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'does-not-exist') {",
      "  process.stderr.write('error: unknown command: does-not-exist\\n');",
      "  process.exit(2);",
      "}",
      "const rootIndex = args.indexOf('--root');",
      "const fixtureRoot = args[rootIndex + 1];",
      "const command = args[rootIndex + 2];",
      "const featureDir = join(fixtureRoot, '.codenuke', 'features');",
      "if (command === 'init') {",
      "  mkdirSync(featureDir, { recursive: true });",
      "  process.stdout.write('{\"initialized\":true}\\n');",
      "  process.exit(0);",
      "}",
      "if (command === 'map') {",
      "  mkdirSync(featureDir, { recursive: true });",
      "  const features = [",
      "    { source: 'python-project', title: 'Python project mixed-app' },",
      "    { source: 'python-fastapi-route', title: 'FastAPI route POST /webhook' },",
      "    { source: 'next-app-route', title: 'frontend route /dashboard' },",
      "    { source: 'node-package', title: 'Node package frontend' },",
      "  ];",
      "  for (const [index, feature] of features.entries()) {",
      "    writeFileSync(join(featureDir, String(index) + '.json'), JSON.stringify(feature));",
      "  }",
      "  process.stdout.write('{\"features\":4}\\n');",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
      "`;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(join(fakeBin, "npm"), 0o755);
  await writeFile(join(fakeBin, "npm.cmd"), '@echo off\r\nnode "%~dp0\\npm" %*\r\n', "utf8");
}
