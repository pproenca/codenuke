import { existsSync, readFileSync } from "node:fs";

const expectedPrefix = process.env["EXPECTED_MONEY_PREFIX"] ?? "$";
const fixtureFiles = [
  "src/money-format/format.ts",
  "src/invoice-format/format.ts",
  "src/checkout-format/format.ts",
];

const code = fixtureFiles
  .filter((path) => existsSync(path))
  .map((path) => stripTypeScript(readFileSync(path, "utf8")))
  .join("\n");

const module = new Function(`${code}
return { formatCheckoutInvoiceSummary, formatInvoiceSummaryRow };
`)();

const checkout = module.formatCheckoutInvoiceSummary({
  invoiceId: "inv_123",
  checkoutId: "chk_123",
  customerName: "Ava",
  subtotalCents: 1200,
  taxCents: 300,
});
const invoice = module.formatInvoiceSummaryRow({
  invoiceId: "inv_123",
  accountName: "Ava",
  subtotalCents: 1200,
  taxCents: 300,
});

expectEqual(checkout, `inv_123 | chk_123 | Ava | ${expectedPrefix}15.00`, "checkout");
expectEqual(invoice, `inv_123 | Ava | ${expectedPrefix}15.00`, "invoice");

function stripTypeScript(text) {
  return text
    .replace(/^import .*;\n/gmu, "")
    .replace(/export type [\s\S]*?\};\n\n/gu, "")
    .replace(/export function/gu, "function")
    .replace(/: (?:CheckoutInvoiceSummary|InvoiceSummaryRow|number|string)/gu, "");
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} output mismatch: expected ${expected}, got ${actual}`);
  }
}
