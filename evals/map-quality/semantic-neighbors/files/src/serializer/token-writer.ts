export function normalizeSerializerToken(rawToken: string): string {
  return rawToken.trim().toLowerCase().replaceAll("_", "-");
}
