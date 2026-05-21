export type CheckoutInvoiceSummary = {
  invoiceId: string;
  checkoutId: string;
  customerName: string;
  subtotalCents: number;
  taxCents: number;
};

export function formatCheckoutInvoiceSummary(summary: CheckoutInvoiceSummary): string {
  const totalCents = summary.subtotalCents + summary.taxCents;
  return [
    "TODO_SEMANTIC_REFACTOR",
    summary.invoiceId,
    summary.checkoutId,
    summary.customerName,
    formatMoney(totalCents),
  ].join(" | ");
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
