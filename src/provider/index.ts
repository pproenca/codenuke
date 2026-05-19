import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommandArgs } from "../platform/exec.js";
import { CodenukeError } from "../platform/errors.js";
import {
  agentMapJsonSchema,
  fixPlanJsonSchema,
  providerJsonSchema,
  reviewJsonSchema,
  revalidateJsonSchema,
} from "./schema.js";
import { extractJson, parseCodexJson, safeProviderPreview } from "./json.js";
import {
  AgentMapOutput,
  FixPlanOutput,
  ReviewOutput,
  RevalidateOutput,
  agentMapOutputSchema,
  fixPlanOutputSchema,
  reviewOutputSchema,
  revalidateOutputSchema,
  type ReasoningEffort,
} from "../platform/types.js";

export { extractJson } from "./json.js";

export type ProviderOptions = {
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
};
export type Provider = {
  name: string;
  check(root: string): Promise<string>;
  map(root: string, prompt: string, options: ProviderOptions): Promise<AgentMapOutput>;
  review(root: string, prompt: string, options: ProviderOptions): Promise<ReviewOutput>;
  fix(root: string, prompt: string, options: ProviderOptions): Promise<FixPlanOutput>;
  revalidate(root: string, prompt: string, options: ProviderOptions): Promise<RevalidateOutput>;
};

type ProviderOperationName = "map" | "review" | "fix" | "revalidate";
type ProviderOperationOutput = {
  map: AgentMapOutput;
  review: ReviewOutput;
  fix: FixPlanOutput;
  revalidate: RevalidateOutput;
};
type ProviderOperationConfig<K extends ProviderOperationName> = {
  jsonSchema: object;
  parse(output: unknown): ProviderOperationOutput[K];
};
type ProviderOperationModes<Mode> = { [K in ProviderOperationName]: Mode };
type ProviderJsonRunner<Mode> = (
  root: string,
  prompt: string,
  options: ProviderOptions,
  schema: object,
  mode: Mode,
) => Promise<unknown>;

const providerOperations: {
  [K in ProviderOperationName]: ProviderOperationConfig<K>;
} = {
  map: {
    jsonSchema: agentMapJsonSchema,
    parse: (output) => agentMapOutputSchema.parse(output),
  },
  review: {
    jsonSchema: reviewJsonSchema,
    parse: (output) => reviewOutputSchema.parse(output),
  },
  fix: {
    jsonSchema: fixPlanJsonSchema,
    parse: (output) => fixPlanOutputSchema.parse(output),
  },
  revalidate: {
    jsonSchema: revalidateJsonSchema,
    parse: (output) => revalidateOutputSchema.parse(output),
  },
};

const providerOperationModes = {
  codex: {
    map: "read-only",
    review: "read-only",
    fix: "workspace-write",
    revalidate: "read-only",
  },
  opencode: {
    map: true,
    review: true,
    fix: false,
    revalidate: true,
  },
  acpx: {
    map: "read",
    review: "read",
    fix: "approve",
    revalidate: "read",
  },
  grok: {
    map: true,
    review: true,
    fix: false,
    revalidate: true,
  },
} satisfies {
  codex: ProviderOperationModes<string>;
  opencode: ProviderOperationModes<boolean>;
  acpx: ProviderOperationModes<"read" | "approve">;
  grok: ProviderOperationModes<boolean>;
};

function withProviderOperations<Mode>(
  base: Pick<Provider, "name" | "check">,
  runner: ProviderJsonRunner<Mode>,
  modes: ProviderOperationModes<Mode>,
): Provider {
  return {
    ...base,
    map: (root, prompt, options) =>
      runProviderOperation("map", root, prompt, options, runner, modes.map),
    review: (root, prompt, options) =>
      runProviderOperation("review", root, prompt, options, runner, modes.review),
    fix: (root, prompt, options) =>
      runProviderOperation("fix", root, prompt, options, runner, modes.fix),
    revalidate: (root, prompt, options) =>
      runProviderOperation("revalidate", root, prompt, options, runner, modes.revalidate),
  };
}

async function runProviderOperation<K extends ProviderOperationName, Mode>(
  operation: K,
  root: string,
  prompt: string,
  options: ProviderOptions,
  runner: ProviderJsonRunner<Mode>,
  mode: Mode,
): Promise<ProviderOperationOutput[K]> {
  const config = providerOperations[operation];
  const output = await runner(root, prompt, options, config.jsonSchema, mode);
  return config.parse(output);
}

export function providerByName(name: string): Provider {
  if (name === "codex") {
    return codexProvider;
  }
  if (name === "opencode") {
    return opencodeProvider;
  }
  if (name === "acpx") {
    return acpxProvider;
  }
  if (name === "grok") {
    return grokProvider;
  }
  if (name === "mock") {
    return mockProvider;
  }
  if (name === "mock-fail") {
    return mockFailProvider;
  }
  throw new CodenukeError(`unsupported provider: ${name}`, 2, "unsupported-provider");
}

const codexProvider: Provider = withProviderOperations(
  {
    name: "codex",
    async check(root: string): Promise<string> {
      const result = await runCommandArgs("codex", ["--version"], root);
      if (result.exitCode !== 0) {
        throw new CodenukeError("codex CLI not available", 4, "provider-auth");
      }
      return result.stdout.trim();
    },
  },
  (root, prompt, options, schema, sandbox) => runCodexJson(root, prompt, options, schema, sandbox),
  providerOperationModes.codex,
);

const opencodeProvider: Provider = withProviderOperations(
  {
    name: "opencode",
    async check(root: string): Promise<string> {
      const result = await runCommandArgs("opencode", ["--version"], root);
      if (result.exitCode !== 0) {
        throw new CodenukeError("opencode CLI not available", 4, "provider-auth");
      }
      return result.stdout.trim();
    },
  },
  (root, prompt, options, schema, readOnly) =>
    runOpencodeJson(root, prompt, options.model, schema, readOnly),
  providerOperationModes.opencode,
);

const ACPX_TESTED_VERSIONS = "^0.8.0";
const ACPX_DEFAULT_TIMEOUT_MS = 180_000;

const acpxProvider: Provider = withProviderOperations<"read" | "approve">(
  {
    name: "acpx",
    async check(root: string): Promise<string> {
      const result = await runCommandArgs("acpx", ["--version"], root);
      if (result.exitCode !== 0) {
        throw new CodenukeError(
          "acpx CLI not available. Install: npm install -g acpx@latest",
          4,
          "provider-auth",
        );
      }
      const version = result.stdout.trim();
      return `${version} (tested against ${ACPX_TESTED_VERSIONS})`;
    },
  },
  (root, prompt, options, schema, permission) =>
    runAcpxJson(root, prompt, options.model, schema, permission),
  providerOperationModes.acpx,
);

const grokProvider: Provider = withProviderOperations(
  {
    name: "grok",
    async check(root: string): Promise<string> {
      const result = await runCommandArgs("grok", ["--version"], root);
      if (result.exitCode !== 0) {
        throw new CodenukeError("grok CLI not available", 4, "provider-auth");
      }
      return result.stdout.trim();
    },
  },
  (root, prompt, options, schema, readOnly) =>
    runGrokJson(root, prompt, options.model, schema, readOnly),
  providerOperationModes.grok,
);

const mockProvider: Provider = {
  name: "mock",
  async check(): Promise<string> {
    return "mock";
  },
  async map(_root: string, prompt: string): Promise<AgentMapOutput> {
    const paths = [...prompt.matchAll(/"([^"]*agent\/[^"]+\.[^"]+)"/gu)]
      .map((match) => match[1]?.trim())
      .filter((path): path is string => path !== undefined && path.length > 0);
    const owned = [...new Set(paths.filter((path) => !/test|spec/u.test(path)))].slice(0, 6);
    const tests = paths.filter((path) => /test|spec/u.test(path)).slice(0, 3);
    return {
      features:
        owned.length === 0
          ? []
          : [
              {
                title: "Agent mapped package agent",
                summary: "Mock agent mapper grouped otherwise unmapped agent files.",
                kind: "library",
                confidence: "medium",
                entrypoints: [{ path: owned[0]!, symbol: null, route: null, command: null }],
                ownedFiles: owned.map((path) => ({ path, reason: "agent mapper owned file" })),
                contextFiles: tests.map((path) => ({ path, reason: "agent mapper nearby test" })),
                tests: tests.map((path) => ({ path, command: "touch SHOULD_NOT_RUN_AGENT_MAP" })),
                tags: ["agent-mapped"],
                trustBoundaries: [],
                reason: "Mock provider detected the agent/ source group.",
              },
            ],
      notes: ["mock agent map"],
    };
  },
  async review(_root: string, prompt: string): Promise<ReviewOutput> {
    if (prompt.includes("TODO_SIMPLIFY")) {
      return {
        findings: [
          {
            title: "Dead code marker can be removed",
            category: "maintainability",
            severity: "low",
            confidence: "high",
            evidence: [
              {
                path: "src/index.ts",
                startLine: null,
                endLine: null,
                symbol: null,
                quote: "TODO_SIMPLIFY",
              },
            ],
            reasoning: "Mock provider found an explicit simplification marker.",
            reproduction: null,
            recommendation: "Remove the marked dead code while preserving exported behavior.",
            whyTestsDoNotAlreadyCoverThis:
              "Mock fixtures do not encode this marker as required runtime behavior.",
            suggestedRegressionTest: "Run the focused tests after removing the marked code.",
            minimumFixScope: "Remove only the marked simplification target.",
            guidance: {
              applied: [
                {
                  resourceId: "catalog.dispensables.speculative-generality",
                  title: "Speculative Generality",
                  kind: "signal",
                  role: "supporting",
                  reason: "The mock simplification marker represents unnecessary code.",
                  use: "Remove only code proven unnecessary by the fixture marker.",
                },
              ],
            },
          },
        ],
        inspected: { files: ["src/index.ts"], symbols: [], notes: ["mock simplification"] },
      };
    }
    if (!prompt.includes("TODO_BUG") && !prompt.includes("BUG:")) {
      return { findings: [], inspected: { files: [], symbols: [], notes: ["mock clean"] } };
    }
    return {
      findings: [
        {
          title: "Marker bug found",
          category: "bug",
          severity: "medium",
          confidence: "high",
          evidence: [
            {
              path: "src/index.ts",
              startLine: null,
              endLine: null,
              symbol: null,
              quote: "TODO_BUG",
            },
          ],
          reasoning: "Mock provider found an explicit bug marker.",
          reproduction: null,
          recommendation: "Replace marker with real handling.",
          whyTestsDoNotAlreadyCoverThis:
            "Mock fixtures do not encode this marker as intended behavior.",
          suggestedRegressionTest: "Add a focused test that fails when TODO_BUG is present.",
          minimumFixScope: "Replace the marker in the owning feature file.",
          guidance: {
            applied: [
              {
                resourceId: "catalog.dispensables.duplicate-code",
                title: "Duplicate Code",
                kind: "signal",
                role: "supporting",
                reason: "Mock bug findings include a placeholder guidance trace.",
                use: "Use the trace only as schema-compatible mock output.",
              },
            ],
          },
        },
      ],
      inspected: { files: ["src/index.ts"], symbols: [], notes: ["mock finding"] },
    };
  },
  async fix(_root: string, prompt: string): Promise<FixPlanOutput> {
    const appliedResources = [
      "catalog.dispensables.duplicate-code",
      "catalog.dispensables.speculative-generality",
    ]
      .filter((resourceId) => prompt.includes(resourceId))
      .map((resourceId) => ({
        resourceId,
        action: "applied" as const,
        reasoning: "Mock provider accounted for the prompted guidance resource.",
      }));
    return {
      summary: "mock fix plan",
      findingIds: [],
      plannedFiles: [],
      risk: "low",
      steps: ["mock"],
      guidanceApplication: {
        appliedResources,
        deviations: [],
        risk: "low",
      },
      validationCommands: ["touch SHOULD_NOT_RUN_PROVIDER_COMMANDS"],
    };
  },
  async revalidate(_root: string, prompt: string): Promise<RevalidateOutput> {
    if (prompt.includes("REVALIDATE_FIXED")) {
      return {
        outcome: "fixed",
        reasoning: "mock fixed outcome",
        guidanceAssessment: {
          followed: "yes",
          reasoning: "mock guidance acceptable",
          deviations: [],
          acceptable: true,
        },
        commands: ["mock fixed"],
      };
    }
    if (prompt.includes("REVALIDATE_OPEN")) {
      return {
        outcome: "open",
        reasoning: "mock open outcome",
        guidanceAssessment: {
          followed: "partially",
          reasoning: "mock guidance still unresolved",
          deviations: [],
          acceptable: true,
        },
        commands: ["mock open"],
      };
    }
    if (prompt.includes("REVALIDATE_FALSE_POSITIVE")) {
      return {
        outcome: "false-positive",
        reasoning: "mock false-positive outcome",
        guidanceAssessment: {
          followed: "not-applicable",
          reasoning: "mock false positive",
          deviations: [],
          acceptable: true,
        },
        commands: ["mock false-positive"],
      };
    }
    return {
      outcome: "uncertain",
      reasoning: "mock provider cannot inspect fixes",
      guidanceAssessment: {
        followed: "not-applicable",
        reasoning: "mock provider did not assess guidance",
        deviations: [],
        acceptable: true,
      },
      commands: [],
    };
  },
};

const mockFailProvider: Provider = {
  name: "mock-fail",
  async check(): Promise<string> {
    return "mock-fail";
  },
  async map(): Promise<AgentMapOutput> {
    throw new CodenukeError("mock map failure", 1, "mock-failure");
  },
  async review(): Promise<ReviewOutput> {
    throw new CodenukeError("mock review failure", 1, "mock-failure");
  },
  async fix(): Promise<FixPlanOutput> {
    throw new CodenukeError("mock fix failure", 1, "mock-failure");
  },
  async revalidate(): Promise<RevalidateOutput> {
    throw new CodenukeError("mock revalidate failure", 1, "mock-failure");
  },
};

async function runCodexJson(
  root: string,
  prompt: string,
  options: ProviderOptions,
  schema: object,
  sandbox = "read-only",
): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "codenuke-codex-"));
  const schemaPath = join(dir, "schema.json");
  const outputPath = join(dir, "output.json");
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    const args = [
      "exec",
      "--cd",
      root,
      "--sandbox",
      sandbox,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
    ];
    addCodexModelArgs(args, options);
    args.push("-");
    const result = await runCommandArgs("codex", args, root, prompt);
    if (result.exitCode !== 0) {
      throw new CodenukeError(
        `codex provider failed: ${result.stderr || result.stdout}`,
        providerExitCode(result.stderr),
        "provider-failure",
      );
    }
    const raw = await readFile(outputPath, "utf8").then(
      (value) => value,
      () => "",
    );
    if (raw.trim().length === 0) {
      throw new CodenukeError("codex provider produced no JSON output", 8, "malformed-output");
    }
    return parseCodexJson(raw);
  } finally {
    await rm(dir, { recursive: true, force: true }).then(
      () => undefined,
      () => undefined,
    );
  }
}

function addCodexModelArgs(args: string[], options: ProviderOptions): void {
  if (options.model !== null) {
    args.push("--model", options.model);
  }
  if (options.reasoningEffort !== null) {
    args.push("-c", `model_reasoning_effort="${options.reasoningEffort}"`);
  }
}

const OPENCODE_READ_ONLY_PERMISSION = JSON.stringify({
  bash: "deny",
  edit: "deny",
  task: "deny",
  webfetch: "deny",
  websearch: "deny",
});

async function runOpencodeJson(
  root: string,
  prompt: string,
  model: string | null,
  schema: object,
  readOnly: boolean,
): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "codenuke-opencode-"));
  const promptPath = join(dir, "prompt.txt");
  await writeFile(promptPath, opencodePrompt(prompt, schema, readOnly), "utf8");

  try {
    const args = [
      "run",
      "Follow the attached codenuke prompt. Return only the requested JSON object.",
      "--format",
      "json",
      "--dir",
      root,
      `--file=${promptPath}`,
    ];
    if (model !== null) {
      args.push("--model", model);
    }
    if (!readOnly) {
      args.push("--dangerously-skip-permissions");
    }
    const result = await runCommandArgs(
      "opencode",
      args,
      root,
      undefined,
      readOnly
        ? { trimOutput: false, env: { OPENCODE_PERMISSION: OPENCODE_READ_ONLY_PERMISSION } }
        : { trimOutput: false },
    );
    if (result.exitCode !== 0) {
      throw new CodenukeError(
        opencodeFailureMessage(result.stdout, result.stderr),
        providerExitCode(result.stderr),
        "provider-failure",
      );
    }
    return extractOpencodeJson(result.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true }).then(
      () => undefined,
      () => undefined,
    );
  }
}

function opencodePrompt(prompt: string, schema: object, readOnly: boolean): string {
  const promptBody = readOnly
    ? "READ-ONLY REVIEW MODE.\n" +
      "Do not modify, create, or delete any files.\n" +
      "Do not run shell commands or launch subagents.\n\n" +
      prompt
    : prompt;
  return `${promptBody}

Provider output schema:
${JSON.stringify(schema, null, 2)}

Return only one JSON object matching the schema.`;
}

export function extractOpencodeJson(stdout: string): unknown {
  const textParts: string[] = [];
  const observedKinds = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record(event)) {
      continue;
    }
    if (typeof event["type"] === "string") {
      observedKinds.add(event["type"]);
    }
    const part = event["part"];
    if (event["type"] === "text" && record(part) && typeof part["text"] === "string") {
      textParts.push(part["text"]);
    }
    if (event["type"] === "error") {
      const error = record(event["error"]) ? event["error"] : {};
      const data = record(error["data"]) ? error["data"] : {};
      const message =
        typeof data["message"] === "string"
          ? data["message"]
          : typeof error["message"] === "string"
            ? error["message"]
            : typeof error["name"] === "string"
              ? error["name"]
              : "unknown";
      throw new CodenukeError(
        `opencode provider error: ${message}`,
        providerExitCode(message),
        "provider-failure",
      );
    }
  }
  const combined = textParts.join("").trim();
  if (combined.length === 0) {
    throw new CodenukeError(
      `opencode provider produced no extractable text. Observed event kinds: ` +
        `[${[...observedKinds].join(", ")}].`,
      8,
      "malformed-output",
    );
  }
  const parsed = extractJson(combined);
  if (parsed === null) {
    throw new CodenukeError("opencode provider produced unparsable JSON", 8, "malformed-output");
  }
  return parsed;
}

function opencodeFailureMessage(stdout: string, stderr: string): string {
  if (stderr.trim().length > 0) {
    return `opencode provider failed: ${stderr}`;
  }
  const preview = stdout.slice(0, 800).replace(/\s+/gu, " ");
  return preview.length === 0
    ? "opencode provider failed"
    : `opencode provider failed (stdout preview: ${preview})`;
}

export function parseAcpxAgent(model: string | null): {
  agent: string;
  agentModel: string | null;
} {
  if (model === null) {
    return { agent: "codex", agentModel: null };
  }
  const idx = model.indexOf(":");
  if (idx === -1) {
    return { agent: model, agentModel: null };
  }
  return { agent: model.slice(0, idx), agentModel: model.slice(idx + 1) };
}

async function runAcpxJson(
  root: string,
  prompt: string,
  model: string | null,
  schema: object,
  permission: "read" | "approve",
): Promise<unknown> {
  const { agent, agentModel } = parseAcpxAgent(model);
  const permFlag = permission === "read" ? "--approve-reads" : "--approve-all";
  const args = ["--cwd", root, permFlag, "--format", "json", "--json-strict", "--suppress-reads"];
  if (agentModel !== null) {
    args.push("--model", agentModel);
  }
  args.push(agent, "exec", "--file", "-");
  const result = await runCommandArgs(
    "acpx",
    args,
    root,
    buildAcpxPrompt(prompt, schema, permission),
    { trimOutput: false, timeoutMs: acpxTimeoutMs() },
  );
  if (result.exitCode !== 0) {
    throw new CodenukeError(
      acpxFailureMessage(result.stdout, result.stderr, result.exitCode),
      acpxExitCode(result.stdout, result.stderr, result.exitCode),
      "provider-failure",
    );
  }
  return extractAcpxJson(result.stdout);
}

function buildAcpxPrompt(prompt: string, schema: object, permission: "read" | "approve"): string {
  const promptBody =
    permission === "read"
      ? "READ-ONLY REVIEW MODE.\n" +
        "Do not modify, create, or delete any files.\n" +
        "Do not make any tool calls that write to the workspace.\n" +
        "Only read files and report findings in the JSON output below.\n\n" +
        prompt
      : prompt;

  return (
    `${promptBody}\n\n` +
    "Return ONLY a JSON object matching this schema. No prose preamble, no markdown fences, " +
    "no thinking-out-loud text before the JSON. " +
    `Schema:\n${JSON.stringify(schema)}\n`
  );
}

export function extractAcpxJson(stdout: string): unknown {
  const toolCandidates: string[] = [];
  const messageChunks: string[] = [];
  const thoughtChunks: string[] = [];
  const observedKinds = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let env: unknown;
    try {
      env = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record(env) || env["method"] !== "session/update") {
      continue;
    }
    const params = env["params"];
    if (!record(params)) {
      continue;
    }
    const update = params["update"];
    if (!record(update) || typeof update["sessionUpdate"] !== "string") {
      continue;
    }
    const kind = update["sessionUpdate"];
    observedKinds.add(kind);
    const content = record(update["content"]) ? update["content"] : {};
    if (
      kind === "agent_message_chunk" &&
      content["type"] === "text" &&
      typeof content["text"] === "string"
    ) {
      messageChunks.push(content["text"]);
      continue;
    }
    if (
      kind === "agent_thought_chunk" &&
      content["type"] === "text" &&
      typeof content["text"] === "string"
    ) {
      thoughtChunks.push(content["text"]);
      continue;
    }
    if (kind === "tool_call_result" && typeof update["output"] === "string") {
      toolCandidates.push(update["output"]);
    }
  }
  const candidates = [
    ...(messageChunks.length > 0 ? [messageChunks.join("")] : []),
    ...toolCandidates.toReversed(),
    ...(thoughtChunks.length > 0 ? [thoughtChunks.join("")] : []),
  ];
  if (candidates.length === 0) {
    throw new CodenukeError(
      `acpx provider produced no extractable text. Observed envelope kinds: ` +
        `[${[...observedKinds].join(", ")}]. ` +
        `acpx envelope shape may have changed since codenuke was tested ` +
        `against ${ACPX_TESTED_VERSIONS}. Check the installed acpx version.`,
      8,
      "malformed-output",
    );
  }

  let lastErr: unknown;
  for (const candidate of candidates) {
    const text = candidate.trim();
    try {
      const parsed = extractJson(text);
      if (parsed !== null) {
        return parsed;
      }
      throw new Error("no JSON object found");
    } catch (err) {
      lastErr = err;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new CodenukeError(
    `acpx provider produced unparseable JSON: ${message}. ` +
      `Observed envelope kinds: [${[...observedKinds].join(", ")}]. ` +
      `acpx envelope shape may have changed since codenuke was tested ` +
      `against ${ACPX_TESTED_VERSIONS}. Check the installed acpx version.`,
    8,
    "malformed-output",
  );
}

async function runGrokJson(
  root: string,
  prompt: string,
  model: string | null,
  schema: object,
  readOnly: boolean,
): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "codenuke-grok-"));
  const promptPath = join(dir, "prompt.txt");
  await writeFile(promptPath, grokPrompt(prompt, schema), "utf8");

  try {
    const args = [
      "--prompt-file",
      promptPath,
      "--output-format",
      "json",
      "--always-approve",
      "--verbatim",
      "--cwd",
      root,
    ];
    if (model !== null) {
      args.push("-m", model);
    }
    if (readOnly) {
      args.push("--disallowed-tools", "search_replace,run_terminal_cmd,Agent");
    }
    const result = await runCommandArgs("grok", args, root, undefined, { trimOutput: false });
    if (result.exitCode !== 0) {
      throw new CodenukeError(
        `grok provider failed: ${result.stderr || result.stdout}`,
        providerExitCode(result.stderr),
        "provider-failure",
      );
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(result.stdout);
    } catch {
      const preview = result.stdout.slice(0, 200).replace(/\s+/gu, " ");
      throw new CodenukeError(
        `grok provider produced no JSON envelope (stdout preview: ${preview})`,
        8,
        "malformed-output",
      );
    }
    const text = grokEnvelopeText(envelope);
    const parsed = text === null ? envelope : extractJson(text);
    if (parsed === null) {
      throw new CodenukeError("grok provider produced unparsable JSON", 8, "malformed-output");
    }
    return parsed;
  } finally {
    await rm(dir, { recursive: true, force: true }).then(
      () => undefined,
      () => undefined,
    );
  }
}

function grokPrompt(prompt: string, schema: object): string {
  return `${prompt}

Provider output schema:
${JSON.stringify(schema, null, 2)}

Return only one JSON object matching the schema.`;
}

function grokEnvelopeText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!record(value)) {
    return null;
  }
  for (const key of ["text", "response", "output", "content"]) {
    const item = value[key];
    if (typeof item === "string") {
      return item;
    }
  }
  const choices = value["choices"];
  if (!Array.isArray(choices)) {
    return null;
  }
  const first: unknown = choices[0];
  if (!record(first)) {
    return null;
  }
  const message = first["message"];
  if (!record(message)) {
    return null;
  }
  const content = message["content"];
  return typeof content === "string" ? content : null;
}

function providerExitCode(stderr: string): number {
  if (/auth|login|api key|unauthorized|wrong api key/iu.test(stderr)) {
    return 4;
  }
  if (/quota|rate.?limit/iu.test(stderr)) {
    return 5;
  }
  return 1;
}

function acpxFailureMessage(stdout: string, stderr: string, exitCode: number | null): string {
  const error = extractAcpxError(stdout);
  if (error !== null) {
    return `acpx provider failed: ${error}`;
  }
  const stderrPreview = safeProviderPreview(stderr);
  if (stderrPreview.length > 0) {
    return `acpx provider failed: ${stderrPreview}`;
  }
  return `acpx provider failed with exit code ${exitCode ?? "unknown"}`;
}

function extractAcpxError(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let env: unknown;
    try {
      env = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record(env)) {
      continue;
    }
    const error = env["error"];
    if (!record(error)) {
      continue;
    }
    const data = record(error["data"]) ? error["data"] : {};
    const parts = [
      stringPart("code", error["code"]),
      stringPart("acpxCode", data["acpxCode"]),
      stringPart("detail", data["detailCode"]),
      stringPart("origin", data["origin"]),
      stringPart("message", error["message"], 160),
    ].filter((part) => part.length > 0);
    if (parts.length > 0) {
      return parts.join("; ");
    }
  }
  return null;
}

function stringPart(label: string, value: unknown, maxLength = 80): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const preview = safeProviderPreview(String(value), maxLength);
  return preview.length === 0 ? "" : `${label}=${preview}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acpxExitCode(stdout: string, stderr: string, exitCode: number | null): number {
  const combined = `${stderr}\n${extractAcpxError(stdout) ?? ""}`;
  if (/auth|login|api key|not authenticated|AUTH_REQUIRED/iu.test(combined)) {
    return 4;
  }
  if (/quota|rate.?limit/iu.test(combined)) {
    return 5;
  }
  if (/acpx: command not found|spawn acpx ENOENT/iu.test(combined)) {
    return 4;
  }
  if (exitCode === 3 || exitCode === 124 || /TIMEOUT|timed out/iu.test(combined)) {
    return 1;
  }
  return 1;
}

function acpxTimeoutMs(): number {
  const raw =
    process.env["CODENUKE_ACPX_TIMEOUT_MS"] ?? process.env["CODENUKE_PROVIDER_TIMEOUT_MS"];
  if (raw === undefined) {
    return ACPX_DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : ACPX_DEFAULT_TIMEOUT_MS;
}

// eslint-disable-next-line no-underscore-dangle
export const __testing = {
  acpxFailureMessage,
  addCodexModelArgs,
  extractAcpxJson,
  extractOpencodeJson,
  parseAcpxAgent,
  parseCodexJson,
  providerOperationModes,
  providerJsonSchema,
  withProviderOperations,
};
