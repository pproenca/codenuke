export type InvoiceSummaryRow = {
  invoiceId: string;
  accountName: string;
  subtotalCents: number;
  taxCents: number;
};

export function formatInvoiceSummaryRow(row: InvoiceSummaryRow): string {
  const totalCents = row.subtotalCents + row.taxCents;
  return [row.invoiceId, row.accountName, formatMoney(totalCents)].join(" | ");
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
