import { useEffect, useState } from "react";

function getOrderId(): string | null {
  const searchParams =
    new URLSearchParams(
      window.location.search,
    );

  return (
    searchParams.get("order_id") ||
    searchParams.get("orderId") ||
    searchParams.get("payment_order_id")
  );
}

export default function CashfreeReturn() {
  const [message, setMessage] =
    useState("Returning to Snip AI...");

  useEffect(() => {
    const orderId = getOrderId();

    if (!orderId) {
      setMessage(
        "Payment return order ID is missing.",
      );
      return;
    }

    const deepLink =
      `snipai://payment/callback?order_id=${encodeURIComponent(
        orderId,
      )}`;

    console.log(
      "[Cashfree Return] Opening Snip AI:",
      deepLink,
    );

    setMessage(
      "Opening Snip AI and verifying your payment...",
    );

    window.location.href = deepLink;

    const timer = window.setTimeout(() => {
      setMessage(
        "If Snip AI did not open automatically, open the Snip AI app manually.",
      );
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
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
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "430px",
          textAlign: "center",
          padding: "32px",
          borderRadius: "20px",
          background: "#11151d",
          border:
            "1px solid rgba(255,255,255,0.08)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "46px",
            height: "46px",
            margin: "0 auto 18px",
            borderRadius: "50%",
            border:
              "3px solid rgba(255,255,255,0.12)",
            borderTopColor: "#ffffff",
            animation:
              "return-spin 0.8s linear infinite",
          }}
        />

        <h1
          style={{
            margin: "0 0 10px",
            fontSize: "20px",
            fontWeight: 700,
          }}
        >
          Payment received
        </h1>

        <p
          style={{
            margin: 0,
            color: "#8f98a8",
            fontSize: "14px",
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
      </div>

      <style>
        {`
          @keyframes return-spin {
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
