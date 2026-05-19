export function normalize(value: string): string {
  // first trim, then collapse internal whitespace before title casing
  const trimmed = value.trim();
  const collapsed = trimmed.replace(/\s+/gu, " ");
  return collapsed.toLowerCase();
}
