#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { main } from "./cli/main.js";
import { CodenukeError } from "./platform/errors.js";

export { main, packageVersion, parseArgs } from "./cli/main.js";

if (isMainModule()) {
  main(process.argv.slice(2)).then(
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

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(realpathSync(entry)).href;
}
