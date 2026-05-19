# macOS System Tools for codenuke Profiling

Use this reference after the default capture when selecting deeper macOS tools or
interpreting ambiguous evidence.

## Tool Guide

| Tool                                      | Use for                                                  | Notes                                                                             |
| ----------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `sample <pid> <seconds> -file <path>`     | CPU stacks, blocked stacks, hot JavaScript/native frames | Start here. Usually works without sudo for your own processes.                    |
| `spindump <pid> <seconds> 1 -file <path>` | Hangs, scheduler states, cross-process waiting           | Often needs administrator privileges. More intrusive than `sample`.               |
| `fs_usage -w -f filesys <pid>`            | File open/read/write/stat churn                          | Scope to the PID. System-wide capture can be noisy and may require sudo.          |
| `dtruss -p <pid>` / DTrace                | Syscall-level questions                                  | SIP and permissions often block useful tracing. Use only for a narrow hypothesis. |
| `vm_stat`, `memory_pressure`, `top`, `ps` | Memory pressure, RSS growth, process tree, thread counts | Low risk and useful in every run.                                                 |
| `powermetrics`                            | Thermal throttling, CPU frequency, power states          | Requires sudo. Use when timing changes across repeated runs without code changes. |
| Instruments Time Profiler/System Trace    | Visual timeline after text artifacts identify a hotspot  | Useful for phase ordering, child processes, and wait vs run time.                 |

## codenuke-Specific Reading

- High samples in parser, mapper, glob, path, or JSON code suggest optimizing
  repository mapping, ignore filtering, file classification, or state loading.
- High samples in `fs.readFileSync`, `readdir`, `stat`, or path resolution point
  to repeated file-system scans. Look for caching, batching, and generated-file
  filtering before changing algorithms.
- Low CPU with stacks parked in polling, pipes, sockets, or child-process waits
  usually means wall time is provider/network/subprocess wait, not local CPU.
- Many short-lived Node or provider processes suggest spawn overhead or overly
  aggressive job fan-out. Compare `--jobs` settings and process tree snapshots.
- RSS growth across phases suggests large retained maps, reports, feature
  payloads, provider transcripts, or unbounded arrays. Confirm with repeated
  captures before refactoring.
- CPU dominated by validation command output or provider transcript parsing
  should be separated from core mapper/runtime performance.

## Evidence Standard

When proposing a performance change, include:

- The exact command, commit, macOS version, hardware, duration, and output path.
- Whether network/provider time was intentionally included.
- The top stack frames or wait states from `sample`/`spindump`.
- CPU, RSS, process count, and notable file I/O observations.
- The suspected codenuke module or workflow phase.
- The next smallest measurement or code change that would confirm the cause.
