import React, {
  useEffect,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { listen } from "@tauri-apps/api/event";

import App from "./App";
import AuthScreen from "./AuthScreen";
import PaymentGate from "./PaymentGate";
import CashfreeCheckout from "./CashfreeCheckout";
import CashfreeReturn from "./CashfreeReturn";
import {
  getBillingState,
} from "./lib/billing";
import { supabase } from "./lib/supabase";
import { startPaymentReturnHandler } from "./lib/paymentReturn";

void startPaymentReturnHandler();

async function handleAuthUrl(
  url: string,
) {
  console.log(
    "Snip AI auth URL received:",
    url,
  );

  try {
    const parsed = new URL(url);

    const accessToken =
      parsed.searchParams.get(
        "access_token",
      );

    const refreshToken =
      parsed.searchParams.get(
        "refresh_token",
      );

    if (
      accessToken &&
      refreshToken
    ) {
      const { error } =
        await supabase.auth.setSession({
          access_token:
            accessToken,
          refresh_token:
            refreshToken,
        });

      if (error) {
        console.error(
          "Could not restore Supabase session:",
          error,
        );
      }
    }
  } catch (error) {
    console.error(
      "Invalid Snip AI auth URL:",
      error,
    );
  }
}

function Root() {
  const [session, setSession] =
    useState<Session | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [billingLoading, setBillingLoading] =
    useState(false);

  const [lifetimeActive, setLifetimeActive] =
    useState(false);

  async function refreshBilling() {
    setBillingLoading(true);

    try {
      const billing =
        await getBillingState();

      setLifetimeActive(
        Boolean(billing.active),
      );
    } catch (error) {
      console.error(
        "[Billing] Could not load billing state:",
        error,
      );

      setLifetimeActive(false);
    } finally {
      setBillingLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;

        setSession(data.session);
        setLoading(false);
      });

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (_event, nextSession) => {
          setSession(nextSession);

          if (!nextSession) {
            setLifetimeActive(false);
          }

          setLoading(false);
        },
      );

    const unlistenPromise =
      listen<string>(
        "snipai://auth/callback",
        async (event) => {
          await handleAuthUrl(
            event.payload,
          );
        },
      );



    return () => {
      mounted = false;

      subscription.unsubscribe();

      unlistenPromise.then(
        (unlisten) => {
          unlisten();
        },
      );
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setLifetimeActive(false);
      return;
    }

    refreshBilling();
  }, [session?.user?.id]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#080a0f",
          color: "#7d8798",
          fontFamily:
            "system-ui, sans-serif",
          fontSize: "13px",
        }}
      >
        Loading Snip AI...
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (billingLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#080a0f",
          color: "#7d8798",
          fontFamily:
            "system-ui, sans-serif",
          fontSize: "13px",
        }}
      >
        Checking account access...
      </div>
    );
  }

  if (!lifetimeActive) {
    return (
      <PaymentGate
        onActivated={() => {
          setLifetimeActive(true);
        }}
      />
    );
  }

  return <App />;
}


function HostedPaymentRouter() {
  const path =
    window.location.pathname.replace(
      /\/+$/,
      "",
    );

  if (
    path ===
    "/payment/cashfree-checkout"
  ) {
    return <CashfreeCheckout />;
  }

  if (
    path ===
    "/payment/cashfree-return"
  ) {
    return <CashfreeReturn />;
  }

  return <Root />;
}

ReactDOM.createRoot(
  document.getElementById(
    "root",
  ) as HTMLElement,
).render(
  <React.StrictMode>
    <HostedPaymentRouter />
  </React.StrictMode>,
);
