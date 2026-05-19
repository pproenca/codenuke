#!/usr/bin/env node
import { runCliEntrypoint } from "./cli/bootstrap.js";
import { main } from "./cli/main.js";

export { main, packageVersion, parseArgs } from "./cli/main.js";

void runCliEntrypoint(import.meta.url, process.argv, main);
