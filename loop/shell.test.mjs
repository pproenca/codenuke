import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quoteShellArg, runCommand, tryCommand } from "./shell.mjs";

describe("shell helpers", () => {
  it("quotes values for shell commands the same way existing call sites did", () => {
    expect(quoteShellArg("path with spaces/'quotes'")).toBe(
      JSON.stringify("path with spaces/'quotes'"),
    );
  });

  it("runs commands with inherited execSync defaults and caller options", () => {
    const dir = mkdtempSync(join(tmpdir(), "codenuke-shell-"));
    try {
      const output = runCommand('node -e "process.stdout.write(process.cwd())"', { cwd: dir });
      expect(output).toBe(realpathSync(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures stdout and stderr for failed commands", () => {
    const result = tryCommand(
      "node -e \"process.stdout.write('out'); process.stderr.write('err'); process.exit(7)\"",
    );

    expect(result).toEqual({ ok: false, out: "outerr", timedOut: false });
  });
});
