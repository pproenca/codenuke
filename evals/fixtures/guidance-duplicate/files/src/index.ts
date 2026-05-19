export function summarizeInvoice(invoice: { subtotal: number; tax: number; discount: number }) {
  const taxableSubtotal = invoice.subtotal - invoice.discount;
  const totalTax = taxableSubtotal * invoice.tax;
  const total = taxableSubtotal + totalTax;
  return { taxableSubtotal, totalTax, total };
}

export function summarizePreview(invoice: { subtotal: number; tax: number; discount: number }) {
  const taxableSubtotal = invoice.subtotal - invoice.discount;
  const totalTax = taxableSubtotal * invoice.tax;
  const total = taxableSubtotal + totalTax;
  return { taxableSubtotal, totalTax, total };
}
