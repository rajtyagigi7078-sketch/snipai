import { useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { startLifetimePayment } from "./lib/billing";

type PaymentGateProps = {
  onActivated: () => void;
};

export default function PaymentGate({
  onActivated,
}: PaymentGateProps) {
  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  async function handlePayment() {
    if (loading) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const result =
        await startLifetimePayment();

      if (result?.active) {
        onActivated();
        return;
      }

      setMessage(
        "Cashfree payment page has opened in your browser. Complete the ₹100 payment there. Snip AI will unlock automatically after verification.",
      );
    } catch (err) {
      console.error(
        "[PaymentGate] Payment error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Payment could not be started.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #151a2b 0%, #080a0f 48%, #050609 100%)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        fontFamily:
          "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "470px",
          background:
            "rgba(16, 19, 28, 0.96)",
          border:
            "1px solid rgba(255,255,255,0.09)",
          borderRadius: "28px",
          padding: "38px",
          boxShadow:
            "0 30px 90px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            width: "58px",
            height: "58px",
            borderRadius: "18px",
            display: "grid",
            placeItems: "center",
            background:
              "rgba(124,92,255,0.14)",
            border:
              "1px solid rgba(124,92,255,0.25)",
            marginBottom: "24px",
          }}
        >
          <CreditCard size={28} />
        </div>

        <div
          style={{
            fontSize: "12px",
            fontWeight: 800,
            letterSpacing: "0.14em",
            color: "#8f98aa",
            textTransform: "uppercase",
            marginBottom: "10px",
          }}
        >
          Account verified
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "34px",
            lineHeight: 1.1,
            fontWeight: 850,
            letterSpacing: "-0.04em",
          }}
        >
          Activate Snip AI
        </h1>

        <p
          style={{
            margin: "14px 0 28px",
            color: "#9ca5b5",
            fontSize: "15px",
            lineHeight: 1.65,
          }}
        >
          Your email has been verified.
          Pay ₹100 once and get lifetime
          access to Snip AI.
        </p>

        <div
          style={{
            borderRadius: "20px",
            padding: "22px",
            background:
              "rgba(255,255,255,0.035)",
            border:
              "1px solid rgba(255,255,255,0.07)",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#8f98aa",
                  marginBottom: "6px",
                }}
              >
                Snip AI Lifetime
              </div>

              <div
                style={{
                  fontSize: "34px",
                  fontWeight: 850,
                  letterSpacing: "-0.04em",
                }}
              >
                ₹100
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                color: "#8ee6a7",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              <CheckCircle2 size={16} />
              One-time
            </div>
          </div>

          <div
            style={{
              height: "1px",
              background:
                "rgba(255,255,255,0.07)",
              margin: "18px 0",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "9px",
              color: "#b9c0ce",
              fontSize: "13px",
            }}
          >
            <ShieldCheck size={17} />
            No expiry • No renewal
          </div>
        </div>

        {message && (
          <div
            style={{
              padding: "13px 15px",
              borderRadius: "13px",
              background:
                "rgba(100,130,255,0.09)",
              border:
                "1px solid rgba(100,130,255,0.2)",
              color: "#b9c8ff",
              fontSize: "13px",
              lineHeight: 1.5,
              marginBottom: "15px",
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "13px 15px",
              borderRadius: "13px",
              background:
                "rgba(255,70,70,0.09)",
              border:
                "1px solid rgba(255,70,70,0.2)",
              color: "#ff9c9c",
              fontSize: "13px",
              lineHeight: 1.5,
              marginBottom: "15px",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handlePayment}
          disabled={loading}
          style={{
            width: "100%",
            height: "54px",
            border: 0,
            borderRadius: "15px",
            cursor:
              loading
                ? "wait"
                : "pointer",
            background:
              loading
                ? "#303443"
                : "linear-gradient(135deg, #7c5cff, #5c8cff)",
            color: "#fff",
            fontSize: "15px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "9px",
            boxShadow:
              loading
                ? "none"
                : "0 14px 35px rgba(103,86,255,0.25)",
          }}
        >
          {loading ? (
            <>
              <Loader2
                size={18}
                className="spin-payment"
              />
              Opening Cashfree...
            </>
          ) : (
            <>
              <CreditCard size={18} />
              Pay ₹100 & Activate Lifetime
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleLogout}
          disabled={loading}
          style={{
            width: "100%",
            marginTop: "12px",
            height: "42px",
            border:
              "1px solid rgba(255,255,255,0.07)",
            borderRadius: "13px",
            background: "transparent",
            color: "#7f8899",
            cursor:
              loading
                ? "default"
                : "pointer",
            fontSize: "13px",
            fontWeight: 650,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "7px",
          }}
        >
          <LogOut size={15} />
          Sign out
        </button>

        <div
          style={{
            textAlign: "center",
            marginTop: "20px",
            color: "#5f6878",
            fontSize: "11px",
          }}
        >
          Secure payment powered by Cashfree
        </div>
      </div>

      <style>
        {`
          @keyframes spin-payment {
            to {
              transform: rotate(360deg);
            }
          }

          .spin-payment {
            animation:
              spin-payment 0.8s linear infinite;
          }
        `}
      </style>
    </div>
  );
}
