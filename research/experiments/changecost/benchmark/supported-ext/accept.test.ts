import { describe, expect, it } from "vitest";

import { isSupportedExtension } from "./shared.js";

describe("isSupportedExtension (changecost acceptance)", () => {
  it("accepts .ts and .tsx, rejects others", () => {
    expect(isSupportedExtension(".ts")).toBe(true);
    expect(isSupportedExtension(".tsx")).toBe(true);
    expect(isSupportedExtension(".py")).toBe(false);
    expect(isSupportedExtension("")).toBe(false);
  });
});
