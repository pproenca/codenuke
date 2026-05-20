import { describe, expect, it, vi } from "vitest";
import { CodenukeError } from "../platform/errors.js";
import { globalFlagNames, main as cliMain, parseArgs } from "./main.js";

async function helpFor(argv: string[]): Promise<string> {
  let stdout = "";
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  try {
    await cliMain(argv);
    return stdout;
  } finally {
    stdoutSpy.mockRestore();
  }
}

function helpSection(output: string, heading: string): string[] {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line === `${heading}:`);
  if (start === -1) {
    return [];
  }
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length > 0 && !line.startsWith(" ")) {
      break;
    }
    if (line.trim().length > 0) {
      section.push(line.trim());
    }
  }
  return section;
}

function commandNames(output: string): string[] {
  return helpSection(output, "Commands");
}

function globalHelpFlags(output: string): string[] {
  return helpSection(output, "Global flags").flatMap((line) => {
    const longFlag = /--([a-z-]+)(?:\s+<[^>]+>)?/u.exec(line);
    return longFlag?.[1] === undefined ? [] : [longFlag[1]];
  });
}

type HelpFlag = {
  name: string;
  shortName?: string;
  takesValue: boolean;
};

function helpFlags(output: string): HelpFlag[] {
  return helpSection(output, "Flags").flatMap((line) => {
    const longFlag = /--([a-z-]+)(?:\s+<[^>]+>)?/u.exec(line);
    if (longFlag?.[1] === undefined) {
      return [];
    }
    const shortFlag = /(?:^|,\s*)-([a-z])(?=,|\s|$)/u.exec(line);
    const shortName = shortFlag?.[1];
    return [
      {
        name: longFlag[1],
        ...(shortName === undefined ? {} : { shortName }),
        takesValue: longFlag[0].includes("<"),
      },
    ];
  });
}

function invalidUsageFor(argv: string[]): CodenukeError {
  try {
    parseArgs(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(CodenukeError);
    return error as CodenukeError;
  }
  throw new Error(`expected parseArgs(${argv.join(" ")}) to throw`);
}

describe("cli metadata", () => {
  it("keeps command help flags aligned with argument validation", async () => {
    const help = await helpFor(["--help"]);
    const commands = commandNames(help);
    const globalFlags = new Set(globalFlagNames());
    expect(commands).toEqual([
      "init",
      "map",
      "status",
      "review",
      "report",
      "show",
      "next",
      "triage",
      "fix",
      "revalidate",
      "doctor",
      "clean-locks",
    ]);
    expect(globalHelpFlags(help)).toEqual([...globalFlagNames(), "help", "version"]);

    const commandFlags = new Map<string, HelpFlag[]>();
    const advertisedFlags = new Map<string, HelpFlag[]>();
    for (const command of commands) {
      const commandHelp = await helpFor([command, "--help"]);
      expect(commandHelp).toContain(`codenuke ${command}`);
      const flags = helpFlags(commandHelp);
      advertisedFlags.set(command, flags);
      commandFlags.set(
        command,
        flags.filter((flag) => !globalFlags.has(flag.name)),
      );
    }
    expect(commandFlags.get("report")).toContainEqual({
      name: "output",
      shortName: "o",
      takesValue: true,
    });

    const allFlags = [...commandFlags.values()].flat();
    for (const command of commands) {
      const flags = commandFlags.get(command) ?? [];
      const args = [command];
      for (const flag of flags) {
        args.push(`--${flag.name}`);
        if (flag.takesValue) {
          args.push("x");
        }
      }
      expect(() => parseArgs(args)).not.toThrow();

      const aliasArgs = [command];
      for (const flag of advertisedFlags.get(command) ?? []) {
        aliasArgs.push(flag.shortName === undefined ? `--${flag.name}` : `-${flag.shortName}`);
        if (flag.takesValue) {
          aliasArgs.push("x");
        }
      }
      expect(() => parseArgs(aliasArgs)).not.toThrow();

      const unsupported = allFlags.find(
        (candidate) => !flags.some((flag) => flag.name === candidate.name),
      );
      expect(unsupported).toBeDefined();
      const unsupportedArgs = [command, `--${unsupported?.name ?? ""}`];
      if (unsupported?.takesValue === true) {
        unsupportedArgs.push("x");
      }
      expect(() => parseArgs(unsupportedArgs)).toThrow(`unsupported flag for ${command}`);
    }
  });
});

describe("parseArgs", () => {
  it("rejects unknown commands with invalid usage", () => {
    expect(invalidUsageFor(["does-not-exist"])).toMatchObject({
      code: "invalid-usage",
      exitCode: 2,
      message: "unknown command: does-not-exist",
    });
  });

  it("rejects unsupported flags for known commands", () => {
    expect(invalidUsageFor(["show", "--status", "open"])).toMatchObject({
      code: "invalid-usage",
      exitCode: 2,
      message: "unsupported flag for show: --status",
    });
  });

  it("rejects empty revalidate selector values", () => {
    expect(() => parseArgs(["revalidate", "--finding", ""])).toThrow(
      "missing --finding, --all, or --since",
    );
    expect(() => parseArgs(["revalidate", "--since", ""])).toThrow(
      "missing --finding, --all, or --since",
    );
    expect(() => parseArgs(["revalidate", "--all"])).not.toThrow();
  });

  it("accepts ludicrous mode for review only", () => {
    expect(parseArgs(["review", "--ludicrous-mode"]).flags).toMatchObject({
      ludicrousMode: true,
    });
    expect(() => parseArgs(["map", "--ludicrous-mode"])).toThrow(
      "unsupported flag for map: --ludicrous-mode",
    );
  });
});
