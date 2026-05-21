export function catalogPriceCents(baseCents: number, markdownCents: number): number {
  return Math.max(0, baseCents - markdownCents);
}
