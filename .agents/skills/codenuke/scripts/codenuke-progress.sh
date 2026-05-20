#!/usr/bin/env bash
set -euo pipefail

limit=3
jobs=3
dry_run=0
ludicrous_mode=0
project=""
provider=""
model=""
reasoning_effort=""

usage() {
  cat <<'EOF'
Usage: codenuke-progress.sh [flags]

Runs a visible codenuke review sequence:
  doctor -> init if needed -> map -> review -> report -> next

Flags:
  --limit <n>              Review feature limit. Default: 3
  --jobs <n>               Review parallel jobs. Default: 3
  --project <name-or-root> Scope review/report to a project
  --provider <name>        Provider for doctor/review
  --model <name>           Model for doctor/review
  --reasoning-effort <x>   Reasoning effort for doctor/review
  --ludicrous-mode         Use high-recall Refactoring Opportunity Candidates
  --dry-run                Preview review candidates and guidance without writing findings
  -h, --help               Show this help

Set CODENUKE_BIN and optional CODENUKE_ARGS to use a local executable instead
of npx codenuke@latest, for example:
  CODENUKE_BIN=node CODENUKE_ARGS=dist/cli.js codenuke-progress.sh
EOF
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    echo "missing value for $flag" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      require_value "$1" "${2:-}"
      limit="$2"
      shift 2
      ;;
    --jobs)
      require_value "$1" "${2:-}"
      jobs="$2"
      shift 2
      ;;
    --project)
      require_value "$1" "${2:-}"
      project="$2"
      shift 2
      ;;
    --provider)
      require_value "$1" "${2:-}"
      provider="$2"
      shift 2
      ;;
    --model)
      require_value "$1" "${2:-}"
      model="$2"
      shift 2
      ;;
    --reasoning-effort)
      require_value "$1" "${2:-}"
      reasoning_effort="$2"
      shift 2
      ;;
    --ludicrous-mode|--ludicrous)
      ludicrous_mode=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "${CODENUKE_BIN:-}" ]]; then
  codenuke=("$CODENUKE_BIN")
  if [[ -n "${CODENUKE_ARGS:-}" ]]; then
    read -r -a extra_codenuke_args <<< "$CODENUKE_ARGS"
    codenuke+=("${extra_codenuke_args[@]}")
  fi
else
  codenuke=(npx --yes codenuke@latest)
fi

provider_flags=()
review_flags=(--limit "$limit" --jobs "$jobs")
report_flags=(--status open)

if [[ -n "$provider" ]]; then
  provider_flags+=(--provider "$provider")
  review_flags+=(--provider "$provider")
fi
if [[ -n "$model" ]]; then
  provider_flags+=(--model "$model")
  review_flags+=(--model "$model")
fi
if [[ -n "$reasoning_effort" ]]; then
  provider_flags+=(--reasoning-effort "$reasoning_effort")
  review_flags+=(--reasoning-effort "$reasoning_effort")
fi
if [[ -n "$project" ]]; then
  review_flags+=(--project "$project")
  report_flags+=(--project "$project")
fi
if [[ "$ludicrous_mode" -eq 1 ]]; then
  review_flags+=(--ludicrous-mode)
fi
if [[ "$dry_run" -eq 1 ]]; then
  review_flags+=(--dry-run --json)
fi

step() {
  printf "\n==> %s\n" "$*"
}

run() {
  step "$*"
  "$@"
}

step "codenuke progress run"
echo "limit=$limit jobs=$jobs ludicrous_mode=$ludicrous_mode dry_run=$dry_run"

run "${codenuke[@]}" doctor "${provider_flags[@]}"

if [[ ! -d .codenuke ]]; then
  run "${codenuke[@]}" init --no-input
else
  step ".codenuke already exists; skipping init"
fi

run "${codenuke[@]}" map
run "${codenuke[@]}" review "${review_flags[@]}"

if [[ "$dry_run" -eq 0 ]]; then
  run "${codenuke[@]}" report "${report_flags[@]}"
  run "${codenuke[@]}" next || true
else
  step "dry run complete; run again without --dry-run to persist findings"
fi
