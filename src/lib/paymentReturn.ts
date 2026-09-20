import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { verifyLifetimePayment } from "./billing";

let started = false;
let processingOrder: string | null = null;

function extractOrderId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);

    return (
      url.searchParams.get("order_id") ||
      url.searchParams.get("orderId") ||
      url.searchParams.get("payment_order_id")
    );
  } catch {
    return null;
  }
}

async function verifyReturnedPayment(orderId: string) {
  if (!orderId || processingOrder === orderId) {
    return;
  }

  processingOrder = orderId;

  console.log(
    "[PaymentReturn] Verifying Cashfree order:",
    orderId,
  );

  try {
    for (let attempt = 1; attempt <= 20; attempt++) {
      try {
        const result = await verifyLifetimePayment(orderId);

        console.log(
          `[PaymentReturn] Verification ${attempt}/20:`,
          result,
        );

        if (result?.active) {
          console.log(
            "[PaymentReturn] LIFETIME ACCESS ACTIVATED.",
          );

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );

          window.location.reload();
          return;
        }
      } catch (error) {
        console.warn(
          "[PaymentReturn] Verification failed:",
          error,
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 2000),
      );
    }

    console.warn(
      "[PaymentReturn] Payment is not confirmed yet.",
    );
  } finally {
    processingOrder = null;
  }
}

async function handleUrl(rawUrl: string) {
  if (
    !rawUrl.startsWith("snipai://payment/")
  ) {
    return;
  }

  const orderId = extractOrderId(rawUrl);

  if (!orderId) {
    console.warn(
      "[PaymentReturn] Payment deep-link has no order_id:",
      rawUrl,
    );
    return;
  }

  console.log(
    "[PaymentReturn] Payment deep-link received:",
    rawUrl,
  );

  await verifyReturnedPayment(orderId);
}

export async function startPaymentReturnHandler() {
  if (started) {
    return;
  }

  started = true;

  /*
   * Browser/localhost return support.
   * Useful during development and harmless in production.
   */
  const browserParams = new URLSearchParams(
    window.location.search,
  );

  const browserOrderId =
    browserParams.get("order_id") ||
    browserParams.get("orderId") ||
    browserParams.get("payment_order_id");

  if (browserOrderId) {
    void verifyReturnedPayment(browserOrderId);
  }

  /*
   * Tauri deep-link:
   * handles both app startup and links received while
   * the application is already running.
   */
  try {
    const startUrls = await getCurrent();

    if (startUrls?.length) {
      for (const url of startUrls) {
        await handleUrl(url);
      }
    }

    await onOpenUrl((urls) => {
      for (const url of urls) {
        void handleUrl(url);
      }
    });

    console.log(
      "[PaymentReturn] Tauri deep-link handler ready.",
    );
  } catch (error) {
    console.warn(
      "[PaymentReturn] Could not initialize Tauri deep-link handler:",
      error,
    );
  }
}
