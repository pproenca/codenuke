import { describe, expect, it } from "vitest";
import { total } from "./index.js";

describe("total", () => {
  it("adds values", () => {
    expect(total([1, 2, 3])).toBe(6);
  });
});
