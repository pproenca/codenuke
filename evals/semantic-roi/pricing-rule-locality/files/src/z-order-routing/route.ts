export function orderRouteKey(region: string, warehouse: string): string {
  return `${region}/${warehouse}`;
}
