const DEFAULT_WORKTREE = "/tmp/cn-loop";

function slug(value) {
  return value.replace(/^src\//, "").replace(/\/$/, "").replace(/[^A-Za-z0-9_.-]+/g, "-") || "root";
}

export function loopConfig(env = process.env, cwd = process.cwd()) {
  const main = env.CN_MAIN ?? cwd;
  const worktree = env.CN_WORKTREE ?? DEFAULT_WORKTREE;
  const target = env.CN_TARGET ?? "src/mappers/";
  const region = slug(target);
  const tag = env.CN_TAG ?? "run";
  const state = env.CN_STATE ?? `/tmp/cn-loop-${slug(tag)}-${region}.state.json`;

  return {
    main,
    worktree,
    state,
    target,
    region,
    tag,
    branch: `autoresearch/${tag}`,
    fidelity: env.CN_FIDELITY ?? `${main}/experiments/mutation/fence-fidelity.json`,
    program: `${main}/experiments/loop/program.md`,
    results: `${main}/experiments/loop/results.tsv`,
    fidelityScript: `${main}/experiments/mutation/fidelity.mjs`,
    promptFile: `/tmp/cn-proposer-${slug(tag)}-${region}.prompt.txt`,
  };
}

function legacySurvivorCount(region) {
  return Object.values(region?.files ?? {}).reduce(
    (total, file) => total + (Array.isArray(file.survivors) ? file.survivors.length : 0),
    0,
  );
}

export function raiseReadiness(region) {
  const specs = Array.isArray(region?.survivorSpecs) ? region.survivorSpecs : [];
  if (specs.length > 0) return { kind: "raise", specs };

  const survivorCount = legacySurvivorCount(region);
  if (survivorCount > 0) return { kind: "legacy-survivors", survivorCount };

  return { kind: "no-survivors" };
}
