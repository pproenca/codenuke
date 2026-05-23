import { spawn } from "node:child_process";

export function runProcessGroup(command, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      detached: true,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    const timeout = opts.timeout ?? 300000;
    let done = false;
    let timedOut = false;
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => {
        if (!done) killGroup("SIGKILL");
      }, 1000).unref();
    }, timeout);
    timer.unref();
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => out.push(chunk));
    child.on("error", (error) => {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, out: String(error), timedOut: false });
    });
    child.on("close", (code) => {
      done = true;
      clearTimeout(timer);
      if (code !== 0 && !timedOut) killGroup("SIGTERM");
      resolve({ ok: code === 0 && !timedOut, out: Buffer.concat(out).toString(), timedOut });
    });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export const runShellGroup = (cmd, opts = {}) => runProcessGroup(cmd, [], { ...opts, shell: true });

export function codexArgs(cwd, options = {}) {
  const env = options.env ?? process.env;
  const args = ["exec", "--cd", cwd];
  const sandbox = env.CN_CODEX_SANDBOX?.trim();
  if (sandbox === "bypass" || sandbox === "none") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", sandbox && sandbox.length > 0 ? sandbox : "workspace-write");
  }
  if (env.CN_MODEL) args.push("--model", env.CN_MODEL);
  if (env.CN_REASONING_EFFORT) {
    args.push("-c", `model_reasoning_effort="${env.CN_REASONING_EFFORT}"`);
  }
  if (options.outputPath) args.push("--output-last-message", options.outputPath);
  args.push("-");
  return args;
}

export function runCodexAgent(prompt, opts) {
  return runProcessGroup("codex", codexArgs(opts.cwd, opts), {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeout,
    input: prompt,
  });
}
