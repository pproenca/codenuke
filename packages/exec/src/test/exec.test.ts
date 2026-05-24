// =============================================================================
// EQUIVALENCE + SECURITY CHARACTERIZATION for the @codenuke/exec substrate
// (the CWE-78 remediation of legacy/codenuke/loop/shell.mjs)
// -----------------------------------------------------------------------------
// This is the security-critical slice of the modernization. The legacy module
// ran EVERY command via `execSync(commandString)` — a single string handed to a
// shell — with `quoteShellArg = JSON.stringify`. JSON.stringify only adds double
// quotes; it does NOT neutralize shell metacharacters, so `$(...)`, backticks,
// `;`, `&&`, `|`, and newlines inside a "quoted" value still execute. That is
// the Critical OS-command-injection root cause (CWE-78).
//
// The NEW substrate (`../main/exec`, implemented to satisfy THIS contract)
// runs commands via execFile / arg-arrays (`shell: false`). Arguments are
// delivered to the child process as a literal argv vector and can NEVER be
// re-interpreted as shell syntax. There is no shell, so there is nothing to
// inject into.
//
// These tests do two jobs at once:
//
//   1. EQUIVALENCE — on benign inputs, the new `run`/`tryRun`/`commandAvailable`
//      produce the same observable results as the legacy `runCommand`/
//      `tryCommand`/`commandAvailable`. The legacy module is the ORACLE: every
//      expected value here was computed by RUNNING the legacy code, not by
//      reading a spec. Where spec and legacy disagree, we follow the legacy and
//      flag the discrepancy separately.
//
//   2. SECURITY (the headline) — we PROVE the legacy is vulnerable (a real
//      injected `touch` creates a sentinel file on disk via the legacy path)
//      and PROVE the new substrate is immune (the same payload is echoed back
//      verbatim as inert data and no sentinel is ever created).
//
// Both implementations are imported and exercised in the same file so the suite
// is a true dual-execution differential. Until `../main/exec` exists the suite
// fails to resolve that import — that is expected; this contract is authored
// first.
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// LEGACY oracle (the vulnerable original — dual-execution + the proof of CWE-78):
import {
  commandAvailable as legacyAvailable,
  quoteShellArg as legacyQuote,
  runCommand as legacyRun,
  tryCommand as legacyTry,
} from "../../../../test-fixtures/legacy-loop/shell.mjs";
// NEW target substrate (implemented to satisfy this contract):
import { commandAvailable, run, tryRun } from "../main/exec";

// -----------------------------------------------------------------------------
// Unique, collision-resistant sentinel naming. Every sentinel path lives under
// os.tmpdir() and is registered for cleanup. A test "passes the security bar"
// only when its sentinel is asserted ABSENT; the legacy-vuln proof is the one
// place a sentinel is expected to appear (and is then removed).
// -----------------------------------------------------------------------------
const RUN_ID = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
let sentinelSeq = 0;
const createdSentinels: string[] = [];

/** Reserve a unique, currently-NON-EXISTENT sentinel path under tmpdir. */
function reserveSentinel(tag: string): string {
  sentinelSeq += 1;
  const p = join(tmpdir(), `codenuke-exec-sentinel-${RUN_ID}-${sentinelSeq}-${tag}`);
  createdSentinels.push(p);
  // Guarantee a clean slate: the whole point is to detect a side-effect that
  // would CREATE this path.
  rmSync(p, { force: true });
  return p;
}

afterAll(() => {
  for (const p of createdSentinels) {
    rmSync(p, { force: true });
  }
});

// Is git on PATH? codenuke needs git, so this should be true; we only guard so
// the suite degrades gracefully (skips, not errors) on an exotic box.
const GIT_AVAILABLE = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
})();

// =============================================================================
// 1. FUNCTIONAL EQUIVALENCE with the legacy oracle on benign commands.
// =============================================================================
describe("run() — functional equivalence with legacy runCommand on benign input", () => {
  it("echoes a plain string identically to the legacy path", () => {
    // Legacy ORACLE: same program, same output.
    const legacy = legacyRun("node -e \"process.stdout.write('hello')\"");
    const modern = run("node", ["-e", "process.stdout.write('hello')"]);
    expect(modern).toBe("hello");
    expect(modern).toBe(legacy);
  });

  it("honors the cwd option the same way the legacy did (realpath-aware)", () => {
    const dir = mkdtempSync(join(tmpdir(), "codenuke-exec-cwd-"));
    try {
      // On macOS tmpdir is a symlink (/var -> /private/var); both substrates
      // report the resolved real path, so we compare against realpathSync(dir).
      const modern = run("node", ["-e", "process.stdout.write(process.cwd())"], { cwd: dir });
      const legacy = legacyRun('node -e "process.stdout.write(process.cwd())"', { cwd: dir });
      expect(modern).toBe(realpathSync(dir));
      expect(modern).toBe(legacy);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honors the env option, passing variables through to the child", () => {
    const modern = run("node", ["-e", "process.stdout.write(process.env.CODENUKE_PROBE ?? '')"], {
      env: { ...process.env, CODENUKE_PROBE: "from-env" },
    });
    expect(modern).toBe("from-env");
  });

  it("returns stdout as a string and throws (like execFileSync) on nonzero exit", () => {
    expect(run("node", ["-e", "process.stdout.write('ok')"])).toBe("ok");
    expect(() => run("node", ["-e", "process.exit(3)"])).toThrow();
  });

  it("uses a bounded default output buffer and allows explicit opt-in for larger output", () => {
    const bytes = 17 * 1024 * 1024;
    const script = `process.stdout.write('x'.repeat(${bytes}))`;

    expect(() => run("node", ["-e", script])).toThrow();
    expect(run("node", ["-e", script], { maxBuffer: 18 * 1024 * 1024 })).toHaveLength(bytes);
  });
});

// =============================================================================
// 2. A GIT FIXTURE driven entirely through the SAME safe arg-array API.
//    Proves the substrate is fit for codenuke's real workload (git plumbing)
//    AND that the result matches the legacy oracle.
// =============================================================================
describe("run() — git fixture (init + commit + rev-parse) through the arg-array API", () => {
  let repo: string;

  beforeAll(() => {
    if (!GIT_AVAILABLE) {
      return;
    }
    repo = mkdtempSync(join(tmpdir(), "codenuke-exec-git-"));
    // Every git invocation goes through the NEW substrate — including the
    // identity passed via `-c` flags as ordinary positional args (no shell).
    run("git", ["init", "-q"], { cwd: repo });
    run(
      "git",
      [
        "-c",
        "user.email=tests@codenuke.invalid",
        "-c",
        "user.name=codenuke tests",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "characterization fixture",
      ],
      { cwd: repo },
    );
  });

  afterAll(() => {
    if (repo) {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it.skipIf(!GIT_AVAILABLE)(
    "rev-parse HEAD yields a 40-char sha matching the legacy oracle",
    () => {
      const modernSha = run("git", ["rev-parse", "HEAD"], { cwd: repo }).trim();
      expect(modernSha).toMatch(/^[0-9a-f]{40}$/);

      const legacySha = legacyRun("git rev-parse HEAD", { cwd: repo }).trim();
      expect(modernSha).toBe(legacySha);
    },
  );
});

// =============================================================================
// 3. tryRun() — never throws; captures stdout+stderr; flags timeouts.
//    Mirrors the legacy `tryCommand` contract exactly.
// =============================================================================
describe("tryRun() — equivalence with legacy tryCommand", () => {
  it("captures stdout then stderr concatenated for a failed command", () => {
    // Legacy ORACLE shape: { ok: false, out: 'outerr', timedOut: false }.
    const legacy = legacyTry(
      "node -e \"process.stdout.write('out'); process.stderr.write('err'); process.exit(7)\"",
    );
    expect(legacy).toEqual({ ok: false, out: "outerr", timedOut: false });

    const modern = tryRun("node", [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)",
    ]);
    expect(modern).toEqual({ ok: false, out: "outerr", timedOut: false });
  });

  it("reports ok:true for a successful command", () => {
    const modern = tryRun("node", ["-e", "process.stdout.write('done')"]);
    expect(modern.ok).toBe(true);
    expect(modern.timedOut).toBe(false);
    // out carries stdout (stderr empty here) — mirrors the legacy success path.
    expect(modern.out).toBe("done");
  });

  it("flags timedOut:true when the child exceeds the timeout", () => {
    // Both substrates surface a timeout as signal SIGTERM / code ETIMEDOUT.
    const modern = tryRun("node", ["-e", "setTimeout(()=>{},9999)"], {
      timeout: 200,
    });
    expect(modern.ok).toBe(false);
    expect(modern.timedOut).toBe(true);

    // The legacy oracle agrees on the timeout classification.
    const legacy = legacyTry('node -e "setTimeout(()=>{},9999)"', {
      timeout: 200,
    });
    expect(legacy.timedOut).toBe(true);
  });
});

// =============================================================================
// 4. commandAvailable() — true iff the file resolves on PATH.
//    Implemented injection-safely (file is a POSITIONAL arg to the probe,
//    never interpolated into a script). Mirrors legacy commandAvailable.
// =============================================================================
describe("commandAvailable() — equivalence with legacy commandAvailable", () => {
  it("is true for a command on PATH (node) — matches the oracle", () => {
    expect(commandAvailable("node")).toBe(true);
    expect(legacyAvailable("node", { env: process.env })).toBe(true);
  });

  it("is false for a nonsense command — matches the oracle", () => {
    expect(commandAvailable("definitely-not-a-codenuke-command")).toBe(false);
    expect(legacyAvailable("definitely-not-a-codenuke-command", { env: { PATH: "" } })).toBe(false);
  });

  it("is false for the empty string — matches the oracle", () => {
    expect(commandAvailable("")).toBe(false);
    expect(legacyAvailable("", { env: process.env })).toBe(false);
  });

  it.skipIf(!GIT_AVAILABLE)("is true for git (codenuke's hard dependency)", () => {
    expect(commandAvailable("git")).toBe(true);
  });

  it("resolves the probe injection-safely (a metachar-laden 'file' creates nothing)", () => {
    // If the probe interpolated `file` into a shell script, this would touch the
    // sentinel. With `file` as a positional arg to `sh -c 'command -v "$1"'`,
    // the string is inert: command-v simply fails to find it.
    const sentinel = reserveSentinel("availprobe");
    const malicious = `x"; touch ${sentinel}; "`;
    expect(commandAvailable(malicious)).toBe(false);
    expect(existsSync(sentinel)).toBe(false);
  });
});

// =============================================================================
// 5. SECURITY — THE HEADLINE OF THIS SLICE (CWE-78).
// =============================================================================

// -----------------------------------------------------------------------------
// 5a. Prove the legacy vulnerability AND the fix, side by side.
// -----------------------------------------------------------------------------
describe("SECURITY — CWE-78 command-substitution: legacy is vulnerable, new substrate is not", () => {
  it("LEGACY substrate EXECUTES injected command substitution (the vulnerability)", () => {
    // Sentinel that does NOT exist. quoteShellArg = JSON.stringify only wraps in
    // double quotes; `$(...)` inside double quotes is still expanded by the
    // shell, so the injected `touch` runs and CREATES the sentinel.
    const sentinelA = reserveSentinel("legacy-vuln");
    expect(existsSync(sentinelA)).toBe(false);

    legacyRun(`echo ${legacyQuote(`$(touch ${sentinelA})`)}`);

    // The smoking gun: a file appeared on disk purely because of injected text.
    expect(existsSync(sentinelA)).toBe(true);

    // Clean up the artifact the vulnerability created.
    rmSync(sentinelA, { force: true });
  });

  it("NEW substrate treats the same payload as inert data (the fix)", () => {
    // Same `$(touch ...)` text, now passed as a single argv element. There is
    // no shell, so it is echoed back verbatim and NEVER executed.
    const sentinelB = reserveSentinel("modern-safe");
    expect(existsSync(sentinelB)).toBe(false);

    const payload = `$(touch ${sentinelB})`;
    const out = run("echo", [payload]);

    // No side effect: the file was never created.
    expect(existsSync(sentinelB)).toBe(false);
    // The literal injection text reached the program as data.
    expect(out).toContain(payload);
  });
});

// -----------------------------------------------------------------------------
// 5b. Injection fuzz — a battery of metacharacter payloads, each passed as a
//     single arg. Each must (i) round-trip back as the literal argv value and
//     (ii) leave its dedicated sentinel ABSENT.
// -----------------------------------------------------------------------------
describe("SECURITY — injection fuzz: every metacharacter payload is treated as data", () => {
  // Each payload embeds a `touch <SENTINEL>` so that IF the substrate ever fell
  // back to a shell, the side effect would be detectable on disk. Each `make`
  // receives a unique reserved sentinel path.
  const payloadTemplates: Array<{ tag: string; make: (s: string) => string }> = [
    { tag: "semicolon", make: (s) => `; touch ${s}` },
    { tag: "and-and", make: (s) => `&& touch ${s}` },
    { tag: "pipe", make: (s) => `| touch ${s}` },
    { tag: "backtick", make: (s) => `\`touch ${s}\`` },
    { tag: "cmd-subst", make: (s) => `$(touch ${s})` },
    { tag: "newline", make: (s) => `\ntouch ${s}\n` },
    // Argument-injection vector: a leading-dash payload that a careless callee
    // could mistake for an option (covers CWE-88-style smuggling too).
    { tag: "dash-bad-flag", make: (s) => `--bad-flag=touch:${s}` },
  ];

  it("round-trips each payload verbatim and creates no side-effect file", () => {
    for (const { tag, make } of payloadTemplates) {
      const sentinel = reserveSentinel(`fuzz-${tag}`);
      const payload = make(sentinel);

      // The `--` separator tells NODE ITSELF to stop parsing options, so even a
      // leading-dash payload lands at process.argv[1] (the first positional)
      // instead of being consumed by node's own CLI parser. argv[0] is the node
      // binary. We then echo argv[1] straight back to assert exact pass-through.
      // This isolates what we are characterizing — "the SUBSTRATE delivered the
      // payload as one literal argv element" — from node's option handling.
      const out = run("node", ["-e", "process.stdout.write(process.argv[1] ?? '')", "--", payload]);

      // (i) Treated as DATA: the program received the payload byte-for-byte.
      expect(out, `payload [${tag}] must round-trip verbatim`).toBe(payload);
      // (ii) No shell ran it: the sentinel side-effect never happened.
      expect(existsSync(sentinel), `payload [${tag}] must not create a side-effect file`).toBe(
        false,
      );
    }
  });
});

// -----------------------------------------------------------------------------
// 5c. Argument-injection / no glob expansion — `*` is delivered literally,
//     never expanded by a shell into the cwd's filenames.
// -----------------------------------------------------------------------------
describe("SECURITY — no glob expansion: wildcards are passed literally", () => {
  it("passes '*' as exactly one literal argument (no filename expansion)", () => {
    // If a shell were involved, '*' would expand to every entry in cwd and
    // argv.length would balloon. With arg-arrays it is always exactly 2:
    // [nodeBinary, "*"].
    const out = run("node", ["-e", "process.stdout.write(String(process.argv.length))", "*"]);
    expect(out).toBe("2");
  });

  it("passes '*' through verbatim as the argument value", () => {
    const out = run("node", ["-e", "process.stdout.write(process.argv[1] ?? '')", "*"]);
    expect(out).toBe("*");
  });
});

// Security deviation (architecture review H1): the legacy probe ran `command -v -v`
// for a leading-dash name and returned a false-positive `true`. The new probe uses
// `command -v -- "$1"`, so a dash-prefixed non-existent name is correctly unavailable.
describe("commandAvailable — leading-dash hardening (stricter than legacy)", () => {
  it("returns false for non-existent leading-dash names", () => {
    expect(commandAvailable("-v")).toBe(false);
    expect(commandAvailable("-p")).toBe(false);
    expect(commandAvailable("--")).toBe(false);
  });

  it("still resolves a real command", () => {
    expect(commandAvailable("node")).toBe(true);
  });
});
