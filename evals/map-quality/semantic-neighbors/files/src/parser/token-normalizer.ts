export function normalizeParserToken(rawToken: string): string {
  return rawToken.trim().toLowerCase().replaceAll("_", "-");
}
