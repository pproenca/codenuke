#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CLI="${CLI:-$ROOT/dist/cli.js}"
SOURCE="${SOURCE:-heuristic}"
LIMIT="${LIMIT:-999}"
JOBS="${JOBS:-3}"

run() {
  printf '\n$'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

cd "$ROOT"

run pnpm build
run node "$CLI" --root "$ROOT" doctor

if ! node "$CLI" --root "$ROOT" status >/dev/null 2>&1; then
  run node "$CLI" --root "$ROOT" init
fi

run node "$CLI" --root "$ROOT" map --source "$SOURCE"
run node "$CLI" --root "$ROOT" status
run node "$CLI" --root "$ROOT" review --limit "$LIMIT" --jobs "$JOBS"
run node "$CLI" --root "$ROOT" report --status open
run node "$CLI" --root "$ROOT" next
