import { openUrl } from "@tauri-apps/plugin-opener";
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

export async function startLifetimePayment() {
  const billing = await getBillingState();

  if (billing.active) {
    return {
      active: true,
      status: "active",
      lifetime: true,
      order_id: null,
      payment_session_id: null,
      browserOpened: false,
    };
  }

  const {
    data,
    error,
  } = await supabase.functions.invoke(
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

  const orderId = data?.order_id;
  const paymentSessionId =
    data?.payment_session_id;

  if (!orderId || !paymentSessionId) {
    throw new Error(
      "Cashfree did not return a valid payment session.",
    );
  }

  /*
   * Cashfree Web Checkout must run on an approved
   * HTTPS web origin, not inside the Tauri WebView.
   *
   * The payment_session_id is kept in the URL fragment
   * so it is not sent to the website server/referrer.
   */
  const checkoutUrl =
    new URL(
      "https://sinpai1.netlify.app/payment/cashfree-checkout",
    );

  checkoutUrl.hash =
    new URLSearchParams({
      order_id: String(orderId),
      payment_session_id:
        String(paymentSessionId),
      environment: "production",
    }).toString();

  console.log(
    "[Billing] Opening browser checkout:",
    orderId,
  );

  try {
    await openUrl(checkoutUrl.toString());
  } catch (error) {
    console.error(
      "[Billing] Could not open browser checkout:",
      error,
    );

    throw new Error(
      "Could not open the Cashfree payment page in your browser.",
    );
  }

  return {
    active: false,
    status: "pending",
    lifetime: false,
    browserOpened: true,
    order_id: orderId,
    payment_session_id: paymentSessionId,
    checkout_url: checkoutUrl.toString(),
    message:
      "Cashfree checkout opened in your browser. Complete the ₹100 payment there. Snip AI will unlock automatically after verification.",
  };
}
