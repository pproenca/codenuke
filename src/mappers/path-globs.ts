export type PathGlobExpansionOptions = {
  pattern: string;
  recursiveDoubleStar?: boolean;
  entries: (base: string) => Promise<readonly string[]>;
  accepts: (path: string) => Promise<boolean>;
};

export function pathHasGlob(path: string): boolean {
  return /[*?]/u.test(path);
}

export function pathGlobMatches(pattern: string, candidate: string): boolean {
  return pathGlobSegmentsMatch(pattern.split("/"), candidate.split("/"));
}

export function pathGlobSegmentsMatch(
  pattern: readonly string[],
  candidate: readonly string[],
): boolean {
  const [segment, ...remainingPattern] = pattern;
  if (segment === undefined) {
    return candidate.length === 0;
  }
  if (segment === "**") {
    return (
      pathGlobSegmentsMatch(remainingPattern, candidate) ||
      (candidate.length > 0 && pathGlobSegmentsMatch(pattern, candidate.slice(1)))
    );
  }
  const [candidateSegment, ...remainingCandidate] = candidate;
  if (candidateSegment === undefined || !globSegmentRegExp(segment).test(candidateSegment)) {
    return false;
  }
  return pathGlobSegmentsMatch(remainingPattern, remainingCandidate);
}

export async function expandPathGlob(options: PathGlobExpansionOptions): Promise<string[]> {
  const recursiveDoubleStar = options.recursiveDoubleStar ?? true;
  const matches: string[] = [];
  const segments = options.pattern.split("/");

  async function visit(base: string, remaining: string[]): Promise<void> {
    const [segment, ...rest] = remaining;
    if (segment === undefined) {
      if (base.length > 0 && (await options.accepts(base))) {
        matches.push(base);
      }
      return;
    }

    if (!pathHasGlob(segment)) {
      await visit(base.length === 0 ? segment : `${base}/${segment}`, rest);
      return;
    }

    if (recursiveDoubleStar && segment === "**") {
      await visit(base, rest);
      for (const entry of await options.entries(base)) {
        await visit(base.length === 0 ? entry : `${base}/${entry}`, remaining);
      }
      return;
    }

    const matcher = globSegmentRegExp(segment);
    for (const entry of await options.entries(base)) {
      if (matcher.test(entry)) {
        await visit(base.length === 0 ? entry : `${base}/${entry}`, rest);
      }
    }
  }

  await visit("", segments);
  return matches.toSorted();
}

export function globSegmentRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/gu, "[^/]*").replace(/\?/gu, "[^/]")}$`, "u");
}
