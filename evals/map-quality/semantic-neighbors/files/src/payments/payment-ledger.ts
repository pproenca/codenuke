export type LedgerCharge = {
  customerAccountId: string;
  paymentLedgerId: string;
  paymentAmount: number;
};

export function reconcileCustomerPaymentLedger(charges: LedgerCharge[]): string[] {
  return charges.map((charge) => `${charge.customerAccountId}:${charge.paymentLedgerId}`);
}
