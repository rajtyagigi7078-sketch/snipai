import { useEffect, useState } from "react";
import { load } from "@cashfreepayments/cashfree-js";

function getPaymentValue(
  key: string,
): string | null {
  const searchParams =
    new URLSearchParams(
      window.location.search,
    );

  const queryValue =
    searchParams.get(key);

  if (queryValue) {
    return queryValue;
  }

  const hash =
    window.location.hash.replace(
      /^#/,
      "",
    );

  const hashParams =
    new URLSearchParams(hash);

  return hashParams.get(key);
}

export default function CashfreeCheckout() {
  const [error, setError] =
    useState<string | null>(null);

  const startCheckout =
    async () => {
      setError(null);

      try {
        const paymentSessionId =
          getPaymentValue(
            "payment_session_id",
          );

        const environment =
          getPaymentValue(
            "environment",
          ) || "production";

        if (!paymentSessionId) {
          throw new Error(
            "Cashfree payment session is missing.",
          );
        }

        console.log(
          "[Cashfree] Starting checkout",
          {
            environment,
            hasPaymentSession:
              Boolean(
                paymentSessionId,
              ),
          },
        );

        const cashfree =
          await load({
            mode:
              environment ===
              "sandbox"
                ? "sandbox"
                : "production",
          });

        if (!cashfree) {
          throw new Error(
            "Cashfree SDK could not be loaded.",
          );
        }

        await cashfree.checkout({
          paymentSessionId,
        });
      } catch (err) {
        console.error(
          "[Cashfree] Checkout error:",
          err,
        );

        setError(
          err instanceof Error
            ? err.message
            : "Unable to open Cashfree checkout.",
        );
      }
    };

  useEffect(() => {
    void startCheckout();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#080a0f",
        color: "#ffffff",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          textAlign: "center",
          padding: "32px",
          borderRadius: "20px",
          background: "#11151d",
          border:
            "1px solid rgba(255,255,255,0.08)",
          boxSizing: "border-box",
        }}
      >
        {!error ? (
          <>
            <div
              style={{
                width: "46px",
                height: "46px",
                margin:
                  "0 auto 18px",
                borderRadius: "50%",
                border:
                  "3px solid rgba(255,255,255,0.12)",
                borderTopColor:
                  "#ffffff",
                animation:
                  "cashfree-spin 0.8s linear infinite",
              }}
            />

            <h1
              style={{
                margin:
                  "0 0 10px",
                fontSize: "20px",
                fontWeight: 700,
              }}
            >
              Opening secure payment
            </h1>

            <p
              style={{
                margin: 0,
                color: "#8f98a8",
                fontSize: "14px",
                lineHeight: 1.5,
              }}
            >
              Redirecting you to
              Cashfree secure
              checkout...
            </p>
          </>
        ) : (
          <>
            <h1
              style={{
                margin:
                  "0 0 10px",
                fontSize: "20px",
                fontWeight: 700,
              }}
            >
              Payment checkout
            </h1>

            <p
              style={{
                margin:
                  "0 0 20px",
                color: "#aeb6c4",
                fontSize: "14px",
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>

            <button
              type="button"
              onClick={() => {
                void startCheckout();
              }}
              style={{
                border: 0,
                borderRadius: "10px",
                padding:
                  "12px 20px",
                background:
                  "#ffffff",
                color: "#080a0f",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </>
        )}
      </div>

      <style>
        {`
          @keyframes cashfree-spin {
            from {
              transform: rotate(0deg);
            }

            to {
              transform: rotate(360deg);
            }
          }
        `}
      </style>
    </div>
  );
}
