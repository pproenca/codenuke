export function issueUserAuthToken(userId: string): string {
  return `auth:${userId}`;
}
