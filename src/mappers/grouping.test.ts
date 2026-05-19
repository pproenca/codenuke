import { describe, expect, it } from "vitest";
import { partitionFileGroups } from "./grouping.js";

describe("partitionFileGroups", () => {
  it("groups files by path segments while preserving stable order", () => {
    expect(
      partitionFileGroups(
        "src",
        [
          "src/routes/admin/list.ts",
          "src/lib/util.ts",
          "src/routes/home.ts",
          "src/a.ts",
          "src/routes/admin/edit.ts",
        ],
        2,
      ),
    ).toEqual([
      {
        label: "src",
        files: ["src/a.ts"],
      },
      {
        label: "src/lib",
        files: ["src/lib/util.ts"],
      },
      {
        label: "src/routes",
        files: ["src/routes/home.ts"],
      },
      {
        label: "src/routes/admin",
        files: ["src/routes/admin/edit.ts", "src/routes/admin/list.ts"],
      },
    ]);
  });

  it("chunks flat file groups when no deeper buckets exist", () => {
    expect(partitionFileGroups("src", ["src/a.ts", "src/b.ts", "src/c.ts"], 2)).toEqual([
      {
        label: "src#1",
        files: ["src/a.ts", "src/b.ts"],
      },
      {
        label: "src#2",
        files: ["src/c.ts"],
      },
    ]);
  });
});
