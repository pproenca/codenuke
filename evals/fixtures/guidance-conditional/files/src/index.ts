export function shippingLabel(status: string): string {
  switch (status) {
    case "new":
      return "New";
    case "packed":
      return "Packed";
    case "held":
      return "Held";
    case "shipped":
      return "Shipped";
    case "returned":
      return "Returned";
    default:
      return "Unknown";
  }
}
