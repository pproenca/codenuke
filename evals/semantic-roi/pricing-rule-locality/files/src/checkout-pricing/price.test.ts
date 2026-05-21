import { calculateCheckoutTotal } from "./price.js";

if (
  calculateCheckoutTotal({
    subtotalCents: 10000,
    isMember: true,
    couponCode: null,
  }) !== 9000
) {
  throw new Error("checkout member discount pricing changed");
}
