import { formatCheckoutInvoiceSummary } from "./format.js";

if (
  formatCheckoutInvoiceSummary({
    invoiceId: "inv_123",
    checkoutId: "chk_123",
    customerName: "Ava",
    subtotalCents: 1200,
    taxCents: 300,
  }) !== "TODO_SEMANTIC_REFACTOR | inv_123 | chk_123 | Ava | $15.00"
) {
  throw new Error("checkout invoice summary formatting changed");
}
