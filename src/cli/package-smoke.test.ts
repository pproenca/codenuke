import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("package smoke script", () => {
  it("packs, installs, and exercises the packaged loop CLI contract", async () => {
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
      expect(result.stdout).toBe("packaged CLI smoke loop ready=true\n");
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
      "  mkdirSync(binDir, { recursive: true });",
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
      "const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');",
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
      "if (args[0] === 'doctor') {",
      "  const fence = existsSync(join(process.cwd(), '.codenuke', 'fence-fidelity.json'));",
      "  const calibration = existsSync(join(process.cwd(), '.codenuke', 'calibration.json'));",
      "  process.stdout.write('fence: ' + (fence ? 'present' : 'missing') + '\\n');",
      "  process.stdout.write('calibration: ' + (calibration ? 'present' : 'missing') + '\\n');",
      "  process.exit(fence && calibration ? 0 : 2);",
      "}",
      "if (args[0] === 'fence') {",
      "  mkdirSync(join(process.cwd(), '.codenuke'), { recursive: true });",
      "  writeFileSync(join(process.cwd(), '.codenuke', 'fence-fidelity.json'), JSON.stringify({ regions: { src: { total: 1 } } }));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'calibrate') {",
      "  mkdirSync(join(process.cwd(), '.codenuke'), { recursive: true });",
      "  writeFileSync(join(process.cwd(), '.codenuke', 'calibration.json'), JSON.stringify({ scales: { sL: 1, sCx: 1, sDup: 1 } }));",
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
