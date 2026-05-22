#!/usr/bin/env node
import { main, packageVersion, parseArgs } from "./cli/main.js";
import { CodenukeError } from "./platform/errors.js";

export { main, packageVersion, parseArgs };

void main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CodenukeError) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = error.exitCode;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
});
