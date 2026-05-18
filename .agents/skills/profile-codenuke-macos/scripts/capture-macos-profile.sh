#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage:
  capture-macos-profile.sh [options] -- <command> [args...]
  capture-macos-profile.sh [options] --pid <pid>

Options:
  --duration <seconds>   Sampling duration. Default: 30.
  --interval <seconds>   Monitor interval. Default: 1.
  --out <directory>      Output parent directory. Default: .codenuke/perf.
  --pid <pid>            Attach to an existing process instead of running a command.
  --fs-usage             Best-effort fs_usage capture scoped to the target PID.
  --spindump             Best-effort spindump capture for hang/scheduling analysis.
  -h, --help             Show this help.

The script uses non-sudo tools by default. Some optional macOS tools may fail
without administrator privileges; their stderr is kept in the output directory.
USAGE
}

duration=30
interval=1
out_parent=".codenuke/perf"
target_pid=""
run_fs_usage=0
run_spindump=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)
      duration="${2:-}"
      shift 2
      ;;
    --interval)
      interval="${2:-}"
      shift 2
      ;;
    --out)
      out_parent="${2:-}"
      shift 2
      ;;
    --pid)
      target_pid="${2:-}"
      shift 2
      ;;
    --fs-usage)
      run_fs_usage=1
      shift
      ;;
    --spindump)
      run_spindump=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This profiler is intended for macOS (Darwin)." >&2
  exit 2
fi

case "$duration" in
  ''|*[!0-9]*)
    echo "--duration must be a positive integer." >&2
    exit 2
    ;;
esac

case "$interval" in
  ''|*[!0-9]*)
    echo "--interval must be a positive integer." >&2
    exit 2
    ;;
esac

if [[ "$duration" -le 0 || "$interval" -le 0 ]]; then
  echo "--duration and --interval must be greater than zero." >&2
  exit 2
fi

if [[ -n "$target_pid" && $# -gt 0 ]]; then
  echo "Use either --pid or -- <command>, not both." >&2
  exit 2
fi

if [[ -z "$target_pid" && $# -eq 0 ]]; then
  echo "Provide --pid <pid> or a command after --." >&2
  usage >&2
  exit 2
fi

mkdir -p "$out_parent"
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
out_dir="$out_parent/$run_id"
mkdir -p "$out_dir"

started_command=0
command_exit="not-run"
monitor_pid=""
fs_usage_pid=""
spindump_pid=""
sample_jobs=()

process_exists() {
  kill -0 "$1" 2>/dev/null
}

collect_tree_pids() {
  root="$1"
  queue="$root"
  seen=""

  while [[ -n "$queue" ]]; do
    set -- $queue
    current="$1"
    shift || true
    queue="$*"

    case " $seen " in
      *" $current "*) continue ;;
    esac

    if process_exists "$current"; then
      seen="$seen $current"
      children="$(pgrep -P "$current" 2>/dev/null || true)"
      for child in $children; do
        queue="$queue $child"
      done
    fi
  done

  echo "$seen"
}

pid_csv() {
  echo "$*" | awk '{$1=$1; gsub(/ /, ","); print}'
}

write_metadata() {
  {
    echo "run_id=$run_id"
    echo "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "cwd=$(pwd)"
    echo "duration_seconds=$duration"
    echo "interval_seconds=$interval"
    echo "target_pid=$target_pid"
    echo
    sw_vers 2>/dev/null || true
    echo
    uname -a
    echo
    sysctl -n machdep.cpu.brand_string 2>/dev/null || true
    sysctl hw.ncpu hw.memsize 2>/dev/null || true
    echo
    node --version 2>/dev/null || true
    pnpm --version 2>/dev/null || true
    git rev-parse --show-toplevel 2>/dev/null || true
    git rev-parse HEAD 2>/dev/null || true
    git status --short 2>/dev/null || true
  } > "$out_dir/metadata.txt"
}

monitor_loop() {
  while process_exists "$target_pid"; do
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    pids="$(collect_tree_pids "$target_pid")"
    csv="$(pid_csv "$pids")"

    {
      echo "### $ts"
      if [[ -n "$csv" ]]; then
        ps -o pid,ppid,pgid,stat,%cpu,%mem,rss,vsz,etime,command -p "$csv" 2>&1
      fi
      echo
    } >> "$out_dir/ps.txt"

    {
      echo "### $ts"
      top -l 1 -stats pid,command,cpu,mem,threads,ports,wq,time -pid "$target_pid" 2>&1
      echo
    } >> "$out_dir/top.txt"

    {
      echo "### $ts"
      vm_stat 2>&1
      echo
    } >> "$out_dir/vm_stat.txt"

    sleep "$interval" || break
  done
}

start_samples() {
  if ! command -v sample >/dev/null 2>&1; then
    echo "sample not found" > "$out_dir/sample.log"
    return
  fi

  sleep 1
  pids="$(collect_tree_pids "$target_pid")"
  for sample_pid in $pids; do
    if process_exists "$sample_pid"; then
      ps -o pid,ppid,command -p "$sample_pid" > "$out_dir/process-$sample_pid.txt" 2>&1 || true
      sample "$sample_pid" "$duration" -file "$out_dir/sample-$sample_pid.txt" > "$out_dir/sample-$sample_pid.log" 2>&1 &
      sample_jobs+=("$!")
    fi
  done
}

start_fs_usage() {
  if [[ "$run_fs_usage" -ne 1 ]]; then
    return
  fi
  if ! command -v fs_usage >/dev/null 2>&1; then
    echo "fs_usage not found" > "$out_dir/fs_usage.log"
    return
  fi

  fs_usage -w -f filesys "$target_pid" > "$out_dir/fs_usage.txt" 2> "$out_dir/fs_usage.log" &
  fs_usage_pid="$!"
}

start_spindump() {
  if [[ "$run_spindump" -ne 1 ]]; then
    return
  fi
  if ! command -v spindump >/dev/null 2>&1; then
    echo "spindump not found" > "$out_dir/spindump.log"
    return
  fi

  spindump "$target_pid" "$duration" 1 -file "$out_dir/spindump.txt" > "$out_dir/spindump.log" 2>&1 &
  spindump_pid="$!"
}

cleanup_background() {
  if [[ -n "$monitor_pid" ]]; then
    kill "$monitor_pid" 2>/dev/null || true
  fi
  if [[ -n "$fs_usage_pid" ]]; then
    kill "$fs_usage_pid" 2>/dev/null || true
  fi
  if [[ -n "$spindump_pid" ]]; then
    kill "$spindump_pid" 2>/dev/null || true
  fi
}

trap cleanup_background EXIT INT TERM

if [[ -z "$target_pid" ]]; then
  started_command=1
  printf '%q ' "$@" > "$out_dir/command.txt"
  printf '\n' >> "$out_dir/command.txt"
  "$@" > "$out_dir/command.stdout.txt" 2> "$out_dir/command.stderr.txt" &
  target_pid="$!"
else
  if ! process_exists "$target_pid"; then
    echo "Process does not exist: $target_pid" >&2
    exit 2
  fi
  ps -o pid,ppid,command -p "$target_pid" > "$out_dir/command.txt" 2>&1 || true
fi

write_metadata
lsof -p "$target_pid" > "$out_dir/lsof-start.txt" 2>&1 || true
monitor_loop &
monitor_pid="$!"

start_fs_usage
start_spindump
start_samples

for job in "${sample_jobs[@]}"; do
  wait "$job" || true
done

if [[ "$started_command" -eq 1 ]]; then
  wait "$target_pid"
  command_exit="$?"
else
  command_exit="attached"
fi

lsof -p "$target_pid" > "$out_dir/lsof-end.txt" 2>&1 || true
cleanup_background

{
  echo "output_dir=$out_dir"
  echo "target_pid=$target_pid"
  echo "command_exit=$command_exit"
  echo "finished_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "Key files:"
  find "$out_dir" -maxdepth 1 -type f -print | sort
} > "$out_dir/summary.txt"

cat "$out_dir/summary.txt"
if [[ "$started_command" -eq 1 ]]; then
  exit "$command_exit"
fi
exit 0
