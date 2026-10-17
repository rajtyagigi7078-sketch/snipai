import { FormEvent, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Mail,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import "./AuthScreen.css";

type OtpScreenProps = {
  email: string;
  onVerified: () => void;
  onBack: () => void;
};

function formatOtpError(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("otp_expired") ||
    lower.includes("token has expired") ||
    lower.includes("invalid")
  ) {
    return "This verification code has expired or is invalid. Please use the latest code from your email.";
  }

  if (lower.includes("rate limit")) {
    return "Too many attempts. Please wait before requesting another code.";
  }

  return message || "Verification failed. Please try again.";
}

export default function OtpScreen({
  email,
  onVerified,
  onBack,
}: OtpScreenProps) {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState(
    "Enter the verification code sent to your email.",
  );
  const [error, setError] = useState("");

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();

    setError("");
    setMessage("");

    const cleanOtp = otp
      .replace(/\D/g, "")
      .trim();

    if (!/^\d{8}$/.test(cleanOtp)) {
      setError(
        "Please enter the 8-digit verification code.",
      );
      return;
    }

    setLoading(true);

    try {
      /*
       * OTP ONLY.
       *
       * No license activation happens here.
       */
      const {
        data,
        error: verifyError,
      } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: cleanOtp,
        type: "email",
      });

      if (verifyError) {
        throw verifyError;
      }

      /*
       * Supabase should return an authenticated session.
       * If it does, main.tsx will subsequently show
       * the license activation screen.
       */
      if (!data.session) {
        throw new Error(
          "Email verification succeeded, but no authenticated session was returned. Please login again.",
        );
      }

      /*
       * Explicitly persist the returned session.
       */
      const {
        error: sessionError,
      } = await supabase.auth.setSession({
        access_token:
          data.session.access_token,
        refresh_token:
          data.session.refresh_token,
      });

      if (sessionError) {
        throw sessionError;
      }

      setMessage(
        "Email verified successfully. Continue to lifetime access activation.",
      );

      onVerified();
    } catch (err) {
      setError(
        formatOtpError(
          err instanceof Error
            ? err.message
            : "Verification failed.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    setError("");
    setMessage("");
    setResending(true);

    try {
      const {
        error: resendError,
      } = await supabase.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
      });

      if (resendError) {
        throw resendError;
      }

      setMessage(
        "A new verification code has been sent. Use the latest code only.",
      );
    } catch (err) {
      setError(
        formatOtpError(
          err instanceof Error
            ? err.message
            : "Could not resend verification code.",
        ),
      );
    } finally {
      setResending(false);
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

            <span>
              AI clipping workspace
            </span>
          </div>
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">
            EMAIL VERIFICATION
          </span>

          <h1>Verify your email.</h1>

          <p>
            We sent an 8-digit verification code to{" "}
            <strong>
              {email.trim().toLowerCase()}
            </strong>.
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={verifyOtp}
        >
          <label className="auth-field">
            <span>Verification code</span>

            <div className="auth-input-wrap">
              <Mail size={17} />

              <input
                value={otp}
                onChange={(event) =>
                  setOtp(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 8),
                  )
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="00000000"
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
              ? "Verifying..."
              : "Verify Email"}

            <ArrowRight size={17} />
          </button>

          <button
            type="button"
            className="license-link"
            disabled={loading || resending}
            onClick={() => void resendCode()}
          >
            {resending
              ? "Sending new code..."
              : "Resend verification code"}
          </button>

          <button
            type="button"
            className="license-link"
            disabled={loading || resending}
            onClick={onBack}
          >
            ← Back
          </button>
        </form>

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Email verification · Step 2 of 3
        </div>
      </div>
    </div>
  );
}
