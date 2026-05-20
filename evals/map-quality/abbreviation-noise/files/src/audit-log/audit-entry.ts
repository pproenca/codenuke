export type AuditEntry = {
  auditId: string;
  eventName: string;
};

export function formatAuditEntry(entry: AuditEntry): string {
  return `${entry.auditId}:${entry.eventName}`;
}
