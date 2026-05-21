export function taxRuleKey(country: string, region: string): string {
  return `${country}:${region}`;
}
