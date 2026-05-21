import { nowIso } from "../platform/fs.js";
import { stableFeatureJson } from "../workflow/feature-equivalence.js";
import { stableId } from "../platform/id.js";
import { cCppSeeds } from "../mappers/c-cpp.js";
import { configSeedFiles, configSeeds } from "../mappers/config.js";
import { goSeeds } from "../mappers/go.js";
import { appleSeeds } from "../mappers/apple.js";
import { gradleSeeds } from "../mappers/gradle.js";
import { laravelSeeds } from "../mappers/laravel.js";
import { nextSeeds } from "../mappers/next.js";
import { nodeSeeds } from "../mappers/node.js";
import { pythonSeeds } from "../mappers/python.js";
import { reactSeeds } from "../mappers/react.js";
import {
  dependencyFieldHas,
  discoverNodeProjects,
  packageRelativePath,
} from "../mappers/projects.js";
import {
  buildRepoIndex,
  repoHasAnyBasename,
  repoHasAnyExtension,
  repoHasAnyPath,
  repoHasBasenameEnding,
  repoHasDirectory,
  repoHasDirectoryEnding,
} from "../mappers/repo-index.js";
import type { RepoIndex } from "../mappers/repo-index.js";
import { rubySeeds } from "../mappers/ruby.js";
import { rustSeeds } from "../mappers/rust.js";
import { nearbyTests } from "../mappers/shared.js";
import { swiftSeeds } from "../mappers/swift.js";
import { turboTaskGraph } from "../mappers/turbo.js";
import { FeatureMapper, FeatureSeed, MapperContext } from "../mappers/types.js";
import { FeatureRecord, ProjectRecord } from "../platform/types.js";
import { attachSemanticEvidence } from "./semantic-evidence.js";

export type MapResult = {
  features: FeatureRecord[];
  created: number;
  changed: number;
  stale: number;
  repoIndex?: RepoIndex;
};

export type MapProgressEvent = {
  event: "mapper-start" | "mapper-done";
  mapper: string;
  seeds?: number;
  elapsedMs?: number;
};

export type MapOptions = {
  onProgress?: (event: MapProgressEvent) => void;
  semanticEvidence?: boolean;
};

export type MapFeatureSeedOptions = {
  repoIndex?: RepoIndex;
  semanticEvidence?: boolean;
};

type GatedFeatureMapper = FeatureMapper & {
  shouldRun?: (context: MapperContext) => boolean;
};

const featureMappers: GatedFeatureMapper[] = [
  { name: "node", map: nodeSeeds, shouldRun: hasNodeSignal },
  { name: "next", map: nextSeeds, shouldRun: hasNextSignal },
  { name: "react", map: reactSeeds, shouldRun: hasReactSignal },
  {
    name: "go",
    map: goSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyPath(repoIndex, ["go.mod"]) || repoHasAnyExtension(repoIndex, [".go"]),
  },
  {
    name: "python",
    map: pythonSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyPath(repoIndex, ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"]) ||
      repoHasAnyExtension(repoIndex, [".py"]),
  },
  {
    name: "ruby",
    map: rubySeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyPath(repoIndex, ["Gemfile", "gems.rb", "Rakefile", "config.ru"]) ||
      repoHasAnyExtension(repoIndex, [".rb", ".gemspec"]),
  },
  {
    name: "rust",
    map: rustSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyPath(repoIndex, ["Cargo.toml"]) || repoHasAnyExtension(repoIndex, [".rs"]),
  },
  {
    name: "c-cpp",
    map: cCppSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyBasename(repoIndex, ["CMakeLists.txt", "Makefile", "Makefile.am", "Makefile.in"]) ||
      repoHasAnyExtension(repoIndex, [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"]),
  },
  {
    name: "swift",
    map: swiftSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyPath(repoIndex, ["Package.swift"]) || repoHasAnyExtension(repoIndex, [".swift"]),
  },
  {
    name: "apple",
    map: appleSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyBasename(repoIndex, ["project.yml"]) ||
      repoHasBasenameEnding(repoIndex, ".xcodeproj") ||
      repoHasBasenameEnding(repoIndex, ".xcworkspace") ||
      repoHasDirectoryEnding(repoIndex, ".xcodeproj") ||
      repoHasDirectoryEnding(repoIndex, ".xcworkspace"),
  },
  {
    name: "gradle",
    map: gradleSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyBasename(repoIndex, [
        "settings.gradle",
        "settings.gradle.kts",
        "build.gradle",
        "build.gradle.kts",
      ]) || repoHasAnyExtension(repoIndex, [".java", ".kt", ".kts"]),
  },
  {
    name: "laravel",
    map: laravelSeeds,
    shouldRun: ({ repoIndex }) =>
      repoHasAnyPath(repoIndex, ["composer.json", "artisan"]) ||
      repoHasAnyExtension(repoIndex, [".php"]),
  },
  {
    name: "config",
    map: configSeeds,
    shouldRun: ({ repoIndex }) => repoHasAnyPath(repoIndex, configSeedFiles),
  },
];

function hasNodeSignal(context: MapperContext): boolean {
  return context.projects.some((project) => project.packageJsonPath !== null);
}

function hasNextSignal(context: MapperContext): boolean {
  return context.projects.some(
    (project) =>
      dependencyFieldHas(project.packageJson?.dependencies, "next") ||
      dependencyFieldHas(project.packageJson?.devDependencies, "next") ||
      ["next.config.js", "next.config.mjs", "next.config.ts"].some((file) =>
        context.repoIndex.fileSet.has(packageRelativePath(project.root, file)),
      ) ||
      nextRoutePrefixes(project.root, project.sourceRoot).some((prefix) =>
        repoHasDirectory(context.repoIndex, prefix),
      ),
  );
}

function hasReactSignal(context: MapperContext): boolean {
  return (
    context.projects.some(
      (project) =>
        dependencyFieldHas(project.packageJson?.dependencies, "react") ||
        dependencyFieldHas(project.packageJson?.devDependencies, "react") ||
        dependencyFieldHas(project.packageJson?.peerDependencies, "react") ||
        dependencyFieldHas(project.packageJson?.optionalDependencies, "react"),
    ) ||
    (repoHasAnyBasename(context.repoIndex, ["package.json"]) &&
      repoHasAnyExtension(context.repoIndex, [".tsx", ".jsx"]))
  );
}

function nextRoutePrefixes(projectRoot: string, sourceRoot: string | null): string[] {
  const prefixes = new Set(
    ["app", "pages", "src/app", "src/pages"].map((path) => packageRelativePath(projectRoot, path)),
  );
  if (sourceRoot !== null) {
    const relativeSourceRoot =
      projectRoot === "."
        ? sourceRoot
        : sourceRoot === projectRoot
          ? ""
          : sourceRoot.startsWith(`${projectRoot}/`)
            ? sourceRoot.slice(projectRoot.length + 1)
            : null;
    if (relativeSourceRoot !== null) {
      for (const routeRoot of ["app", "pages"]) {
        prefixes.add(
          packageRelativePath(
            projectRoot,
            relativeSourceRoot.length === 0 ? routeRoot : `${relativeSourceRoot}/${routeRoot}`,
          ),
        );
      }
    }
  }
  return [...prefixes];
}

export async function mapFeatures(
  root: string,
  project: ProjectRecord,
  existing: FeatureRecord[],
  options: MapOptions = {},
): Promise<MapResult> {
  const { seeds, repoIndex } = await collectSeeds(root, options);
  return {
    ...(await mapFeatureSeeds(root, project, existing, seeds, {
      repoIndex,
      ...(options.semanticEvidence === undefined
        ? {}
        : { semanticEvidence: options.semanticEvidence }),
    })),
    repoIndex,
  };
}

export async function mapFeatureSeeds(
  root: string,
  project: ProjectRecord,
  existing: FeatureRecord[],
  seeds: FeatureSeed[],
  options: MapFeatureSeedOptions = {},
): Promise<MapResult> {
  const existingById = new Map(existing.map((feature) => [feature.featureId, feature]));
  const discoveredFeatures: FeatureRecord[] = [];
  const now = nowIso();
  for (const seed of seeds) {
    const identity = featureIdentity(seed, existingById);
    const featureId = identity.featureId;
    const previous = existingById.get(featureId);
    const discoveredTests =
      seed.skipNearbyTests === true
        ? []
        : await nearbyTests(
            root,
            seed.entryPath,
            Object.hasOwn(seed, "testCommand")
              ? (seed.testCommand ?? null)
              : project.detected.commands.test,
            seed.testPrefixes ?? [],
            [seed.command, seed.identityKey].filter(
              (name): name is string => typeof name === "string",
            ),
            options.repoIndex?.files,
          );
    const tests = uniqueTests([...(seed.tests ?? []), ...discoveredTests]);
    const contextFiles = uniqueFileRefs([
      ...(seed.contextFiles ?? []),
      ...tests.map((test) => ({ path: test.path, reason: "nearby test" })),
    ]);
    const feature: FeatureRecord = {
      schemaVersion: 1,
      featureId,
      title: seed.title,
      summary: seed.summary,
      kind: seed.kind,
      source: seed.source,
      confidence: seed.confidence,
      entrypoints: [
        {
          path: seed.entryPath,
          symbol: identity.symbol,
          route: seed.route,
          command: seed.command,
        },
      ],
      ownedFiles: seed.ownedFiles ?? [{ path: seed.entryPath, reason: "entrypoint" }],
      contextFiles,
      tests,
      tags: seed.tags,
      trustBoundaries: seed.trustBoundaries,
      semanticEvidence: [],
      status: previous?.status ?? "pending",
      lock: previous?.lock ?? null,
      findingIds: previous?.findingIds ?? [],
      patchAttemptIds: previous?.patchAttemptIds ?? [],
      analysisHistory: previous?.analysisHistory ?? [],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    discoveredFeatures.push(feature);
  }
  const features: FeatureRecord[] = [];
  let created = 0;
  let changed = 0;
  const featuresWithEvidence = semanticEvidenceEnabled(options.semanticEvidence)
    ? await attachSemanticEvidence(root, discoveredFeatures)
    : discoveredFeatures;
  for (const feature of featuresWithEvidence) {
    const previous = existingById.get(feature.featureId);
    const featureChanged =
      previous !== undefined && stableFeatureJson(previous) !== stableFeatureJson(feature);
    if (featureChanged) {
      feature.status = statusForChangedFeature(previous.status);
    }
    if (!featureChanged && previous?.status === "skipped") {
      feature.status = "pending";
    }
    if (previous === undefined) {
      created += 1;
    }
    if (previous !== undefined && (featureChanged || previous.status === "skipped")) {
      changed += 1;
    }
    features.push(feature);
  }
  const mappedFeatureIds = new Set(features.map((feature) => feature.featureId));
  return {
    features,
    created,
    changed,
    stale: existing.filter((feature) => !mappedFeatureIds.has(feature.featureId)).length,
  };
}

function semanticEvidenceEnabled(option: boolean | undefined): boolean {
  if (option !== undefined) {
    return option;
  }
  return process.env["CODENUKE_SEMANTIC_EVIDENCE"] !== "0";
}

function featureIdentity(
  seed: FeatureSeed,
  existingById: Map<string, FeatureRecord>,
): { featureId: string; symbol: string | null } {
  const symbol = effectiveSymbol(seed, existingById);
  return {
    featureId: stableId("feat", [
      seed.kind,
      seed.source,
      seed.entryPath,
      seed.identityKey ?? seed.command ?? seed.route ?? symbol ?? "",
    ]),
    symbol,
  };
}

function effectiveSymbol(
  seed: FeatureSeed,
  existingById: Map<string, FeatureRecord>,
): string | null {
  if (!isDisambiguatedCppLibrary(seed)) {
    return seed.symbol;
  }
  const legacyId = stableId("feat", [seed.kind, seed.source, seed.entryPath, ""]);
  const previous = existingById.get(legacyId);
  if (seed.symbol !== null || previous?.title === seed.title) {
    return previous?.title === seed.title ? null : seed.symbol;
  }
  const previousSymbol = disambiguatorFromTitle(seed.title);
  const previousId = stableId("feat", [seed.kind, seed.source, seed.entryPath, previousSymbol]);
  return existingById.get(previousId)?.title === seed.title ? previousSymbol : null;
}

function isDisambiguatedCppLibrary(seed: FeatureSeed): boolean {
  return seed.kind === "library" && ["cmake-lib", "autotools-lib"].includes(seed.source);
}

function disambiguatorFromTitle(title: string): string {
  return title.split(" ").at(-1) ?? title;
}

function uniqueFileRefs(refs: Array<{ path: string; reason: string }>): Array<{
  path: string;
  reason: string;
}> {
  const seen = new Set<string>();
  const output: Array<{ path: string; reason: string }> = [];
  for (const ref of refs) {
    if (seen.has(ref.path)) {
      continue;
    }
    seen.add(ref.path);
    output.push(ref);
  }
  return output;
}

function uniqueTests(tests: Array<{ path: string; command: string | null }>): Array<{
  path: string;
  command: string | null;
}> {
  const seen = new Set<string>();
  const output: Array<{ path: string; command: string | null }> = [];
  for (const test of tests) {
    if (seen.has(test.path)) {
      continue;
    }
    seen.add(test.path);
    output.push(test);
  }
  return output;
}

async function collectSeeds(
  root: string,
  options: MapOptions,
): Promise<{ seeds: FeatureSeed[]; repoIndex: RepoIndex }> {
  const repoIndex = await buildRepoIndex(root);
  const projects = await discoverNodeProjects(root);
  const context: MapperContext = {
    projects,
    repoIndex,
    taskGraph: await turboTaskGraph(root, projects),
  };
  const activeMappers = featureMappers.filter((mapper) => mapper.shouldRun?.(context) ?? true);
  const groups = await Promise.all(
    activeMappers.map(async (mapper) => {
      const started = Date.now();
      options.onProgress?.({ event: "mapper-start", mapper: mapper.name });
      const seeds = await mapper.map(root, context);
      options.onProgress?.({
        event: "mapper-done",
        mapper: mapper.name,
        seeds: seeds.length,
        elapsedMs: Date.now() - started,
      });
      return seeds;
    }),
  );
  return { seeds: dedupeSeeds(groups.flat()), repoIndex };
}

function dedupeSeeds(seeds: FeatureSeed[]): FeatureSeed[] {
  const seen = new Set<string>();
  const output: FeatureSeed[] = [];
  for (const seed of seeds) {
    const key = `${seed.kind}:${seed.source}:${seed.entryPath}:${seed.command ?? seed.route ?? seed.symbol ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(seed);
  }
  return output;
}

function statusForChangedFeature(status: FeatureRecord["status"]): FeatureRecord["status"] {
  if (["reviewed", "revalidated", "fixed", "skipped"].includes(status)) {
    return "pending";
  }
  return status;
}
