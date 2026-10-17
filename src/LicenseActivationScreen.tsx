import { FormEvent, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
} from "lucide-react";
import {
  activateLifetimeLicense,
  getLifetimeLicenseState,
} from "./lib/license";
import "./AuthScreen.css";

type LicenseActivationScreenProps = {
  onLicenseActivated: () => void;
  onBackToLogin: () => Promise<void>;
};

function formatLicenseError(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("already activated on another account") ||
    lower.includes("already activated")
  ) {
    return "This license key is already activated on another account. Please use your own lifetime license key.";
  }

  if (
    lower.includes("not found") ||
    lower.includes("invalid license") ||
    lower.includes("invalid key")
  ) {
    return "This license key is invalid. Please check the key and try again.";
  }

  if (lower.includes("revoked")) {
    return "This license key has been revoked. Please use another valid key.";
  }

  return message || "License activation failed. Please try again.";
}

export default function LicenseActivationScreen({
  onLicenseActivated,
  onBackToLogin,
}: LicenseActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function backToLogin() {
    setError("");
    setSigningOut(true);

    try {
      await onBackToLogin();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not return to login. Please try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();

    setError("");
    setMessage("");

    const cleanKey =
      licenseKey.trim().toUpperCase();

    if (!cleanKey) {
      setError("Please enter your lifetime license key.");
      return;
    }

    setLoading(true);

    try {
      await activateLifetimeLicense(cleanKey);

      const state =
        await getLifetimeLicenseState();

      if (!state.active) {
        throw new Error(
          "License activation could not be confirmed.",
        );
      }

      setMessage(
        "Lifetime access activated successfully.",
      );

      onLicenseActivated();
    } catch (err) {
      setError(
        formatLicenseError(
          err instanceof Error
            ? err.message
            : "License activation failed.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function openLicenseWebsite() {
    const url =
      import.meta.env.VITE_LICENSE_WEBSITE_URL ||
      "https://sinpai1.netlify.app/get-key.html";

    try {
      await openUrl(url);
    } catch (error) {
      console.error(
        "Failed to open license website:",
        error,
      );
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />

      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">S</div>

          <div>
            <strong>
              Snip <b>AI</b>
            </strong>
            <span>AI clipping workspace</span>
          </div>
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">
            LIFETIME ACCESS
          </span>

          <h1>
            Activate your lifetime access.
          </h1>

          <p>
            Your account is ready. Enter your lifetime
            license key to start using Snip AI.
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={activate}
        >
          <label className="auth-field">
            <span>Lifetime license key</span>

            <div className="auth-input-wrap">
              <KeyRound size={17} />

              <input
                value={licenseKey}
                onChange={(event) =>
                  setLicenseKey(
                    event.target.value.toUpperCase(),
                  )
                }
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="SNIP-LIFE-XXXX-XXXX"
                autoFocus
              />
            </div>
          </label>

          {error && (
            <div className="auth-message auth-error">
              {error}
            </div>
          )}

          {message && (
            <div className="auth-message auth-success">
              <CheckCircle2 size={16} />
              <span>{message}</span>
            </div>
          )}

          <button
            className="auth-submit"
            disabled={loading}
            type="submit"
          >
            {loading
              ? "Activating..."
              : "Activate Lifetime Access"}
            <ArrowRight size={17} />
          </button>

          <button
            type="button"
            className="license-back-button"
            onClick={() => void backToLogin()}
            disabled={loading || signingOut}
          >
            <ArrowLeft size={16} />
            {signingOut ? "Returning to login..." : "Back to Login"}
          </button>

          <button
            type="button"
            className="license-link"
            onClick={openLicenseWebsite}
            disabled={loading || signingOut}
          >
            <KeyRound size={15} />
            Don't have a key? Get Lifetime Access — ₹100
          </button>
        </form>

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Lifetime access · One-time ₹100
        </div>
      </div>
    </div>
  );
}
