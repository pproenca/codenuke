export function auditTrailName(entity: string, action: string): string {
  return `${entity}:${action}`;
}
