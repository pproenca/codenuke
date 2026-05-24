// Characterization + dual-execution tests for legacy/codenuke/loop/json.mjs (readJson).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJson as legacyReadJson } from "../../../../test-fixtures/legacy-loop/json.mjs";
import { readJson } from "../main/json";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cn-json-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readJson — parse or null", () => {
  it("parses a valid JSON object", () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, JSON.stringify({ a: 1, b: [2, 3] }));
    expect(readJson(p)).toEqual({ a: 1, b: [2, 3] });
  });

  it("returns null for a missing file", () => {
    expect(readJson(join(dir, "nope.json"))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, "{ not json ");
    expect(readJson(p)).toBeNull();
  });

  it("parses bare primitives literally", () => {
    const p = join(dir, "prim.json");
    writeFileSync(p, "42");
    expect(readJson(p)).toBe(42);
    writeFileSync(p, '"hi"');
    expect(readJson(p)).toBe("hi");
  });
});

describe("dual-execution vs legacy readJson", () => {
  it("matches legacy on valid, missing, and malformed inputs", () => {
    const valid = join(dir, "d-ok.json");
    writeFileSync(valid, JSON.stringify({ x: [1, { y: "z" }], n: null }));
    expect(readJson(valid)).toEqual(legacyReadJson(valid));

    const missing = join(dir, "d-missing.json");
    expect(readJson(missing)).toEqual(legacyReadJson(missing)); // both null

    const bad = join(dir, "d-bad.json");
    writeFileSync(bad, "{oops");
    expect(readJson(bad)).toEqual(legacyReadJson(bad)); // both null
  });
});
