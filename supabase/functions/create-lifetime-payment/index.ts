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

    const { data: existingAccess } =
      await adminSupabase
        .from("subscriptions")
        .select("id, status, expires_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

    if (
      existingAccess?.status === "active" &&
      existingAccess?.expires_at === null
    ) {
      return json({
        active: true,
        status: "active",
        lifetime: true,
        already_active: true,
      });
    }

    const { data: plan, error: planError } =
      await adminSupabase
        .from("plans")
        .select("*")
        .eq("key", "lifetime")
        .eq("active", true)
        .single();

    if (planError || !plan) {
      return json(
        { error: "Lifetime plan is not configured" },
        500,
      );
    }

    if (Number(plan.price_inr) !== LIFETIME_PRICE) {
      return json(
        {
          error:
            "Lifetime plan price mismatch. Expected ₹100.",
        },
        500,
      );
    }

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

    const orderId =
      `snip_lifetime_${user.id
        .replaceAll("-", "")
        .slice(0, 12)}_${Date.now()}`;

    const returnUrl =
      Deno.env.get("CASHFREE_RETURN_URL") ||
      "https://sinpai1.netlify.app/payment/cashfree-return";

    const customerPhone =
      user.user_metadata?.phone ||
      user.phone ||
      "9999999999";

    const customerName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      "Snip AI User";

    const cashfreeResponse = await fetch(
      `${baseUrl}/pg/orders`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": clientId,
          "x-client-secret": clientSecret,
          "x-api-version": apiVersion,
        },
        body: JSON.stringify({
          order_id: orderId,
          order_amount: LIFETIME_PRICE,
          order_currency: "INR",

          customer_details: {
            customer_id: user.id,
            customer_email: user.email || "",
            customer_phone: customerPhone,
            customer_name: customerName,
          },

          order_meta: {
            return_url: `${returnUrl}?order_id={order_id}`,
          },

          order_note:
            "Snip AI Lifetime Access - One Time Payment",
        }),
      },
    );

    const payload =
      await cashfreeResponse.json();

    if (!cashfreeResponse.ok) {
      console.error(
        "Cashfree create order error:",
        payload,
      );

      return json(
        {
          error:
            payload?.message ||
            payload?.error ||
            "Cashfree order creation failed",
        },
        502,
      );
    }

    const paymentSessionId =
      payload?.payment_session_id;

    if (!paymentSessionId) {
      console.error(
        "Cashfree response missing payment_session_id:",
        payload,
      );

      return json(
        {
          error:
            "Cashfree did not return a payment session ID",
        },
        502,
      );
    }

    const { data: existingSubscription, error: existingError } =
      await adminSupabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (existingError) {
      return json(
        { error: existingError.message },
        500,
      );
    }

    let subscription;

    const subscriptionData = {
      plan_id: plan.id,
      provider: "cashfree",
      provider_subscription_id: null,
      provider_customer_id: user.id,
      status: "inactive",
      plan: "lifetime",
      started_at: null,
      expires_at: null,
      payment_id: null,
      order_id: orderId,
      current_start: null,
      current_end: null,
      cancel_at_period_end: false,
      metadata: {
        billing_model: "lifetime",
        provider: "cashfree",
        cashfree_order_id: orderId,
        cashfree_payment_session_id:
          paymentSessionId,
        amount_inr: LIFETIME_PRICE,
      },
      updated_at: new Date().toISOString(),
    };

    if (existingSubscription?.id) {
      const { data, error } =
        await adminSupabase
          .from("subscriptions")
          .update(subscriptionData)
          .eq("id", existingSubscription.id)
          .select()
          .single();

      if (error) {
        return json(
          { error: error.message },
          500,
        );
      }

      subscription = data;
    } else {
      const { data, error } =
        await adminSupabase
          .from("subscriptions")
          .insert({
            user_id: user.id,
            ...subscriptionData,
          })
          .select()
          .single();

      if (error) {
        return json(
          { error: error.message },
          500,
        );
      }

      subscription = data;
    }

    await adminSupabase
      .from("payments")
      .insert({
        user_id: user.id,
        subscription_id: subscription.id,
        provider: "cashfree",
        provider_payment_id: null,
        provider_order_id: orderId,
        provider_subscription_id: null,
        amount_inr: LIFETIME_PRICE,
        currency: "INR",
        status: "pending",
        method: null,
        payload: {
          billing_model: "lifetime",
          cashfree_response: payload,
        },
      });

    return json({
      provider: "cashfree",
      order_id: orderId,
      payment_session_id: paymentSessionId,
      amount_inr: LIFETIME_PRICE,
      lifetime: true,
      environment,
    });
  } catch (error) {
    console.error(
      "Unexpected lifetime payment error:",
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected payment error",
      },
      500,
    );
  }
});
