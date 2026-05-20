import { describe, expect, it } from "vitest";
import { tomlTable, tomlTables, tomlTablesMatching } from "./toml.js";

describe("TOML section scanning", () => {
  it("returns the body for an exact table name", () => {
    const source = [
      "[project]",
      'name = "demo"',
      "",
      "[tool.poetry]",
      'name = "poetry-demo"',
      "",
    ].join("\n");

    expect(tomlTable(source, "project")).toBe('\nname = "demo"\n');
    expect(tomlTable(source, "missing")).toBe("");
  });

  it("stops at normal and array table headers", () => {
    const source = [
      "[tool.hatch.envs.default]",
      'dependencies = ["pytest"]',
      "",
      "[[tool.hatch.envs.default.matrix]]",
      'python = ["3.12"]',
      "",
      "[tool.black]",
      "line-length = 100",
      "",
    ].join("\n");

    expect(tomlTable(source, "tool.hatch.envs.default")).toBe('\ndependencies = ["pytest"]\n');
  });

  it("returns tables for exact names and name patterns", () => {
    const source = [
      "[tool.poetry.dependencies]",
      'requests = "^2"',
      "",
      "[tool.poetry.group.dev.dependencies]",
      'pytest = "^8"',
      "",
      "[tool.poetry.group.docs.dependencies]",
      'mkdocs = "^1"',
      "",
    ].join("\n");

    expect(tomlTables(source, ["tool.poetry.dependencies", "missing"])).toEqual([
      '\nrequests = "^2"\n',
    ]);
    expect(tomlTablesMatching(source, /^tool\.poetry\.group\.[^.]+\.dependencies$/u)).toEqual([
      '\npytest = "^8"\n',
      '\nmkdocs = "^1"\n',
    ]);
  });
});
