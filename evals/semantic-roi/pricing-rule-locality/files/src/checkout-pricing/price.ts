export function calculateCheckoutTotal(input): number {
  // TODO_PRICING_RULE_REFACTOR: same member discount rule also exists in subscription-pricing.
  const discountCents = input.isMember ? Math.floor(input.subtotalCents * 0.1) : 0;
  const couponDiscountCents = input.couponCode === "WELCOME" ? 500 : 0;
  return Math.max(0, input.subtotalCents - discountCents - couponDiscountCents);
}
