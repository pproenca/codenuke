export function userFlagKey(userId: string, flag: string): string {
  return `${userId}:${flag}`;
}
