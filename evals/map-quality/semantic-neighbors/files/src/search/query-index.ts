export function indexSearchQuery(queryText: string): string[] {
  return queryText.toLowerCase().split(/\W+/u);
}
