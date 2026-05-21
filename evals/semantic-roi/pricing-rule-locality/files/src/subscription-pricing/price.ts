export function calculateSubscriptionTotal(input): number {
  const discountCents = input.isMember ? Math.floor(input.subtotalCents * 0.1) : 0;
  const cycleDiscountCents =
    input.billingCycle === "annual" ? Math.floor(input.subtotalCents * 0.05) : 0;
  return Math.max(0, input.subtotalCents - discountCents - cycleDiscountCents);
}
