import { join, resolve } from "node:path";
import {
  ClawnukeConfig,
  configSchema,
  ProjectCommands,
  reasoningEffortSchema,
  reasoningEfforts,
} from "./types.js";
import { ClawnukeError } from "./errors.js";
import { pathExists, readJson } from "./fs.js";

export type GlobalOptions = {
  root?: string;
  stateDir?: string;
  config?: string;
  json: boolean;
  plain: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  noColor: boolean;
  noInput: boolean;
};

export const defaultCommands: ProjectCommands = {
  typecheck: null,
  lint: null,
  format: null,
  test: null,
};

export function defaultConfig(): ClawnukeConfig {
  return {
    schemaVersion: 1,
    stateDir: ".clawnuke",
    include: ["**/*"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "target/**",
      ".build/**",
      ".git/**",
      ".clawnuke/**",
    ],
    provider: {
      name: "codex",
      model: null,
      reasoningEffort: null,
    },
    commands: defaultCommands,
    review: {
      maxContextFiles: 24,
      maxOwnedFiles: 12,
      maxFindingsPerFeature: 10,
      minConfidenceToFix: "medium",
    },
    git: {
      requireCleanWorktreeForFix: true,
      commit: false,
      openPr: false,
    },
  };
}

export async function loadConfig(root: string, options: GlobalOptions): Promise<ClawnukeConfig> {
  const configPath = await discoverConfigPath(root, options);
  const base = configPath === null ? defaultConfig() : await readJson(configPath, configSchema);
  return {
    ...base,
    stateDir: options.stateDir ?? process.env["CLAWNUKE_STATE_DIR"] ?? base.stateDir,
    provider: {
      ...base.provider,
      name: process.env["CLAWNUKE_PROVIDER"] ?? base.provider.name,
      model: process.env["CLAWNUKE_MODEL"] ?? base.provider.model,
      reasoningEffort:
        parseReasoningEffort(process.env["CLAWNUKE_REASONING_EFFORT"]) ??
        base.provider.reasoningEffort,
    },
  };
}

export function resolveStateDir(root: string, config: ClawnukeConfig): string {
  return resolve(root, config.stateDir);
}

function parseReasoningEffort(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = reasoningEffortSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ClawnukeError(
    `invalid reasoning effort: ${value}; expected ${reasoningEfforts.join(", ")}`,
    2,
    "invalid-usage",
  );
}

async function discoverConfigPath(root: string, options: GlobalOptions): Promise<string | null> {
  if (options.config !== undefined) {
    return resolve(options.config);
  }
  if (process.env["CLAWNUKE_CONFIG"] !== undefined) {
    return resolve(process.env["CLAWNUKE_CONFIG"]);
  }
  const configuredStateDir = options.stateDir ?? process.env["CLAWNUKE_STATE_DIR"];
  const candidates = [
    ...(configuredStateDir === undefined
      ? []
      : [join(resolve(root, configuredStateDir), "config.json")]),
    join(root, "clawnuke.config.json"),
    join(root, ".clawnuke", "config.json"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}
