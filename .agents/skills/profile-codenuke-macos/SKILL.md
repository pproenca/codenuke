---
name: profile-codenuke-macos
description: Use macOS system debugging and profiling tools to measure codenuke runtime behavior before optimizing it. Use when investigating codenuke CPU time, wall-clock time, memory pressure, file I/O, subprocess fan-out, provider wait, event-loop stalls, thermal throttling, or OS-level bottlenecks with tools such as sample, spindump, fs_usage, dtrace/dtruss, powermetrics, vm_stat, top, ps, lsof, Activity Monitor, or Instruments.
---

# Profile codenuke on macOS

## Overview

Profile codenuke from the outside first: capture repeatable macOS evidence,
separate CPU work from waiting, then connect the finding to a small performance
change in the TypeScript codebase.

## Default Workflow

1. Define the scenario: record the codenuke command, repo size, branch/commit,
   input flags, provider/model if relevant, and whether network/provider time is
   part of the question.
2. Prefer a direct local CLI command so the profiled process is Node, not a pnpm
   shim. If `node` is a version-manager shim such as `mise`, resolve the real
   binary first:

   ```bash
   pnpm build
   NODE_BIN="$(mise which node 2>/dev/null || command -v node)"
   "$NODE_BIN" dist/cli.js <command> <flags>
   ```

3. Capture a baseline with the bundled script:

   ```bash
   bash .agents/skills/profile-codenuke-macos/scripts/capture-macos-profile.sh \
     --duration 30 \
     --out .codenuke/perf \
     -- node dist/cli.js map
   ```

4. For an already-running codenuke process, attach by PID:

   ```bash
   pgrep -af "node .*dist/cli.js|codenuke"
   bash .agents/skills/profile-codenuke-macos/scripts/capture-macos-profile.sh \
     --pid <pid> \
     --duration 30 \
     --out .codenuke/perf
   ```

5. Read `summary.txt`, `metadata.txt`, `ps.txt`, `top.txt`, `vm_stat.txt`, and
   `sample-*.txt` in the generated output directory. Load
   `references/macos-system-tools.md` when choosing deeper tools or interpreting
   ambiguous traces.

## Tool Selection

- Start with `sample`: it gives stack evidence for CPU-bound or blocked Node
  processes with low setup cost.
- Add `spindump` only for hang analysis or cross-process scheduling questions.
  It may need administrator privileges.
- Add `fs_usage` when samples or timing indicate file-system churn. Scope it to
  the codenuke PID whenever possible.
- Add `powermetrics` only when thermal, frequency, or power behavior is part of
  the hypothesis. It requires administrator privileges.
- Use `dtruss` or DTrace sparingly; SIP and permissions often limit usefulness.
- Use Instruments when text artifacts identify a hotspot but a visual timeline
  is needed to understand phase ordering or subprocess interactions.

## Safety

- Do not run `sudo` profiling commands without explicit user approval.
- Do not collect provider transcripts, credentials, or full environment dumps.
  Redact tokens and secret-bearing paths from shared artifacts.
- Keep profiling output under `.codenuke/perf/` or another ignored scratch path.
- Avoid profiling mutating `fix` runs unless the user asks; prefer `map`,
  `status`, `report`, `review --limit <n>`, or a disposable fixture repo.

## Analysis Output

Return a short performance note with:

- Exact command, commit, hardware/OS, duration, and output directory.
- Top sampled stacks or wait states, with file/function names when visible.
- CPU, memory, I/O, subprocess, and wall-clock observations.
- One or two likely code-level causes, clearly marked as evidence-backed or
  speculative.
- The smallest next optimization or measurement that would validate the cause.
