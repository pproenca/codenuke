import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { pythonSeeds } from "./python.js";
import { repoIndexFromFiles } from "./repo-index.js";
import { emptyTaskGraph } from "./task-graph.js";
import type { MapperContext } from "./types.js";

describe("pythonSeeds", () => {
  it("extracts decorated FastAPI and Flask routes with pending decorator resets", async () => {
    const root = await fixtureRoot("codenuke-python-routes-");
    const files = ["fastapi_app.py", "app.py"];
    await writeFixture(
      root,
      "fastapi_app.py",
      [
        "from fastapi import FastAPI",
        "app = FastAPI()",
        "@app.get(",
        '    "/items"',
        ")",
        '@app.post("/items")',
        "async def list_items():",
        "    return []",
        '@app.delete("/orphan")',
        "orphan = True",
        "def ignored():",
        "    return None",
      ].join("\n"),
    );
    await writeFixture(
      root,
      "app.py",
      [
        "from flask import Flask",
        "app = Flask(__name__)",
        "@app.route(",
        '    "/users",',
        '    methods=["post", "GET"],',
        ")",
        '@app.route("/users/<id>")',
        "def users():",
        "    return ''",
        '@app.route("/orphan")',
        "orphan = True",
        "def ignored():",
        "    return ''",
      ].join("\n"),
    );
    const context: MapperContext = {
      projects: [],
      repoIndex: repoIndexFromFiles(files),
      taskGraph: emptyTaskGraph(),
    };

    const routes = (await pythonSeeds(root, context))
      .filter((seed) => seed.kind === "route")
      .map((seed) => ({
        source: seed.source,
        route: seed.route,
        symbol: seed.symbol,
      }));

    expect(routes).toEqual([
      { source: "python-flask-route", route: "POST,GET /users", symbol: "users" },
      { source: "python-flask-route", route: "GET /users/<id>", symbol: "users" },
      { source: "python-fastapi-route", route: "GET /items", symbol: "list_items" },
      { source: "python-fastapi-route", route: "POST /items", symbol: "list_items" },
    ]);
  });
});
