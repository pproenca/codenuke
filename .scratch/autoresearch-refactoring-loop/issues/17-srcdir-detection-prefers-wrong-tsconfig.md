Status: needs-triage

# srcDir detection picks the wrong source dir when a repo has multiple tsconfigs

## Context / problem

`loop/config.mjs` `detectSrcDir` trusts `tsconfig.json` `rootDir` / `include` before the conventional dirs (`src`, `lib`, `app`, `source`). This is intentional and tested (`config.test.mjs`: "uses tsconfig rootDir before conventional source directories", "uses tsconfig include globs before conventional source directories").

But on `../codecharter` (2026-05-22) the root `tsconfig.json` `include` points at the small browser frontend `public-src/`, while the real engine is `src/` (~5,700 LOC across 26 modules). Result: `doctor` / `fence` / `run` target `public-src` unless overridden with `CN_SRC=src` (now pinned in codecharter's `codenuke.loop.json`). The repo also has `tsconfig.build.json` and `tsconfig.public.json`, so a single root tsconfig is not a reliable "main source" signal.

## Options to weigh (triage)

- Prefer conventional `src` when it exists and contains substantially more source than the tsconfig target.
- Consider all `tsconfig*.json`, or the one whose `include` covers the most source.
- Tie-break tsconfig vs convention by source volume; keep tsconfig-first only when unambiguous.
- Keep behavior; document `CN_SRC` / `srcDir` as the supported override for multi-tsconfig repos (lowest effort).

## Acceptance criteria (once a direction is chosen)

- [ ] Decision recorded (change the heuristic vs document the override), with the codecharter case as the worked example.
- [ ] If changed: `config.test.mjs` updated to encode the new precedence (the existing tsconfig-first tests must be revisited), and detection still resolves correctly on all existing layout fixtures.
- [ ] `docs/spec.md` "Source & region detection" reflects the outcome.

## Blocked by

None - needs a maintainer decision before implementation.
