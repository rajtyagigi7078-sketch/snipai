declare module "@cashfreepayments/cashfree-js" {
  type CashfreeMode =
    | "sandbox"
    | "production";

  type CashfreeCheckoutOptions = {
    paymentSessionId: string;
    redirectTarget?:
      | "_self"
      | "_blank"
      | "_modal"
      | "_top";
  };

  type CashfreeCheckoutResult =
    unknown;

  type CashfreeClient = {
    checkout(
      options: CashfreeCheckoutOptions,
    ): Promise<CashfreeCheckoutResult>;
  };

  export function load(options: {
    mode: CashfreeMode;
  }): Promise<CashfreeClient | null>;
}
