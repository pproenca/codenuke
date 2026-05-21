import { existsSync, readFileSync } from "node:fs";

const memberRate = Number(process.env["EXPECTED_MEMBER_RATE"] ?? "0.1");
const fixtureFiles = [
  "src/pricing-rules/member-discount.ts",
  "src/subscription-pricing/price.ts",
  "src/checkout-pricing/price.ts",
];

const code = fixtureFiles
  .filter((path) => existsSync(path))
  .map((path) => stripTypeScript(readFileSync(path, "utf8")))
  .join("\n");

const module = new Function(`${code}
return { calculateCheckoutTotal, calculateSubscriptionTotal };
`)();

const checkout = module.calculateCheckoutTotal({
  subtotalCents: 10000,
  isMember: true,
  couponCode: null,
});
const subscription = module.calculateSubscriptionTotal({
  subtotalCents: 10000,
  isMember: true,
  billingCycle: "annual",
});

const memberDiscountCents = Math.floor(10000 * memberRate);
expectEqual(checkout, 10000 - memberDiscountCents, "checkout");
expectEqual(subscription, 10000 - memberDiscountCents - 500, "subscription");

function stripTypeScript(text) {
  return text
    .replace(/^import .*;\n/gmu, "")
    .replace(/export function/gu, "function")
    .replace(/: number/gu, "");
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} output mismatch: expected ${expected}, got ${actual}`);
  }
}
