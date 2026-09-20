import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LIFETIME_PRICE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const auth = req.headers.get("Authorization");

    if (!auth?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;

    if (!orderId || typeof orderId !== "string") {
      return json({ error: "order_id is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: {
            Authorization: auth,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return json(
        { error: "Supabase service role key is missing" },
        500,
      );
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.status === "suspended") {
      return json({ error: "Account suspended" }, 403);
    }

    /*
     * STEP 1
     * The local subscription must belong to this user AND
     * the exact Cashfree order must belong to this subscription.
     */
    const { data: subscription, error: subscriptionError } =
      await adminSupabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .eq("order_id", orderId)
        .maybeSingle();

    if (subscriptionError) {
      return json(
        { error: subscriptionError.message },
        500,
      );
    }

    if (!subscription) {
      return json(
        {
          error:
            "This payment order does not belong to this account.",
        },
        403,
      );
    }

    /*
     * STEP 2
     * A local payment record must already exist for this
     * user + order. This prevents arbitrary Cashfree orders
     * from being attached to an account.
     */
    const { data: localPayment, error: localPaymentError } =
      await adminSupabase
        .from("payments")
        .select(
          "id, user_id, provider_order_id, provider_payment_id, amount_inr, currency, status",
        )
        .eq("user_id", user.id)
        .eq("provider_order_id", orderId)
        .maybeSingle();

    if (localPaymentError) {
      return json(
        { error: localPaymentError.message },
        500,
      );
    }

    if (!localPayment) {
      return json(
        {
          error:
            "Local payment record not found for this order.",
        },
        403,
      );
    }

    if (
      localPayment.user_id !== user.id ||
      localPayment.provider_order_id !== orderId
    ) {
      return json(
        {
          error:
            "Local payment ownership verification failed.",
        },
        403,
      );
    }

    /*
     * STEP 3
     * If this local payment is already successful, this is
     * an idempotent verification request. We still continue
     * through Cashfree verification below.
     */
    const clientId =
      Deno.env.get("CASHFREE_CLIENT_ID");

    const clientSecret =
      Deno.env.get("CASHFREE_CLIENT_SECRET");

    const environment =
      Deno.env.get("CASHFREE_ENVIRONMENT") ===
      "production"
        ? "production"
        : "sandbox";

    const apiVersion =
      Deno.env.get("CASHFREE_API_VERSION") ||
      "2025-01-01";

    const baseUrl =
      environment === "production"
        ? "https://api.cashfree.com"
        : "https://sandbox.cashfree.com";

    if (!clientId || !clientSecret) {
      return json(
        { error: "Cashfree server credentials are missing" },
        500,
      );
    }

    const headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": apiVersion,
      "Content-Type": "application/json",
    };

    /*
     * STEP 4
     * Verify the order directly with Cashfree.
     */
    const orderResponse = await fetch(
      `${baseUrl}/pg/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers,
      },
    );

    const orderPayload =
      await orderResponse.json();

    if (!orderResponse.ok) {
      return json(
        {
          error:
            orderPayload?.message ||
            "Could not verify Cashfree order",
        },
        502,
      );
    }

    const amount =
      Number(orderPayload?.order_amount);

    const currency =
      orderPayload?.order_currency;

    if (
      amount !== LIFETIME_PRICE ||
      currency !== "INR"
    ) {
      return json(
        {
          error:
            "Payment amount or currency does not match the lifetime plan.",
        },
        400,
      );
    }

    /*
     * STEP 5
     * Cashfree customer must belong to the logged-in user.
     */
    const customerId =
      orderPayload?.customer_details?.customer_id;

    if (!customerId || customerId !== user.id) {
      return json(
        {
          error:
            "Cashfree order customer does not match this account.",
        },
        403,
      );
    }

    /*
     * STEP 6
     * Fetch the actual payment records from Cashfree.
     */
    const paymentsResponse = await fetch(
      `${baseUrl}/pg/orders/${encodeURIComponent(orderId)}/payments`,
      {
        method: "GET",
        headers,
      },
    );

    const paymentsPayload =
      await paymentsResponse.json();

    if (!paymentsResponse.ok) {
      return json(
        {
          error:
            paymentsPayload?.message ||
            "Could not fetch Cashfree payment status",
        },
        502,
      );
    }

    const payments = Array.isArray(paymentsPayload)
      ? paymentsPayload
      : [];

    const successfulPayment =
      payments.find(
        (payment: any) =>
          payment?.payment_status === "SUCCESS" &&
          Number(payment?.payment_amount) ===
            LIFETIME_PRICE &&
          payment?.payment_currency === "INR",
      );

    if (!successfulPayment) {
      const orderStatus =
        orderPayload?.order_status ||
        "PENDING";

      await adminSupabase
        .from("payments")
        .update({
          status:
            orderStatus === "PAID"
              ? "success"
              : "pending",
          payload: {
            billing_model: "lifetime",
            order: orderPayload,
            payments: paymentsPayload,
          },
        })
        .eq("id", localPayment.id)
        .eq("user_id", user.id)
        .eq("provider_order_id", orderId);

      return json({
        active: false,
        lifetime: false,
        status: orderStatus,
        order_status: orderStatus,
        message: "Payment is not confirmed yet.",
      });
    }

    /*
     * STEP 7
     * Cashfree must provide a real payment ID.
     */
    const paymentId =
      successfulPayment?.cf_payment_id
        ? String(successfulPayment.cf_payment_id)
        : null;

    if (!paymentId) {
      return json(
        {
          error:
            "Cashfree did not provide a valid payment ID.",
        },
        502,
      );
    }

    /*
     * STEP 8
     * Replay protection.
     *
     * The same Cashfree payment ID must never be accepted
     * for another order or another user.
     */
    const { data: reusedPayment, error: reusedPaymentError } =
      await adminSupabase
        .from("payments")
        .select(
          "id, user_id, provider_order_id, provider_payment_id, status",
        )
        .eq("provider_payment_id", paymentId)
        .neq("id", localPayment.id)
        .maybeSingle();

    if (reusedPaymentError) {
      return json(
        { error: reusedPaymentError.message },
        500,
      );
    }

    if (reusedPayment) {
      return json(
        {
          error:
            "This Cashfree payment has already been used.",
        },
        409,
      );
    }

    /*
     * STEP 9
     * The local payment amount/currency must also match.
     */
    if (
      Number(localPayment.amount_inr) !== LIFETIME_PRICE ||
      localPayment.currency !== "INR"
    ) {
      return json(
        {
          error:
            "Local payment record does not match the lifetime plan.",
        },
        400,
      );
    }

    const paymentMethod =
      successfulPayment?.payment_group || null;

    const now =
      new Date().toISOString();

    /*
     * STEP 10
     * Mark the exact local payment as successful first.
     */
    const paymentData = {
      user_id: user.id,
      subscription_id: subscription.id,
      provider: "cashfree",
      provider_payment_id: paymentId,
      provider_order_id: orderId,
      provider_subscription_id: null,
      amount_inr: LIFETIME_PRICE,
      currency: "INR",
      status: "success",
      method: paymentMethod,
      payload: {
        billing_model: "lifetime",
        order: orderPayload,
        payment: successfulPayment,
        verified_at: now,
      },
    };

    const { error: paymentUpdateError } =
      await adminSupabase
        .from("payments")
        .update(paymentData)
        .eq("id", localPayment.id)
        .eq("user_id", user.id)
        .eq("provider_order_id", orderId);

    if (paymentUpdateError) {
      return json(
        {
          error:
            paymentUpdateError.message ||
            "Could not record verified payment",
        },
        500,
      );
    }

    /*
     * STEP 11
     * Only now activate lifetime access.
     */
    const { data: updatedSubscription, error: updateError } =
      await adminSupabase
        .from("subscriptions")
        .update({
          status: "active",
          plan: "lifetime",
          started_at:
            subscription.started_at || now,
          expires_at: null,
          payment_id: paymentId,
          order_id: orderId,
          plan_id: subscription.plan_id,
          provider: "cashfree",
          provider_subscription_id: null,
          provider_customer_id: user.id,
          current_start:
            subscription.current_start || now,
          current_end: null,
          cancel_at_period_end: false,
          metadata: {
            billing_model: "lifetime",
            provider: "cashfree",
            cashfree_order_id: orderId,
            cashfree_payment_id: paymentId,
            amount_inr: LIFETIME_PRICE,
            payment: successfulPayment,
            verified_at: now,
          },
          updated_at: now,
        })
        .eq("id", subscription.id)
        .eq("user_id", user.id)
        .select()
        .single();

    if (updateError || !updatedSubscription) {
      return json(
        {
          error:
            updateError?.message ||
            "Could not activate lifetime access",
        },
        500,
      );
    }

    return json({
      active: true,
      status: "active",
      lifetime: true,
      order_id: orderId,
      payment_id: paymentId,
    });
  } catch (error) {
    console.error(
      "Unexpected lifetime verification error:",
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected verification error",
      },
      500,
    );
  }
});
