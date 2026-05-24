#!/usr/bin/env node
/**
 * Modernized codenuke CLI dispatcher.
 *
 * This replaces `bin/codenuke.mjs` for the migrated TypeScript workspace.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCalibrateCommand } from "@codenuke/calibrate";
import { runChangeCostCommand } from "@codenuke/changecost";
import { runFenceCommand, textReporter } from "@codenuke/fence/runtime";
import { cliHelpText, commandTarget } from "@codenuke/orchestrator";
import { runAutoloop, runDoctor } from "@codenuke/orchestrator/runtime";
import { runScorerCommand } from "@codenuke/scorer";
import { runValidateProxyCommand } from "@codenuke/value-proxy";

async function packageVersion(): Promise<string> {
  const moduleUrl =
    import.meta.url ?? pathToFileURL(realpathSync(process.argv[1] ?? process.cwd())).href;
  const packageJson = fileURLToPath(new URL("../package.json", moduleUrl));
  return (JSON.parse(readFileSync(packageJson, "utf8")) as { version: string }).version;
}

function parseIterations(value: string | undefined): number | string {
  if (value == null) {
    return 5;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return `error: iterations must be a non-negative integer, received ${value}\n`;
  }
  return parsed;
}

type LineReporter = { emit(line: string): void };

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function alreadyStreamed(stdout: string, streamed: readonly string[]): boolean {
  const expected = splitLines(stdout);
  if (expected.length === 0) {
    return true;
  }
  const actual = splitLines(streamed.join("\n"));
  let offset = 0;
  for (const line of expected) {
    const next = actual.slice(offset).findIndex((candidate) => candidate === line);
    if (next < 0) {
      return false;
    }
    offset += next + 1;
  }
  return true;
}

function liveReporter(stream: NodeJS.WriteStream, streamed: string[]): LineReporter {
  return {
    emit(line) {
      streamed.push(line);
      stream.write(`${line}\n`);
    },
  };
}

function writeBufferedResult(
  result: { readonly stdout: string; readonly stderr?: string },
  streamed: readonly string[],
): void {
  if (!alreadyStreamed(result.stdout, streamed)) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [cmd, ...rest] = argv;
  const target = commandTarget(cmd);
  if (target?.module === "package-version") {
    process.stdout.write(`${await packageVersion()}\n`);
    return 0;
  }
  if (target?.module === "help") {
    process.stdout.write(`${cliHelpText()}\n`);
    return 0;
  }
  if (cmd === "doctor") {
    const streamed: string[] = [];
    const result = await runDoctor(process.env, process.cwd(), {
      reporter: liveReporter(process.stdout, streamed),
    });
    writeBufferedResult(result, streamed);
    return result.exitCode;
  }
  if (cmd === "fence") {
    const streamed: string[] = [];
    const liveReporter = textReporter((line) => {
      streamed.push(line);
      process.stdout.write(`${line}\n`);
    });
    const result = await runFenceCommand(rest, process.env, process.cwd(), {
      reporter: liveReporter,
    });
    writeBufferedResult(result, streamed);
    return result.exitCode;
  }
  if (cmd === "calibrate") {
    const streamed: string[] = [];
    const result = await runCalibrateCommand(rest, process.env, process.cwd(), {
      reporter: liveReporter(process.stdout, streamed),
    });
    writeBufferedResult(result, streamed);
    return result.exitCode;
  }
  if (cmd === "changecost") {
    const streamed: string[] = [];
    const result = await runChangeCostCommand(rest, process.env, process.cwd(), {
      reporter: liveReporter(process.stdout, streamed),
    });
    writeBufferedResult(result, streamed);
    return result.exitCode;
  }
  if (cmd === "validate-proxy") {
    const streamed: string[] = [];
    const result = await runValidateProxyCommand(rest, process.env, process.cwd(), {
      reporter: liveReporter(process.stdout, streamed),
    });
    writeBufferedResult(result, streamed);
    return result.exitCode;
  }
  if (target?.module === "scorer") {
    const isJson = cmd === "score" && rest.includes("--json");
    const streamed: string[] = [];
    const result = await runScorerCommand(
      [cmd, ...rest].filter((value): value is string => value != null),
      process.env,
      process.cwd(),
      { reporter: liveReporter(isJson ? process.stderr : process.stdout, streamed) },
    );
    if (isJson) {
      process.stdout.write(result.stdout);
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    } else {
      writeBufferedResult(result, streamed);
    }
    return result.exitCode;
  }
  if (cmd === "run" || cmd === "loop") {
    const iterations = parseIterations(rest[0]);
    if (typeof iterations === "string") {
      process.stderr.write(iterations);
      return 2;
    }
    const streamed: string[] = [];
    const result = await runAutoloop(iterations, process.env, process.cwd(), {
      reporter: liveReporter(process.stdout, streamed),
    });
    writeBufferedResult(result, streamed);
    return result.exitCode;
  }
  if (target) {
    process.stderr.write(
      `error: codenuke ${cmd} is recognized but its modernized runtime adapter is not implemented yet. Supported commands: calibrate, changecost, doctor, fence, init, score, accept, revert, status, cleanup, run, validate-proxy.\n`,
    );
    return 2;
  }
  process.stdout.write(`${cliHelpText()}\n`);
  if (cmd) {
    process.stderr.write(`error: unknown command: ${cmd}\n`);
    return 2;
  }
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
