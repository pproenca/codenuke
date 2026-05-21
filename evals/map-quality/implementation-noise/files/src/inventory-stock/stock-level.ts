export function readInventoryStockLevel(sku: string): string {
  return `stock:${sku}`;
}
