Status: done

# Reap the proposer process group on timeout/exit (orphaned claude -p keeps burning budget)

## What to build

When the proposer call times out, the runtime kills the `/bin/sh -c "claude -p … < prompt"` wrapper but the spawned `claude -p` **grandchild is orphaned and keeps running** — and keeps spending budget up to its `--max-budget-usd` cap.

Observed 2026-05-22 on `../codecharter`: after the loop reported `=== done ===` and exited 0, `ps` still showed `claude -p … --max-budget-usd 10 …` alive (~5 min and counting). It had to be killed manually with `pkill -f 'max-budget-usd'`. This is the same bug class as the fence's hang-reaping.

Spawn the proposer detached in its own process group and, on timeout/abnormal exit, kill the entire group (`process.kill(-pid)` / `kill -- -<pgid>`), so no proposer (or its children) survives the loop. Apply to both the default `claude -p` path and the `CN_PROPOSER` path.

## Acceptance criteria

- [ ] On proposer timeout, no proposer process or its children survive the loop process (asserted by a test using a scripted `CN_PROPOSER` that backgrounds a long-lived child).
- [ ] Reaping covers both the default `claude -p` adapter and `CN_PROPOSER`.
- [ ] Normal (non-timeout) proposer completion is unaffected.

## Blocked by

None - can start immediately. Related: issue 14.

## Resolution

Proposers now run in a detached process group. On timeout the loop sends `SIGTERM` to the
group and escalates to `SIGKILL` if it has not exited. Tests cover both `CN_PROPOSER` and the
default `claude -p` adapter with a child process that would otherwise survive and write a marker
after the loop exits.
