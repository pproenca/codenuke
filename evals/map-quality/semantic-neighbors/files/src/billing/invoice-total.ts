export type PaymentLine = {
  customerAccountId: string;
  paymentLedgerId: string;
  paymentAmount: number;
};

export function calculateCustomerInvoiceTotal(lines: PaymentLine[]): number {
  return lines.reduce((ledgerTotal, line) => ledgerTotal + line.paymentAmount, 0);
}
