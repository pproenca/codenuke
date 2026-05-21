export type CheckoutShippingEstimate = {
  checkoutId: string;
  carrierFulfillmentZone: string;
  shippingCents: number;
};

export function estimateCheckoutShipping(estimate: CheckoutShippingEstimate): string {
  return `${estimate.checkoutId}:${estimate.carrierFulfillmentZone}:${estimate.shippingCents}`;
}
