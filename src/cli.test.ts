import { describe, expect, it, vi } from "vitest";
import { main as cliMain, parseArgs } from "./cli.js";

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

const globalFlags = new Set(["json", "quiet"]);

describe("cli metadata", () => {
  it("keeps command help flags aligned with argument validation", async () => {
    const help = await helpFor(["--help"]);
    const commands = commandNames(help);
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
