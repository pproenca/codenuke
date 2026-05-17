import type { NodeProjectInfo } from "./projects.js";

export type WorkspaceTaskName = "build" | "test" | "lint" | "typecheck" | "format" | string;

export type WorkspaceTaskMetadata = {
  dependsOn: string[];
  outputs: string[];
  env: string[];
  cache: boolean | null;
  persistent: boolean;
};

export type WorkspaceTaskCommand = {
  projectRoot: string;
  projectName: string;
  task: WorkspaceTaskName;
  command: string | null;
  metadata: WorkspaceTaskMetadata;
};

export type WorkspaceTaskGraph = {
  runner: string | null;
  globalDependencies: string[];
  globalEnv: string[];
  commands: WorkspaceTaskCommand[];
};

export const validationTaskNames = ["test", "build", "lint", "typecheck", "format"] as const;

const commandIndexes = new WeakMap<WorkspaceTaskGraph, Map<string, string | null>>();

export function emptyTaskGraph(): WorkspaceTaskGraph {
  return { runner: null, globalDependencies: [], globalEnv: [], commands: [] };
}

export function taskGraphCommand(
  graph: WorkspaceTaskGraph,
  project: NodeProjectInfo,
  task: string,
): string | null | undefined {
  return taskGraphCommandIndex(graph).get(taskGraphCommandKey(project.root, task));
}

function taskGraphCommandIndex(graph: WorkspaceTaskGraph): Map<string, string | null> {
  const cached = commandIndexes.get(graph);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<string, string | null>();
  for (const command of graph.commands) {
    const key = taskGraphCommandKey(command.projectRoot, command.task);
    if (!index.has(key)) {
      index.set(key, command.command);
    }
  }
  commandIndexes.set(graph, index);
  return index;
}

function taskGraphCommandKey(projectRoot: string, task: string): string {
  return `${projectRoot}\0${task}`;
}

export function taskGraphProjectCommands(
  graph: WorkspaceTaskGraph,
  project: NodeProjectInfo,
): Record<string, string> {
  const commands: Record<string, string> = {};
  for (const task of validationTaskNames) {
    const command = taskGraphCommand(graph, project, task);
    if (command !== undefined && command !== null) {
      commands[task] = command;
    }
  }
  return commands;
}
