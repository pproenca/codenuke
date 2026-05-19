export class AccountPresenter {
  constructor(private readonly account: { name(): string; balance(): number; status(): string }) {}

  name(): string {
    return this.account.name();
  }

  balance(): number {
    return this.account.balance();
  }

  status(): string {
    return this.account.status();
  }
}
