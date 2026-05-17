#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  cleanLocksCommand,
  doctorCommand,
  fixCommand,
  initCommand,
  makeContext,
  mapCommand,
  reportCommand,
  revalidateCommand,
  reviewCommand,
  nextCommand,
  showCommand,
  statusCommand,
  triageCommand,
} from "./app.js";
import { CodenukeError } from "./errors.js";
import { GlobalOptions } from "./config.js";

const moduleRequire = createRequire(import.meta.url);

export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printHelp(parsed.command);
    return;
  }
  if (parsed.version) {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  const context = await makeContext(parsed.global);
  const result = await dispatch(context, parsed.command, parsed.flags);
  writeResult(result, parsed.global);
}

async function dispatch(
  context: Awaited<ReturnType<typeof makeContext>>,
  command: string,
  flags: Record<string, string | boolean>,
): Promise<unknown> {
  if (!isKnownCommand(command)) {
    throw new CodenukeError(`unknown command: ${command}`, 2, "invalid-usage");
  }
  return commandRegistry[command].handler(context, flags);
}

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
  global: GlobalOptions;
  help: boolean;
  version: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const global: GlobalOptions = {
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    debug: false,
    noColor: false,
    noInput: false,
  };
  const flags: Record<string, string | boolean> = {};
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (command === "" && !arg.startsWith("-")) {
      command = arg;
      continue;
    }
    const globalValueName = arg.startsWith("--") ? camel(arg.replace(/^--/u, "")) : "";
    const target = isGlobalFlag(globalValueName) ? global : flags;
    if (arg === "-h" || arg === "--help") {
      return { command, flags, global, help: true, version: false };
    }
    if (arg === "--version") {
      return { command, flags, global, help: false, version: true };
    }
    const valueName = arg.replace(/^--/u, "");
    const flagDefinition = flagDefinitionFor(valueName);
    if (flagDefinition?.kind === "value") {
      const next = readFlagValue(argv, index, arg);
      index += 1;
      setFlag(target, camel(valueName), next);
      continue;
    }
    if (arg.startsWith("--") && flagDefinition?.kind === "boolean") {
      setFlag(target, camel(valueName), true);
      continue;
    }
    if (arg === "-q") {
      global.quiet = true;
      continue;
    }
    if (arg === "-v") {
      global.verbose = true;
      continue;
    }
    if (arg === "-o") {
      const next = readFlagValue(argv, index, "-o");
      index += 1;
      flags["output"] = next;
      continue;
    }
    throw new CodenukeError(`unknown arg: ${arg}`, 2, "invalid-usage");
  }
  if (command === "") {
    command = "status";
  }
  validateCommandFlags(command, flags);
  validateCommandRequirements(command, flags);
  return { command, flags, global, help: false, version: false };
}

type FlagDefinition = {
  kind: "boolean" | "value";
  help: string;
  global?: boolean;
};

const flagDefinitions = {
  root: { kind: "value", help: "--root <path>", global: true },
  stateDir: { kind: "value", help: "--state-dir <path>", global: true },
  config: { kind: "value", help: "--config <path>", global: true },
  json: { kind: "boolean", help: "--json", global: true },
  plain: { kind: "boolean", help: "--plain", global: true },
  quiet: { kind: "boolean", help: "-q, --quiet", global: true },
  verbose: { kind: "boolean", help: "-v, --verbose", global: true },
  debug: { kind: "boolean", help: "--debug", global: true },
  noColor: { kind: "boolean", help: "--no-color", global: true },
  noInput: { kind: "boolean", help: "--no-input", global: true },
  feature: { kind: "value", help: "--feature <id>" },
  finding: { kind: "value", help: "--finding <id>" },
  limit: { kind: "value", help: "--limit <n>" },
  since: { kind: "value", help: "--since <ref>" },
  jobs: { kind: "value", help: "--jobs <n>        default: 10" },
  source: { kind: "value", help: "--source <heuristic|auto|agent>" },
  provider: { kind: "value", help: "--provider <name>" },
  model: { kind: "value", help: "--model <name>" },
  reasoningEffort: {
    kind: "value",
    help: "--reasoning-effort <none|minimal|low|medium|high|xhigh>",
  },
  output: { kind: "value", help: "--output <path>" },
  status: { kind: "value", help: "--status <status>" },
  severity: { kind: "value", help: "--severity <severity>" },
  category: { kind: "value", help: "--category <category>" },
  triage: { kind: "value", help: "--triage <triage>" },
  project: { kind: "value", help: "--project <name-or-root>" },
  note: { kind: "value", help: "--note <text>" },
  dryRun: { kind: "boolean", help: "--dry-run" },
  force: { kind: "boolean", help: "--force" },
  all: { kind: "boolean", help: "--all" },
} satisfies Record<string, FlagDefinition>;

type FlagName = keyof typeof flagDefinitions;
type CommandContext = Awaited<ReturnType<typeof makeContext>>;
type CommandHandler = (
  context: CommandContext,
  flags: Record<string, string | boolean>,
) => Promise<unknown>;
type CommandFlag = FlagName | { name: FlagName; help: string };
type CommandSpec = {
  handler: CommandHandler;
  flags: readonly CommandFlag[];
  usage: readonly string[];
  required?: readonly FlagName[];
  oneOf?: readonly FlagName[];
  oneOfError?: string;
  globalHelpFlags?: readonly FlagName[];
};

const commandRegistry = {
  init: {
    handler: initCommand,
    flags: ["force"],
    usage: ["codenuke init [flags]"],
    globalHelpFlags: ["json"],
  },
  map: {
    handler: mapCommand,
    flags: ["source", "provider", "model", "reasoningEffort", "dryRun"],
    usage: ["codenuke map [flags]"],
    globalHelpFlags: ["json"],
  },
  status: {
    handler: statusCommand,
    flags: [],
    usage: ["codenuke status [flags]"],
    globalHelpFlags: ["json"],
  },
  review: {
    handler: reviewCommand,
    flags: [
      "feature",
      "project",
      "limit",
      "since",
      "jobs",
      "provider",
      "model",
      "reasoningEffort",
      "dryRun",
    ],
    usage: ["codenuke review [flags]"],
    globalHelpFlags: ["json", "quiet"],
  },
  report: {
    handler: reportCommand,
    flags: ["status", "severity", "feature", "project", "category", "triage", "output"],
    usage: ["codenuke report [flags]"],
    globalHelpFlags: ["json"],
  },
  show: {
    handler: showCommand,
    flags: ["finding"],
    usage: ["codenuke show --finding <id> [flags]"],
    required: ["finding"],
    globalHelpFlags: ["json"],
  },
  next: {
    handler: nextCommand,
    flags: [{ name: "status", help: "--status <status>  default: open" }, "project"],
    usage: ["codenuke next [flags]"],
    globalHelpFlags: ["json"],
  },
  triage: {
    handler: triageCommand,
    flags: [
      "finding",
      { name: "status", help: "--status <open|false-positive|fixed|wont-fix|uncertain>" },
      "note",
    ],
    usage: ["codenuke triage --finding <id> --status <status> [flags]"],
    required: ["finding", "status"],
    globalHelpFlags: ["json"],
  },
  fix: {
    handler: fixCommand,
    flags: ["finding", "provider", "model", "reasoningEffort", "dryRun"],
    usage: ["codenuke fix --finding <id> [flags]"],
    required: ["finding"],
    globalHelpFlags: ["json"],
  },
  revalidate: {
    handler: revalidateCommand,
    flags: [
      "finding",
      "all",
      "status",
      "severity",
      "feature",
      "category",
      "triage",
      "limit",
      "since",
      "provider",
      "model",
      "reasoningEffort",
    ],
    usage: [
      "codenuke revalidate --finding <id> [flags]",
      "codenuke revalidate --all [flags]",
      "codenuke revalidate --since <ref> [flags]",
    ],
    oneOf: ["finding", "all", "since"],
    oneOfError: "missing --finding, --all, or --since",
    globalHelpFlags: ["json"],
  },
  doctor: {
    handler: doctorCommand,
    flags: ["provider", "model", "reasoningEffort"],
    usage: ["codenuke doctor [flags]"],
    globalHelpFlags: ["json"],
  },
  "clean-locks": {
    handler: cleanLocksCommand,
    flags: [],
    usage: ["codenuke clean-locks [flags]"],
    globalHelpFlags: ["json"],
  },
} satisfies Record<string, CommandSpec>;

const shortFlagNames = new Set(["-h", "-q", "-v", "-o"]);

export function packageVersion(): string {
  const pkg = moduleRequire("../package.json") as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

function validateCommandFlags(command: string, flags: Record<string, string | boolean>): void {
  if (!isKnownCommand(command)) {
    throw new CodenukeError(`unknown command: ${command}`, 2, "invalid-usage");
  }
  const allowed = commandRegistry[command].flags.map(flagName);
  for (const flag of Object.keys(flags)) {
    if (!allowed.includes(flag as FlagName)) {
      throw new CodenukeError(
        `unsupported flag for ${command}: --${kebab(flag)}`,
        2,
        "invalid-usage",
      );
    }
  }
}

function validateCommandRequirements(
  command: string,
  flags: Record<string, string | boolean>,
): void {
  if (!isKnownCommand(command)) {
    throw new CodenukeError(`unknown command: ${command}`, 2, "invalid-usage");
  }
  const spec = commandRegistry[command];
  const required = "required" in spec ? spec.required : [];
  for (const flag of required) {
    if (typeof flags[flag] !== "string" || flags[flag].length === 0) {
      throw new CodenukeError(`missing --${kebab(flag)}`, 2, "invalid-usage");
    }
  }
  if ("oneOf" in spec && !spec.oneOf.some((flag: FlagName) => hasFlagValue(flag, flags))) {
    const oneOfError = "oneOfError" in spec ? spec.oneOfError : "missing required flag";
    throw new CodenukeError(oneOfError, 2, "invalid-usage");
  }
}

function isKnownCommand(command: string): command is keyof typeof commandRegistry {
  return Object.hasOwn(commandRegistry, command);
}

function flagName(flag: CommandFlag): FlagName {
  return typeof flag === "string" ? flag : flag.name;
}

function flagHelp(flag: CommandFlag): string {
  return typeof flag === "string" ? flagDefinitions[flag].help : flag.help;
}

function flagDefinitionFor(name: string): FlagDefinition | undefined {
  const flag = camel(name);
  return isFlagName(flag) ? flagDefinitions[flag] : undefined;
}

function isFlagName(name: string): name is FlagName {
  return Object.hasOwn(flagDefinitions, name);
}

function hasFlagValue(flag: FlagName, flags: Record<string, string | boolean>): boolean {
  const value = flags[flag];
  if (flagDefinitions[flag].kind === "boolean") {
    return value === true;
  }
  return typeof value === "string";
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (next === undefined || isKnownOptionToken(next)) {
    throw new CodenukeError(`missing value for ${flag}`, 2, "invalid-usage");
  }
  return next;
}

function isKnownOptionToken(value: string): boolean {
  if (shortFlagNames.has(value)) {
    return true;
  }
  return value.startsWith("--");
}

function setFlag(
  target: Record<string, string | boolean>,
  name: string,
  value: string | boolean,
): void {
  target[name] = value;
}

function isGlobalFlag(name: string): name is keyof GlobalOptions {
  return (
    isFlagName(name) && "global" in flagDefinitions[name] && flagDefinitions[name].global === true
  );
}

function camel(value: string): string {
  return value.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function writeResult(result: unknown, options: GlobalOptions): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "markdown" in result &&
    typeof result.markdown === "string" &&
    !options.plain
  ) {
    process.stdout.write(result.markdown);
    return;
  }
  if (typeof result === "object" && result !== null) {
    for (const [key, value] of Object.entries(result)) {
      if (key === "project" && typeof value === "object") {
        continue;
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        process.stdout.write(`${key}: ${String(value)}\n`);
      }
    }
    return;
  }
  process.stdout.write(`${String(result)}\n`);
}

function printHelp(command = ""): void {
  if (isKnownCommand(command)) {
    const spec = commandRegistry[command];
    const flags = [
      ...spec.flags.map(flagHelp),
      ...(spec.globalHelpFlags ?? []).map((flag) => flagDefinitions[flag].help),
    ];
    process.stdout.write(`codenuke ${command}

Usage:
${spec.usage.map((line) => `  ${line}`).join("\n")}

Flags:
${flags.map((line) => `  ${line}`).join("\n")}
`);
    return;
  }
  const commands = Object.keys(commandRegistry)
    .map((name) => `  ${name}`)
    .join("\n");
  process.stdout.write(`codenuke: automated code review for reliable, trusted refactoring

Usage:
  codenuke [global flags] <command> [flags]

Commands:
${commands}

Global flags:
  ${flagDefinitions.root.help}
  ${flagDefinitions.stateDir.help}
  ${flagDefinitions.config.help}
  ${flagDefinitions.json.help}
  ${flagDefinitions.plain.help}
  ${flagDefinitions.quiet.help}
  ${flagDefinitions.verbose.help}
  ${flagDefinitions.debug.help}
  ${flagDefinitions.noColor.help}
  ${flagDefinitions.noInput.help}
  -h, --help
  --version
`);
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof CodenukeError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(realpathSync(entry)).href;
}
