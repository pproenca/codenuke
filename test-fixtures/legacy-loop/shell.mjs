import { execSync } from "node:child_process";

export const quoteShellArg = (value) => JSON.stringify(value);

export function runCommand(command, options = {}) {
  const result = execSync(command, {
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return result ? result.toString() : "";
}

export function tryCommand(command, options = {}) {
  try {
    return { ok: true, out: runCommand(command, options) };
  } catch (error) {
    return {
      ok: false,
      out: (error.stdout?.toString() || "") + (error.stderr?.toString() || ""),
      timedOut: error.signal === "SIGTERM" || error.code === "ETIMEDOUT",
    };
  }
}

export function commandAvailable(command, options = {}) {
  if (!command) return false;
  return tryCommand(`command -v ${quoteShellArg(command)}`, {
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
  }).ok;
}
