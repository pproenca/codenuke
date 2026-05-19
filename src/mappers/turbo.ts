import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageScripts } from "../platform/detect.js";
import { pathExists } from "../platform/fs.js";
import type { NodeProjectInfo } from "./projects.js";
import { detectNodePackageManager } from "./shared.js";
import {
  emptyTaskGraph,
  validationTaskNames,
  type WorkspaceTaskGraph,
  type WorkspaceTaskMetadata,
} from "./task-graph.js";

const emptyTaskMetadata: WorkspaceTaskMetadata = {
  dependsOn: [],
  outputs: [],
  env: [],
  cache: null,
  persistent: false,
};

export async function turboTaskGraph(
  root: string,
  projects: NodeProjectInfo[],
): Promise<WorkspaceTaskGraph> {
  const path = join(root, "turbo.json");
  if (!(await pathExists(path))) {
    return emptyTaskGraph();
  }

  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const taskEntries = taskRecord(field(parsed, "tasks") ?? field(parsed, "pipeline"));
  const rootPackageManager = await detectNodePackageManager(root);
  const graph: WorkspaceTaskGraph = {
    runner: "turbo",
    globalDependencies: stringArray(field(parsed, "globalDependencies")),
    globalEnv: stringArray(field(parsed, "globalEnv")),
    commands: [],
  };

  for (const project of projects) {
    const scripts = packageScripts(project.packageJson);
    const packageName = turboPackageName(project);
    for (const task of validationTaskNames) {
      if (
        project.root === "." ||
        !project.workspaceMember ||
        scripts[task] === undefined ||
        !hasTaskEntry(taskEntries, packageName, task)
      ) {
        continue;
      }
      const metadata = metadataForTask(taskEntries, packageName, task);
      graph.commands.push({
        projectRoot: project.root,
        projectName: project.name,
        task,
        command: metadata.persistent
          ? null
          : turboCommand(rootPackageManager, task, turboFilter(project, packageName)),
        metadata,
      });
    }
  }

  return graph;
}

function taskRecord(value: unknown): Map<string, unknown> {
  if (!record(value)) {
    return new Map();
  }
  return new Map(Object.entries(value));
}

function hasTaskEntry(
  entries: Map<string, unknown>,
  packageName: string | null,
  task: string,
): boolean {
  return (packageName !== null && entries.has(`${packageName}#${task}`)) || entries.has(task);
}

function metadataForTask(
  entries: Map<string, unknown>,
  packageName: string | null,
  task: string,
): WorkspaceTaskMetadata {
  return taskMetadata(
    (packageName === null ? undefined : entries.get(`${packageName}#${task}`)) ?? entries.get(task),
  );
}

function taskMetadata(value: unknown): WorkspaceTaskMetadata {
  if (!record(value)) {
    return { ...emptyTaskMetadata };
  }
  return {
    dependsOn: stringArray(value["dependsOn"]),
    outputs: stringArray(value["outputs"]),
    env: stringArray(value["env"]),
    cache: typeof value["cache"] === "boolean" ? value["cache"] : null,
    persistent: value["persistent"] === true,
  };
}

function field(value: unknown, key: string): unknown {
  return record(value) ? value[key] : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function turboCommand(packageManager: string, task: string, filter: string): string {
  if (packageManager === "pnpm") {
    return `pnpm turbo run ${task} --filter ${filter}`;
  }
  if (packageManager === "yarn") {
    return `yarn turbo run ${task} --filter ${filter}`;
  }
  if (packageManager === "bun") {
    return `bunx turbo run ${task} --filter ${filter}`;
  }
  return `npx turbo run ${task} --filter ${filter}`;
}

function turboPackageName(project: NodeProjectInfo): string | null {
  const packageName = project.packageJson?.name;
  if (typeof packageName === "string" && packageName.length > 0) {
    return packageName;
  }
  return null;
}

function turboFilter(project: NodeProjectInfo, packageName: string | null): string {
  if (packageName !== null) {
    return packageName;
  }
  return `./${project.root}`;
}
