export type CheckoutDeliveryPromise = {
  checkoutId: string;
  carrierFulfillmentZone: string;
  deliveryWindow: string;
};

export function promiseCheckoutDelivery(promise: CheckoutDeliveryPromise): string {
  return `${promise.checkoutId}:${promise.carrierFulfillmentZone}:${promise.deliveryWindow}`;
}
