import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CodenukeError } from "../platform/errors.js";

type CliMain = (argv: string[]) => Promise<void>;

export function runCliEntrypoint(
  importMetaUrl: string,
  argv: string[],
  run: CliMain,
): Promise<void> | undefined {
  if (!isMainModule(importMetaUrl, argv)) {
    return undefined;
  }
  return run(argv.slice(2)).then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof CodenukeError) {
        process.stderr.write(`error: ${error.message}\n`);
        process.exitCode = error.exitCode;
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 1;
    },
  );
}

function isMainModule(importMetaUrl: string, argv: string[]): boolean {
  const entry = argv[1];
  if (entry === undefined) {
    return false;
  }
  return importMetaUrl === pathToFileURL(realpathSync(entry)).href;
}
