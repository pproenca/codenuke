// Bundles the CLI + all @codenuke/* workspace packages into a single
// dist/cli.cjs via esbuild's JS API. We use the API (not the `esbuild` CLI
// shim) because esbuild's install.js replaces bin/esbuild with the native
// binary, which pnpm's `.bin` shim then tries to run through node — so the
// shim is unreliable under pnpm. The JS API execs the native binary directly.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "dist/cli.cjs",
  // @openai/codex-sdk wraps the codex CLI (spawns it, dynamic requires); keep it
  // external so it loads from node_modules at runtime rather than being inlined.
  // It is declared as a runtime dependency of the published CLI package.
  external: ["@openai/codex-sdk"],
  // src/main.ts already carries the `#!/usr/bin/env node` shebang; esbuild
  // preserves it, so we must NOT add a second one via banner (a shebang is
  // only valid on line 1 — a duplicate on line 2 breaks `node cli.cjs`).
  logLevel: "info",
});
