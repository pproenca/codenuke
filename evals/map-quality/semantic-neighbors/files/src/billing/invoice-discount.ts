export function applyCustomerInvoiceDiscount(invoiceTotal: number, discountRate: number): number {
  return invoiceTotal - invoiceTotal * discountRate;
}
