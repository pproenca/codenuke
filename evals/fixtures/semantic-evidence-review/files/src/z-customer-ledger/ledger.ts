export function customerLedgerKey(customerId: string, period: string): string {
  return `${customerId}:${period}`;
}
