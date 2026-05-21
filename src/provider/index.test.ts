import { describe, expect, it } from "vitest";
import { CodenukeError } from "../platform/errors.js";
import { __testing, extractJson, providerByName } from "./index.js";
import {
  agentMapJsonSchema,
  fixPlanJsonSchema,
  reviewJsonSchema,
  revalidateJsonSchema,
} from "./schema.js";
import { reviewOutputSchema } from "../platform/types.js";

// eslint-disable-next-line no-underscore-dangle
const {
  addCodexModelArgs,
  acpxFailureMessage,
  codexExecArgs,
  codexPrompt,
  extractAcpxJson,
  extractOpencodeJson,
  parseAcpxAgent,
  parseCodexJson,
  providerOperationModes,
  providerJsonSchema,
  withProviderOperations,
} = __testing;

function updateEnvelope(update: object): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "session-1", update },
  });
}

function textChunk(
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk",
  text: string,
): string {
  return updateEnvelope({
    sessionUpdate,
    content: { type: "text", text },
  });
}

function toolResult(output: string): string {
  return updateEnvelope({
    sessionUpdate: "tool_call_result",
    output,
  });
}

function expectMalformed(fn: () => unknown, message: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CodenukeError);
    expect((err as CodenukeError).code).toBe("malformed-output");
    expect((err as CodenukeError).exitCode).toBe(8);
    expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error("expected malformed-output");
}

describe("extractJson", () => {
  it("parses strict JSON directly", () => {
    const input = '{"findings":[],"inspected":{"files":[],"symbols":[],"notes":[]}}';
    expect(extractJson(input)).toEqual({
      findings: [],
      inspected: { files: [], symbols: [], notes: [] },
    });
  });

  it("extracts JSON from json code fence", () => {
    const input =
      'Here is the result:\n\n```json\n{"outcome":"fixed","reasoning":"all good","commands":[]}\n```';
    expect(extractJson(input)).toEqual({ outcome: "fixed", reasoning: "all good", commands: [] });
  });

  it("extracts JSON from generic code fence", () => {
    const input = '```\n{"risk":"low","steps":[]}\n```';
    expect(extractJson(input)).toEqual({ risk: "low", steps: [] });
  });

  it("recovers JSON via balanced brace heuristic", () => {
    const input = 'Some leading text { "title": "x", "nested": { "a": 1 } } trailing';
    expect(extractJson(input)).toEqual({ title: "x", nested: { a: 1 } });
  });

  it("returns null for text with no valid JSON", () => {
    expect(extractJson("no json here at all")).toBeNull();
    expect(extractJson("just some words { unbalanced")).toBeNull();
  });
});

describe("parseCodexJson", () => {
  it("accepts codex output-last-message JSON wrapped in markdown with trailing prose", () => {
    const input = [
      "```json",
      '{"findings":[],"inspected":{"files":[],"symbols":[],"notes":[]}}',
      "```",
      "Now I have a complete picture.",
    ].join("\n");

    expect(parseCodexJson(input)).toEqual({
      findings: [],
      inspected: { files: [], symbols: [], notes: [] },
    });
  });

  it("throws malformed-output when codex output contains no JSON object", () => {
    expectMalformed(() => parseCodexJson("not json"), /codex provider produced unparseable JSON/u);
  });
});

describe("Codex provider args", () => {
  it("keeps Codex trusted-directory checks enabled by default", () => {
    expect(codexExecArgs("/repo", "read-only", "/tmp/schema.json", "/tmp/output.json")).toEqual([
      "exec",
      "--ephemeral",
      "--cd",
      "/repo",
      "--sandbox",
      "read-only",
      "-c",
      'approval_policy="never"',
      "--output-schema",
      "/tmp/schema.json",
      "--output-last-message",
      "/tmp/output.json",
    ]);
  });

  it("skips Codex trusted-directory checks only when explicitly requested", () => {
    expect(
      codexExecArgs("/repo", "read-only", "/tmp/schema.json", "/tmp/output.json", {
        skipGitRepoCheck: true,
      }),
    ).toContain("--skip-git-repo-check");
  });

  it("runs Codex non-interactively without persisting provider sessions", () => {
    const args = codexExecArgs("/repo", "workspace-write", "/tmp/schema.json", "/tmp/output.json");

    expect(args).toEqual(expect.arrayContaining(["--ephemeral", "-c", 'approval_policy="never"']));
  });

  it("passes model and reasoning effort through explicit CLI config", () => {
    const args = ["exec"];

    addCodexModelArgs(args, { model: "gpt-5.5", reasoningEffort: "xhigh" });

    expect(args).toEqual(["exec", "--model", "gpt-5.5", "-c", 'model_reasoning_effort="xhigh"']);
  });

  it("leaves Codex defaults untouched when unset", () => {
    const args = ["exec"];

    addCodexModelArgs(args, { model: null, reasoningEffort: null });

    expect(args).toEqual(["exec"]);
  });

  it("removes prompt-level schema prose when Codex receives an output schema", () => {
    const prompt = [
      "You are reviewing one semantic feature for codenuke.",
      "",
      "JSON shape:",
      "{",
      '  "findings": []',
      "}",
      "",
      "Files:",
      "--- src/index.ts",
      "export const value = 1;",
    ].join("\n");

    const prepared = codexPrompt(prompt);

    expect(prepared).toContain("Output:");
    expect(prepared).toContain("provider schema supplied out-of-band");
    expect(prepared).toContain("Files:");
    expect(prepared).not.toContain("JSON shape:");
    expect(prepared).not.toContain('"findings"');
  });

  it("keeps non-Codex schema prose paths available for providers without output schema files", () => {
    const prompt = 'Return strict JSON only:\n{"outcome":"fixed"}\n\nApplied guidance:\n- none';

    const prepared = codexPrompt(prompt);

    expect(prepared).toContain("provider schema supplied out-of-band");
    expect(prepared).toContain("Applied guidance:");
    expect(prepared).not.toContain('"outcome"');
  });

  it("removes trailing map and fix schema blocks from Codex prompts", () => {
    const mapPrompt = 'Map this repo.\n\nJSON shape:\n{"features":[]}';
    const fixPrompt = [
      "You are codenuke applying one small repair.",
      "",
      "After editing, return strict JSON only:",
      "{",
      '  "summary": "string"',
      "}",
      "",
      "Applied guidance:",
      "- none",
    ].join("\n");

    expect(codexPrompt(mapPrompt)).not.toContain('"features"');
    expect(codexPrompt(mapPrompt)).toContain("provider schema supplied out-of-band");
    expect(codexPrompt(fixPrompt)).not.toContain('"summary"');
    expect(codexPrompt(fixPrompt)).toContain("Applied guidance:");
  });
});

describe("providerJsonSchema", () => {
  it("strips numeric constraints that Codex strict schemas reject", () => {
    const schema = providerJsonSchema(reviewOutputSchema);

    expect(schemaKeys(schema)).not.toEqual(
      expect.arrayContaining([
        "$schema",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minimum",
        "maximum",
        "multipleOf",
        "default",
      ]),
    );
  });

  it("normalizes object schemas for Codex strict structured output", () => {
    const schemas = [agentMapJsonSchema, reviewJsonSchema, fixPlanJsonSchema, revalidateJsonSchema];

    for (const schema of schemas) {
      for (const objectSchema of objectSchemas(schema)) {
        const properties = Object.keys(objectSchema.properties);
        expect(objectSchema.additionalProperties).toBe(false);
        expect(objectSchema.required).toEqual(properties);
      }
    }
  });

  it("keeps provider review categories focused on refactoring", () => {
    const schemaText = JSON.stringify(reviewJsonSchema);

    expect(schemaText).toContain("maintainability");
    expect(schemaText).toContain("performance");
    expect(schemaText).not.toContain('"bug"');
    expect(schemaText).not.toContain("security");
    expect(schemaText).not.toContain("data-loss");
    expect(schemaText).not.toContain("concurrency");
  });
});

describe("withProviderOperations", () => {
  it("keeps CLI provider operation modes in one explicit matrix", () => {
    expect(providerOperationModes).toEqual({
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
    });
  });

  it("routes operations through the matching schema, parser, and provider mode", async () => {
    const outputs = new Map<object, unknown>([
      [agentMapJsonSchema, { features: [], notes: ["mapped"] }],
      [
        reviewJsonSchema,
        { findings: [], inspected: { files: ["src/provider.ts"], symbols: [], notes: [] } },
      ],
      [
        fixPlanJsonSchema,
        {
          summary: "fix",
          findingIds: [],
          plannedFiles: ["src/provider.ts"],
          risk: "low",
          steps: ["edit"],
          guidanceApplication: {
            appliedResources: [],
            deviations: [],
            risk: "low",
          },
          validationCommands: ["pnpm test src/provider.test.ts"],
        },
      ],
      [
        revalidateJsonSchema,
        {
          outcome: "fixed",
          reasoning: "ok",
          guidanceAssessment: {
            followed: "yes",
            reasoning: "ok",
            deviations: [],
            acceptable: true,
          },
          commands: [],
        },
      ],
    ]);
    const calls: Array<{ schema: object; mode: string }> = [];
    const provider = withProviderOperations(
      {
        name: "fake",
        async check() {
          return "fake";
        },
      },
      async (_root, _prompt, _options, schema, mode) => {
        calls.push({ schema, mode });
        return outputs.get(schema);
      },
      {
        map: "read",
        review: "read",
        fix: "write",
        revalidate: "read",
      },
    );

    await expect(
      provider.map("/repo", "prompt", { model: null, reasoningEffort: null }),
    ).resolves.toEqual({ features: [], notes: ["mapped"] });
    await expect(
      provider.review("/repo", "prompt", { model: null, reasoningEffort: null }),
    ).resolves.toMatchObject({ inspected: { files: ["src/provider.ts"] } });
    await expect(
      provider.fix("/repo", "prompt", { model: null, reasoningEffort: null }),
    ).resolves.toMatchObject({ risk: "low" });
    await expect(
      provider.revalidate("/repo", "prompt", { model: null, reasoningEffort: null }),
    ).resolves.toMatchObject({ outcome: "fixed" });

    expect(calls).toEqual([
      { schema: agentMapJsonSchema, mode: "read" },
      { schema: reviewJsonSchema, mode: "read" },
      { schema: fixPlanJsonSchema, mode: "write" },
      { schema: revalidateJsonSchema, mode: "read" },
    ]);
  });
});

function schemaKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(schemaKeys);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]) => [key, ...schemaKeys(item)]);
}

function objectSchemas(value: unknown): Array<{
  properties: Record<string, unknown>;
  required: unknown;
  additionalProperties: unknown;
}> {
  if (Array.isArray(value)) {
    return value.flatMap(objectSchemas);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const output: Array<{
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  }> = [];
  const record = value as Record<string, unknown>;
  if (isRecord(record["properties"])) {
    output.push({
      properties: record["properties"],
      required: record["required"],
      additionalProperties: record["additionalProperties"],
    });
  }
  return output.concat(Object.values(record).flatMap(objectSchemas));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("parseAcpxAgent", () => {
  it("defaults null model to codex/null", () => {
    expect(parseAcpxAgent(null)).toEqual({ agent: "codex", agentModel: null });
  });

  it("maps a bare agent name to agent/null", () => {
    expect(parseAcpxAgent("claude")).toEqual({ agent: "claude", agentModel: null });
  });

  it("splits agent and model on a single colon", () => {
    expect(parseAcpxAgent("claude:sonnet-4-5")).toEqual({
      agent: "claude",
      agentModel: "sonnet-4-5",
    });
  });

  it("splits on the first colon so model ids may contain colons", () => {
    expect(parseAcpxAgent("ollama:llama3:70b")).toEqual({
      agent: "ollama",
      agentModel: "llama3:70b",
    });
  });
});

describe("extractAcpxJson", () => {
  it("reconstructs JSON from agent_message_chunk stream", () => {
    const stdout = [
      textChunk("agent_message_chunk", '{"findings":'),
      textChunk("agent_message_chunk", '[],"inspected":{"files":[],"symbols":[],"notes":[]}}'),
    ].join("\n");

    expect(extractAcpxJson(stdout)).toEqual({
      findings: [],
      inspected: { files: [], symbols: [], notes: [] },
    });
  });

  it("reconstructs JSON from agent_thought_chunk stream", () => {
    const stdout = [
      textChunk("agent_thought_chunk", '{"outcome":"fixed",'),
      textChunk("agent_thought_chunk", '"reasoning":"ok","commands":[]}'),
    ].join("\n");

    expect(extractAcpxJson(stdout)).toEqual({
      outcome: "fixed",
      reasoning: "ok",
      commands: [],
    });
  });

  it("reads tool_call_result output when chunks are absent", () => {
    const stdout = toolResult(
      '{"summary":"plan","findingIds":[],"plannedFiles":[],"risk":"low","steps":[],"validationCommands":[]}',
    );

    expect(extractAcpxJson(stdout)).toEqual({
      summary: "plan",
      findingIds: [],
      plannedFiles: [],
      risk: "low",
      steps: [],
      validationCommands: [],
    });
  });

  it("prefers final message chunks over thought chunks", () => {
    const stdout = [
      textChunk("agent_thought_chunk", '{"note":"not final"}'),
      textChunk("agent_message_chunk", '{"ok":true}'),
    ].join("\n");

    expect(extractAcpxJson(stdout)).toEqual({ ok: true });
  });

  it("strips json markdown fences", () => {
    const stdout = textChunk("agent_message_chunk", '```json\n{"ok":true}\n```');

    expect(extractAcpxJson(stdout)).toEqual({ ok: true });
  });

  it("tolerates a prose preamble before the JSON object", () => {
    const stdout = textChunk("agent_message_chunk", 'Here is the JSON:\n{"ok":true}');

    expect(extractAcpxJson(stdout)).toEqual({ ok: true });
  });

  it("throws malformed-output with observed envelope kinds when nothing is extractable", () => {
    const stdout = updateEnvelope({
      sessionUpdate: "usage_update",
      usage: { inputTokens: 1, outputTokens: 2 },
    });

    expectMalformed(() => extractAcpxJson(stdout), /no extractable text.*usage_update.*\^0\.8\.0/u);
  });

  it("throws malformed-output on unparseable concatenation", () => {
    const stdout = [
      textChunk("agent_message_chunk", '{"ok":'),
      textChunk("agent_message_chunk", "not-json}"),
    ].join("\n");

    expectMalformed(() => extractAcpxJson(stdout), /unparseable JSON/u);
  });

  it("ignores initialize, session/new, and result envelopes", () => {
    const stdout = [
      JSON.stringify({ jsonrpc: "2.0", method: "initialize", result: { output: '{"bad":true}' } }),
      JSON.stringify({ jsonrpc: "2.0", method: "session/new", result: { output: '{"bad":true}' } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: '{"bad":true}' } }),
      textChunk("agent_message_chunk", '{"ok":true}'),
    ].join("\n");

    expect(extractAcpxJson(stdout)).toEqual({ ok: true });
  });

  it("skips blank, malformed, and non-record NDJSON lines in order", () => {
    const stdout = [
      "",
      "not json",
      JSON.stringify(["not", "a", "record"]),
      textChunk("agent_message_chunk", '{"ok":'),
      textChunk("agent_message_chunk", "true}"),
    ].join("\n");

    expect(extractAcpxJson(stdout)).toEqual({ ok: true });
  });

  it("survives a 256-line NDJSON fixture over 8KB", () => {
    const filler = Array.from({ length: 255 }, (_, idx) =>
      updateEnvelope({
        sessionUpdate: "usage_update",
        usage: {
          inputTokens: idx,
          outputTokens: idx + 1,
          note: "x".repeat(80),
        },
      }),
    );
    const lines = [...filler, textChunk("agent_message_chunk", '{"large":true}')];
    const stdout = lines.join("\n");

    expect(lines).toHaveLength(256);
    expect(stdout.length).toBeGreaterThan(8_000);
    expect(extractAcpxJson(stdout)).toEqual({ large: true });
  });
});

describe("acpxFailureMessage", () => {
  it("does not include raw prompt envelopes from ACPX stdout", () => {
    const secretPrompt = "SOURCE_CONTEXT_SECRET";
    const stdout = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: secretPrompt }],
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32070,
          message: "Timed out after 500ms",
          data: { acpxCode: "TIMEOUT", origin: "cli", sessionId: "session-1" },
        },
      }),
    ].join("\n");

    const message = acpxFailureMessage(stdout, "", 3);

    expect(message).toContain("acpx provider failed");
    expect(message).toContain("acpxCode=TIMEOUT");
    expect(message).toContain("message=Timed out after 500ms");
    expect(message).not.toContain(secretPrompt);
    expect(message).not.toContain("session/prompt");
  });
});

describe("extractOpencodeJson", () => {
  it("reconstructs JSON from opencode text events", () => {
    const stdout = [
      JSON.stringify({
        type: "text",
        part: { text: '{"findings":[],' },
      }),
      JSON.stringify({
        type: "text",
        part: { text: '"inspected":{"files":[],"symbols":[],"notes":[]}}' },
      }),
    ].join("\n");

    expect(extractOpencodeJson(stdout)).toEqual({
      findings: [],
      inspected: { files: [], symbols: [], notes: [] },
    });
  });

  it("skips blank, malformed, and non-record NDJSON lines in order", () => {
    const stdout = [
      "",
      "not json",
      JSON.stringify(["not", "a", "record"]),
      JSON.stringify({ type: "text", part: { text: '{"ok":' } }),
      JSON.stringify({ type: "text", part: { text: "true}" } }),
    ].join("\n");

    expect(extractOpencodeJson(stdout)).toEqual({ ok: true });
  });

  it("extracts fenced JSON from opencode text events", () => {
    const stdout = JSON.stringify({
      type: "text",
      part: { text: '```json\n{"outcome":"fixed","reasoning":"ok","commands":[]}\n```' },
    });

    expect(extractOpencodeJson(stdout)).toEqual({
      outcome: "fixed",
      reasoning: "ok",
      commands: [],
    });
  });

  it("throws malformed-output with observed event kinds when text is absent", () => {
    const stdout = JSON.stringify({ type: "step_finish", part: { reason: "stop" } });

    expectMalformed(() => extractOpencodeJson(stdout), /no extractable text.*step_finish/u);
  });

  it("throws provider-failure for opencode error events", () => {
    const stdout = JSON.stringify({
      type: "error",
      error: { data: { message: "auth required" } },
    });

    expect(() => extractOpencodeJson(stdout)).toThrow(/auth required/u);
  });

  it("classifies opencode unauthorized errors as provider auth failures", () => {
    const stdout = JSON.stringify({
      type: "error",
      error: { data: { message: "Unauthorized: Wrong API Key" } },
    });

    try {
      extractOpencodeJson(stdout);
    } catch (err) {
      expect(err).toBeInstanceOf(CodenukeError);
      expect((err as CodenukeError).exitCode).toBe(4);
      return;
    }
    throw new Error("expected provider auth failure");
  });
});

describe("providerByName", () => {
  it("returns provider instances for optional CLI-backed providers", () => {
    expect(providerByName("acpx").name).toBe("acpx");
    expect(providerByName("grok").name).toBe("grok");
    expect(providerByName("opencode").name).toBe("opencode");
  });

  it("still supports codex, mock, and mock-fail", () => {
    expect(providerByName("codex").name).toBe("codex");
    expect(providerByName("mock").name).toBe("mock");
    expect(providerByName("mock-fail").name).toBe("mock-fail");
  });
});
