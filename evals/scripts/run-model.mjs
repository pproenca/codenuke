#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const runner = resolve(repoRoot, "evals", "scripts", "run-all.mjs");
const comparison = resolve(repoRoot, "evals", "scripts", "compare-model-results.mjs");
const env = {
  ...process.env,
  CODENUKE_EVAL_PROVIDER: process.env["CODENUKE_EVAL_PROVIDER"] ?? "codex",
  CODENUKE_EVAL_MODEL: process.env["CODENUKE_EVAL_MODEL"] ?? "gpt-5.5",
  CODENUKE_EVAL_REASONING_EFFORT: process.env["CODENUKE_EVAL_REASONING_EFFORT"] ?? "medium",
  CODENUKE_EVAL_EXPECTATIONS: process.env["CODENUKE_EVAL_EXPECTATIONS"] ?? "record",
  CODENUKE_EVAL_RESULTS: process.env["CODENUKE_EVAL_RESULTS"] ?? "model-latest.json",
};

execFileSync(process.execPath, [runner], {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});

execFileSync(process.execPath, [comparison], {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});
