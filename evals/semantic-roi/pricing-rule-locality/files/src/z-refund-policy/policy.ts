export function canRefund(daysSincePurchase: number): boolean {
  return daysSincePurchase <= 30;
}
