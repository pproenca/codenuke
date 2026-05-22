#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((path) => existsSync(path))
  .filter((path) => /\.(?:mjs|js)$/u.test(path))
  .filter((path) => !path.startsWith("dist/"));

for (const path of tracked) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}

console.log(`checked ${tracked.length} JavaScript files`);
