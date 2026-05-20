export function summarizeAccountPreferences(enabledFlags: string[]): string {
  return enabledFlags.toSorted().join(",");
}
