#!/usr/bin/env node
import { createRequire } from "node:module";
import { runCliEntrypoint } from "./bootstrap.js";
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
} from "../workflow/app.js";
import { CodenukeError } from "../platform/errors.js";
import { GlobalOptions } from "../platform/config.js";

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
  const spec = requireCommandSpec(command);
  return spec.handler(context, flags);
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
    if (arg === "-h" || arg === "--help") {
      return { command, flags, global, help: true, version: false };
    }
    if (arg === "--version") {
      return { command, flags, global, help: false, version: true };
    }
    const flag = flagNameForArg(arg);
    if (flag !== undefined) {
      const flagDefinition = flagDefinitions[flag];
      const target = isGlobalFlag(flag) ? global : flags;
      if (flagDefinition.kind === "value") {
        const next = readFlagValue(argv, index, arg);
        index += 1;
        setFlag(target, flag, next);
        continue;
      }
      setFlag(target, flag, true);
      continue;
    }
    throw new CodenukeError(`unknown arg: ${arg}`, 2, "invalid-usage");
  }
  if (command === "") {
    command = "status";
  }
  const spec = requireCommandSpec(command);
  validateCommandFlags(command, spec, flags);
  validateCommandRequirements(spec, flags);
  return { command, flags, global, help: false, version: false };
}

type FlagDefinition = {
  kind: "boolean" | "value";
  help: string;
  aliases?: readonly string[];
  global?: boolean;
};

const flagDefinitions = {
  root: { kind: "value", help: "--root <path>", global: true },
  stateDir: { kind: "value", help: "--state-dir <path>", global: true },
  config: { kind: "value", help: "--config <path>", global: true },
  json: { kind: "boolean", help: "--json", global: true },
  plain: { kind: "boolean", help: "--plain", global: true },
  quiet: { kind: "boolean", aliases: ["-q"], help: "--quiet", global: true },
  verbose: { kind: "boolean", aliases: ["-v"], help: "--verbose", global: true },
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
  output: { kind: "value", aliases: ["-o"], help: "--output <path>" },
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

export function globalFlagNames(): readonly string[] {
  return globalFlagDefinitionNames().map(kebab);
}

function globalFlagDefinitionNames(): readonly FlagName[] {
  return Object.keys(flagDefinitions).filter(isGlobalFlag);
}

const shortFlagNames = new Map<string, FlagName>(
  Object.entries(flagDefinitions).flatMap(([name, definition]) =>
    flagAliases(definition).map((alias): [string, FlagName] => [alias, name as FlagName]),
  ),
);
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

export function packageVersion(): string {
  const pkg: unknown = moduleRequire("../../package.json");
  if (
    typeof pkg === "object" &&
    pkg !== null &&
    "version" in pkg &&
    typeof pkg.version === "string"
  ) {
    return pkg.version;
  }
  return "0.0.0";
}

function requireCommandSpec(command: string): CommandSpec {
  if (!isKnownCommand(command)) {
    throw new CodenukeError(`unknown command: ${command}`, 2, "invalid-usage");
  }
  return commandRegistry[command];
}

function validateCommandFlags(
  command: string,
  spec: CommandSpec,
  flags: Record<string, string | boolean>,
): void {
  const allowed = spec.flags.map(flagName);
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
  spec: CommandSpec,
  flags: Record<string, string | boolean>,
): void {
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
  return typeof flag === "string" ? renderFlagHelp(flag) : flag.help;
}

function renderFlagHelp(flag: FlagName): string {
  const definition = flagDefinitions[flag];
  return [...flagAliases(definition), definition.help].join(", ");
}

function flagAliases(definition: FlagDefinition): readonly string[] {
  return definition.aliases ?? [];
}

function flagNameForArg(arg: string): FlagName | undefined {
  if (arg.startsWith("--")) {
    const flag = camel(arg.replace(/^--/u, ""));
    return isFlagName(flag) ? flag : undefined;
  }
  return shortFlagNames.get(arg);
}

function isFlagName(name: string): name is FlagName {
  return Object.hasOwn(flagDefinitions, name);
}

function hasFlagValue(flag: FlagName, flags: Record<string, string | boolean>): boolean {
  const value = flags[flag];
  if (flagDefinitions[flag].kind === "boolean") {
    return value === true;
  }
  return typeof value === "string" && value.length > 0;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (next === undefined || isKnownOptionToken(next)) {
    throw new CodenukeError(`missing value for ${flag}`, 2, "invalid-usage");
  }
  return next;
}

function isKnownOptionToken(value: string): boolean {
  return value === "-h" || shortFlagNames.has(value) || value.startsWith("--");
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
      ...(spec.globalHelpFlags ?? []).map(renderFlagHelp),
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
  const globalFlagHelp = [
    ...globalFlagDefinitionNames().map(renderFlagHelp),
    "-h, --help",
    "--version",
  ]
    .map((line) => `  ${line}`)
    .join("\n");
  process.stdout.write(`codenuke: automated code review for reliable, trusted refactoring

Usage:
  codenuke [global flags] <command> [flags]

Commands:
${commands}

Global flags:
${globalFlagHelp}
`);
}

void runCliEntrypoint(import.meta.url, process.argv, main);
