import { load } from "@cashfreepayments/cashfree-js";
import { supabase } from "./supabase";

export type BillingState = {
  active: boolean;
  status: string | null;
  priceInr: number;
  planName: string;
  isAdmin: boolean;
};

const defaultBillingState: BillingState = {
  active: false,
  status: null,
  priceInr: 100,
  planName: "Snip AI Lifetime",
  isAdmin: false,
};

async function readFunctionError(
  error: unknown,
  fallback: string,
) {
  let message =
    error instanceof Error
      ? error.message
      : fallback;

  try {
    const context = (error as any)?.context;

    if (
      context &&
      typeof context.json === "function"
    ) {
      const body = await context.json();

      if (body?.error) {
        message = body.error;
      }
    }
  } catch {
    // Keep original message.
  }

  return message;
}

export async function getBillingState(): Promise<BillingState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return defaultBillingState;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  const { data: plan } = await supabase
    .from("plans")
    .select("name, price_inr")
    .eq("key", "lifetime")
    .eq("active", true)
    .maybeSingle();

  const priceInr =
    Number(plan?.price_inr) || 100;

  const planName =
    plan?.name || "Snip AI Lifetime";

  if (profile?.status === "suspended") {
    return {
      active: false,
      status: "suspended",
      priceInr,
      planName,
      isAdmin: false,
    };
  }

  const { data: subscription } =
    await supabase
      .from("subscriptions")
      .select(
        "status, expires_at, plan",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("plan", "lifetime")
      .maybeSingle();

  const active =
    subscription?.status === "active" &&
    subscription?.expires_at === null;

  return {
    active,
    status:
      subscription?.status ?? null,
    priceInr,
    planName,
    isAdmin: false,
  };
}

export async function verifyLifetimePayment(
  orderId: string,
) {
  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      "verify-lifetime-payment",
      {
        body: {
          order_id: orderId,
        },
      },
    );

  if (error) {
    throw new Error(
      await readFunctionError(
        error,
        "Payment verification failed.",
      ),
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

async function waitForPaymentVerification(
  orderId: string,
) {
  const attempts = 15;

  for (
    let attempt = 0;
    attempt < attempts;
    attempt++
  ) {
    try {
      const result =
        await verifyLifetimePayment(
          orderId,
        );

      if (result?.active) {
        return result;
      }

      console.log(
        `[Billing] Payment verification attempt ${
          attempt + 1
        }/${attempts}:`,
        result,
      );
    } catch (error) {
      console.warn(
        "[Billing] Verification attempt failed:",
        error,
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 2000),
    );
  }

  return {
    active: false,
    status: "pending",
  };
}

export async function startLifetimePayment() {
  const billing =
    await getBillingState();

  if (billing.active) {
    return {
      active: true,
      status: "active",
      lifetime: true,
      order_id: null,
      payment_session_id: null,
    };
  }

  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      "create-lifetime-payment",
      {
        body: {},
      },
    );

  if (error) {
    throw new Error(
      await readFunctionError(
        error,
        "Payment could not be started.",
      ),
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  const orderId =
    data?.order_id;

  const paymentSessionId =
    data?.payment_session_id;

  if (
    !orderId ||
    !paymentSessionId
  ) {
    throw new Error(
      "Cashfree did not return a valid payment session.",
    );
  }

  const environment =
    import.meta.env
      .VITE_CASHFREE_ENVIRONMENT ===
    "production"
      ? "production"
      : "sandbox";

  console.log(
    "[Billing] Opening Cashfree popup:",
    orderId,
  );

  const cashfree =
    await load({
      mode: environment,
    });

  if (!cashfree) {
    throw new Error(
      "Cashfree checkout could not be loaded.",
    );
  }

  let checkoutResult: unknown = null;

  try {
    checkoutResult =
      await cashfree.checkout({
        paymentSessionId,
        redirectTarget: "_self",
      });
  } catch (checkoutError) {
    console.error(
      "[Billing] Cashfree checkout error:",
      checkoutError,
    );

    throw new Error(
      checkoutError instanceof Error
        ? checkoutError.message
        : "Cashfree payment window could not be opened.",
    );
  }

  console.log(
    "[Billing] Cashfree checkout finished:",
    checkoutResult,
  );

  /*
   * Cashfree's client result is NOT trusted.
   * The backend checks the real payment status.
   */
  const verification =
    await waitForPaymentVerification(
      orderId,
    );

  if (verification?.active) {
    return {
      active: true,
      status: "active",
      lifetime: true,
      order_id: orderId,
      payment_session_id:
        paymentSessionId,
      checkout_result:
        checkoutResult,
    };
  }

  return {
    active: false,
    status:
      verification?.status ||
      "pending",
    lifetime: false,
    order_id: orderId,
    payment_session_id:
      paymentSessionId,
    checkout_result:
      checkoutResult,
    message:
      "Payment was not confirmed. If money was deducted, please wait a moment and try again.",
  };
}
