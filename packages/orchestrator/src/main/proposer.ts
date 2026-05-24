import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runCodexAgent } from "@codenuke/substrate";
import type { ProgressReporter } from "@codenuke/substrate";
import type {
  CodexOptions,
  CommandExecutionItem,
  FileChangeItem,
  RunStreamedResult,
  ThreadOptions,
  TurnOptions,
  Usage,
} from "@openai/codex-sdk";

export type ProposerMode = "reduce" | "raise-fence";
export type ProposerProvider = "codex-cli" | "codex-sdk";

export interface ProposerRequest {
  readonly mode: ProposerMode;
  readonly prompt: string;
  readonly promptFile: string;
  readonly repo: string;
  readonly worktree: string;
  readonly regionKey: string;
  readonly regionTarget: string;
  readonly timeoutMs: number;
  readonly budgetUsd: string;
  readonly threadId?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly progress?: ProgressReporter;
}

export interface ProposerResult {
  readonly ok: boolean;
  readonly out: string;
  readonly timedOut: boolean;
  readonly provider: ProposerProvider;
  readonly threadId?: string;
  readonly summary?: string;
  readonly error?: string;
  readonly usage?: Usage | null;
  readonly elapsedMs?: number;
  readonly commandEvents?: readonly CommandExecutionItem[];
  readonly fileChanges?: readonly FileChangeItem[];
}

export interface ProposerAdapter {
  readonly provider: ProposerProvider;
  propose(request: ProposerRequest): Promise<ProposerResult>;
}

interface CodexThreadLike {
  readonly id: string | null;
  runStreamed(input: string, options?: TurnOptions): Promise<RunStreamedResult>;
}

interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike;
}

export type CodexClientFactory = (request: ProposerRequest) => Promise<CodexClientLike>;

interface ProposerThreadEntry {
  readonly threadId: string;
  readonly mode: ProposerMode;
  readonly regionKey: string;
  readonly regionTarget: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

interface ProposerThreadState {
  readonly schemaVersion: 1;
  readonly provider: "codex-sdk";
  readonly threads: Record<string, ProposerThreadEntry>;
}

const proposerThreadStatePath = (repo: string): string => `${repo}/.codenuke/proposer-threads.json`;

const threadKey = (request: ProposerRequest): string =>
  `${request.mode}:${request.regionTarget.replace(/\/+$/u, "") || request.regionKey}`;

function envStrings(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function readThreadState(repo: string): ProposerThreadState {
  try {
    const parsed = JSON.parse(readFileSync(proposerThreadStatePath(repo), "utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { schemaVersion?: unknown }).schemaVersion === 1 &&
      (parsed as { provider?: unknown }).provider === "codex-sdk" &&
      typeof (parsed as { threads?: unknown }).threads === "object" &&
      (parsed as { threads?: unknown }).threads !== null
    ) {
      return parsed as ProposerThreadState;
    }
  } catch {
    /* missing or invalid state starts fresh */
  }
  return { schemaVersion: 1, provider: "codex-sdk", threads: {} };
}

function writeThreadState(repo: string, state: ProposerThreadState): void {
  const path = proposerThreadStatePath(repo);
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function codexOptions(request: ProposerRequest): CodexOptions {
  return { env: envStrings(proposerEnv(request)) };
}

function threadOptions(request: ProposerRequest): ThreadOptions {
  const sandbox = request.env.CN_CODEX_SANDBOX?.trim();
  const approval = request.env.CN_CODEX_APPROVAL_POLICY?.trim();
  return {
    workingDirectory: request.worktree,
    sandboxMode:
      sandbox === "read-only" || sandbox === "workspace-write" || sandbox === "danger-full-access"
        ? sandbox
        : sandbox === "bypass" || sandbox === "none"
          ? "danger-full-access"
          : "workspace-write",
    approvalPolicy:
      approval === "on-request" ||
      approval === "on-failure" ||
      approval === "untrusted" ||
      approval === "never"
        ? approval
        : "never",
    ...(request.env.CN_MODEL ? { model: request.env.CN_MODEL } : {}),
    ...(request.env.CN_REASONING_EFFORT
      ? {
          modelReasoningEffort: request.env
            .CN_REASONING_EFFORT as ThreadOptions["modelReasoningEffort"],
        }
      : {}),
  };
}

async function defaultCodexFactory(request: ProposerRequest): Promise<CodexClientLike> {
  const { Codex } = await import("@openai/codex-sdk");
  return new Codex(codexOptions(request));
}

async function runWithTimeout(
  thread: CodexThreadLike,
  prompt: string,
  timeoutMs: number,
): Promise<{
  readonly finalResponse: string;
  readonly usage: Usage | null;
  readonly commandEvents: readonly CommandExecutionItem[];
  readonly fileChanges: readonly FileChangeItem[];
  readonly timedOut: boolean;
  readonly elapsedMs: number;
}> {
  const controller = new AbortController();
  let timedOut = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();
  try {
    const commandEvents: CommandExecutionItem[] = [];
    const fileChanges: FileChangeItem[] = [];
    let finalResponse = "";
    let usage: Usage | null = null;
    const streamed = await thread.runStreamed(prompt, { signal: controller.signal });
    for await (const event of streamed.events) {
      if (
        event.type === "item.completed" &&
        event.item.type === "command_execution"
      ) {
        commandEvents.push(event.item);
      }
      if (event.type === "item.completed" && event.item.type === "file_change") {
        fileChanges.push(event.item);
      }
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      }
      if (event.type === "turn.completed") {
        usage = event.usage;
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    return {
      finalResponse,
      usage,
      commandEvents,
      fileChanges,
      timedOut,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export class CodexCliProposerAdapter implements ProposerAdapter {
  readonly provider = "codex-cli" as const;

  async propose(request: ProposerRequest): Promise<ProposerResult> {
    writeFileSync(request.promptFile, request.prompt);
    const result = await runCodexAgent(request.prompt, {
      cwd: request.worktree,
      timeout: request.timeoutMs,
      env: proposerEnv(request),
      outputPath: `${request.promptFile}.last.txt`,
      progress: request.progress,
      progressLabel: "codex proposer",
    });
    return {
      ...result,
      provider: this.provider,
      elapsedMs: result.elapsedMs,
      commandEvents: [],
      fileChanges: [],
    };
  }
}

export class CodexSdkProposerAdapter implements ProposerAdapter {
  readonly provider = "codex-sdk" as const;

  constructor(private readonly createClient: CodexClientFactory = defaultCodexFactory) {}

  async propose(request: ProposerRequest): Promise<ProposerResult> {
    writeFileSync(request.promptFile, request.prompt);
    const state = readThreadState(request.repo);
    const key = threadKey(request);
    const existing = request.threadId ?? state.threads[key]?.threadId;
    const now = new Date().toISOString();
    try {
      const codex = await this.createClient(request);
      const thread = existing
        ? codex.resumeThread(existing, threadOptions(request))
        : codex.startThread(threadOptions(request));
      const { finalResponse, usage, commandEvents, fileChanges, timedOut, elapsedMs } =
        await runWithTimeout(thread, request.prompt, request.timeoutMs);
      const threadId = thread.id ?? existing;
      if (threadId) {
        writeThreadState(request.repo, {
          schemaVersion: 1,
          provider: "codex-sdk",
          threads: {
            ...state.threads,
            [key]: {
              threadId,
              mode: request.mode,
              regionKey: request.regionKey,
              regionTarget: request.regionTarget,
              createdAt: state.threads[key]?.createdAt ?? now,
              lastUsedAt: now,
            },
          },
        });
      }
      return {
        ok: true,
        out: finalResponse,
        timedOut,
        provider: this.provider,
        ...(threadId ? { threadId } : {}),
        summary: finalResponse.replace(/\s+/gu, " ").trim().slice(0, 200),
        usage,
        elapsedMs,
        commandEvents,
        fileChanges,
      };
    } catch (error) {
      return {
        ok: false,
        out: error instanceof Error ? error.message : String(error),
        timedOut: error instanceof Error && error.name === "AbortError",
        provider: this.provider,
        ...(existing ? { threadId: existing } : {}),
        error: error instanceof Error ? error.message : String(error),
        commandEvents: [],
        fileChanges: [],
      };
    }
  }
}

export function proposerEnv(request: ProposerRequest): NodeJS.ProcessEnv {
  return {
    ...request.env,
    CN_REGION: request.regionKey,
    CN_TARGET: request.regionTarget,
  };
}

export function selectProposerAdapter(env: NodeJS.ProcessEnv): ProposerAdapter {
  if (env.CN_PROPOSER) {
    throw new Error("CN_PROPOSER no longer accepts shell strings; use the default Codex SDK proposer");
  }
  const provider = env.CN_CODEX_PROVIDER?.trim();
  if (provider === "cli") {
    return new CodexCliProposerAdapter();
  }
  if (provider == null || provider === "" || provider === "sdk") {
    return new CodexSdkProposerAdapter();
  }
  return new CodexSdkProposerAdapter();
}
