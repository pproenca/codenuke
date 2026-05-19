type Invoice = {
  customer(): {
    account(): {
      plan(): {
        name(): string;
      };
    };
  };
};

export function planName(invoice: Invoice): string {
  return invoice.customer().account().plan().name();
}
