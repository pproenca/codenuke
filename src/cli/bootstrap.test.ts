import { realpathSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CodenukeError } from "../platform/errors.js";
import { runCliEntrypoint } from "./bootstrap.js";

type TestEntrypoint = {
  path: string;
  url: string;
};

async function entrypoint(): Promise<TestEntrypoint> {
  const dir = await mkdtemp(join(tmpdir(), "codenuke-cli-bootstrap-"));
  const entrypointPath = join(dir, "entrypoint.mjs");
  await writeFile(entrypointPath, "", "utf8");
  return {
    path: entrypointPath,
    url: pathToFileURL(realpathSync(entrypointPath)).href,
  };
}

describe("runCliEntrypoint", () => {
  it("passes command arguments to the CLI runner", async () => {
    const current = await entrypoint();
    const run = vi.fn<(argv: string[]) => Promise<void>>().mockResolvedValue(undefined);

    await runCliEntrypoint(current.url, ["node", current.path, "status"], run);

    expect(run).toHaveBeenCalledWith(["status"]);
  });

  it("maps CodenukeError failures to stderr and their exit code", async () => {
    const current = await entrypoint();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCliEntrypoint(current.url, ["node", current.path], async () => {
        throw new CodenukeError("invalid usage", 2, "invalid-usage");
      });

      expect(stderr).toHaveBeenCalledWith("error: invalid usage\n");
      expect(process.exitCode).toBe(2);
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("maps generic failures to stderr and exit code 1", async () => {
    const current = await entrypoint();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCliEntrypoint(current.url, ["node", current.path], async () => {
        throw new Error("boom");
      });

      expect(stderr).toHaveBeenCalledWith("error: boom\n");
      expect(process.exitCode).toBe(1);
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
