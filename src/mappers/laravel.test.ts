import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { laravelSeeds } from "./laravel.js";
import { repoIndexFromFiles } from "./repo-index.js";
import { emptyTaskGraph } from "./task-graph.js";
import type { MapperContext } from "./types.js";

describe("laravelSeeds", () => {
  it("extracts routes with nested delimiters and escaped quotes in string literals", async () => {
    const root = await fixtureRoot("codenuke-laravel-routes-");
    const files = [
      "app/Http/Controllers/ReportController.php",
      "app/Http/Controllers/QuoteController.php",
      "artisan",
      "composer.json",
      "routes/api.php",
      "routes/web.php",
    ];
    await Promise.all([
      writeFixture(root, "artisan", "#!/usr/bin/env php\n"),
      writeFixture(
        root,
        "composer.json",
        JSON.stringify({ require: { "laravel/framework": "^11.0" } }),
      ),
      writeFixture(
        root,
        "app/Http/Controllers/ReportController.php",
        "<?php\nnamespace App\\Http\\Controllers;\nclass ReportController {}\n",
      ),
      writeFixture(
        root,
        "app/Http/Controllers/QuoteController.php",
        "<?php\nnamespace App\\Http\\Controllers;\nclass QuoteController {}\n",
      ),
      writeFixture(
        root,
        "routes/api.php",
        [
          "<?php",
          "use App\\Http\\Controllers\\QuoteController;",
          "",
          'Route::get(\'/literal,;{}\', [QuoteController::class, "show\\\\\\"detail"]);',
        ].join("\n"),
      ),
      writeFixture(
        root,
        "routes/web.php",
        [
          "<?php",
          "use App\\Http\\Controllers\\ReportController;",
          "",
          "Route::controller(ReportController::class)",
          "    ->prefix('admin;{ignored}')",
          "    ->group(function () {",
          "        Route::get('summary,stats', 'summary');",
          "        Route::post('quote\\\\\\\";brace}', 'quoted');",
          "    });",
        ].join("\n"),
      ),
    ]);
    const context: MapperContext = {
      projects: [],
      repoIndex: repoIndexFromFiles(files),
      taskGraph: emptyTaskGraph(),
    };

    const controllerRoutes = (await laravelSeeds(root, context))
      .filter((seed) => seed.source === "laravel-controller")
      .map((seed) => ({
        route: seed.route,
        summary: seed.summary,
        symbol: seed.symbol,
      }))
      .toSorted((left, right) => String(left.symbol).localeCompare(String(right.symbol)));

    expect(controllerRoutes).toEqual([
      {
        route: "/api/literal,;{}",
        summary: 'Laravel HTTP controller for GET /api/literal,;{}#show\\\\\\"detail.',
        symbol: "QuoteController",
      },
      {
        route: "/admin;{ignored}/summary,stats",
        summary:
          'Laravel HTTP controller for GET /admin;{ignored}/summary,stats#summary, POST /admin;{ignored}/quote\\\\\\";brace}#quoted.',
        symbol: "ReportController",
      },
    ]);
  });
});
