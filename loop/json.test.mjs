import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson } from "./json.mjs";

function fixturePath(name) {
  const root = mkdtempSync(join(tmpdir(), name));
  return join(root, "data.json");
}

describe("JSON helpers", () => {
  it("reads valid JSON files and returns null for missing or malformed files", () => {
    const path = fixturePath("codenuke-json-");
    mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(path, JSON.stringify({ ok: true }));

    expect(readJson(path)).toEqual({ ok: true });
    expect(readJson(`${path}.missing`)).toBeNull();

    writeFileSync(path, "{");
    expect(readJson(path)).toBeNull();
  });
});
