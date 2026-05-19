export function quoteOrder(
  customerId: string,
  region: string,
  subtotal: number,
  taxRate: number,
  discountRate: number,
) {
  const discount = subtotal * discountRate;
  const taxed = (subtotal - discount) * taxRate;
  return `${customerId}:${region}:${subtotal - discount + taxed}`;
}
