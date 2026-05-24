/**
 * Safe JSON file read: parse a file, or return `null` on any read/parse failure.
 * Migrated from `legacy/codenuke/loop/json.mjs`. The "swallow → null" contract is
 * load-bearing — callers (config, artifacts) treat a missing/corrupt artifact as
 * absent, which drives the engine's fail-closed gating.
 *
 * @typeParam T expected shape; the caller is responsible for narrowing/validating.
 * @returns the parsed value, or `null` if the file is missing or not valid JSON
 */
import { readFileSync } from "node:fs";

export function readJson<T = unknown>(
  path: string,
  _shape?: (value: unknown) => value is T,
): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}
