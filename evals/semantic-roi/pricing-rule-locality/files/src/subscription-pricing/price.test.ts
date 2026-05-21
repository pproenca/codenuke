import { calculateSubscriptionTotal } from "./price.js";

if (
  calculateSubscriptionTotal({
    subtotalCents: 10000,
    isMember: true,
    billingCycle: "annual",
  }) !== 8500
) {
  throw new Error("subscription member discount pricing changed");
}
