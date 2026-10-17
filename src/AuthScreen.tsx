import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import "./AuthScreen.css";

type Mode = "login" | "signup";
type Step = "form" | "otp";

type AuthScreenProps = {
  onAuthSuccess?: () => void;
};

const RESEND_COOLDOWN_SECONDS = 60;

function formatAuthError(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }

  if (lower.includes("email not confirmed")) {
    return "Please verify your email first.";
  }

  if (
    lower.includes("otp_expired") ||
    lower.includes("token has expired") ||
    lower.includes("invalid or expired")
  ) {
    return "This verification code has expired or is invalid. Please use the latest code from your email.";
  }

  if (lower.includes("password should be at least")) {
    return "Password must be at least 6 characters.";
  }

  if (lower.includes("user already registered")) {
    return "An account with this email already exists. Please login instead.";
  }

  if (lower.includes("rate limit")) {
    return "Too many attempts. Please wait a little and try again.";
  }

  if (lower.includes("email rate limit")) {
    return "Too many verification emails were requested. Please wait before requesting another code.";
  }

  return message || "Something went wrong. Please try again.";
}

export default function AuthScreen({
  onAuthSuccess,
}: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = window.setInterval(() => {
      setResendCooldown((current) =>
        Math.max(0, current - 1),
      );
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  function clearMessages() {
    setError("");
    setMessage("");
  }

  function startResendCooldown() {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearMessages();

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    if (mode === "signup" && !fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        /*
         * ACCOUNT CREATION ONLY.
         *
         * No license key is collected here.
         * No license RPC is called here.
         */
        const { data, error: signUpError } =
          await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: fullName.trim(),
              },
            },
          });

        if (signUpError) {
          throw signUpError;
        }

        /*
         * If Supabase returned a session immediately,
         * email confirmation is disabled.
         *
         * Authentication is complete. main.tsx will check
         * the license separately and show the license screen.
         */
        if (data.session) {
          onAuthSuccess?.();
          return;
        }

        /*
         * Normal case:
         * Confirm Email is enabled.
         * Wait for OTP.
         */
        setStep("otp");
        startResendCooldown();

        setMessage(
          `Verification code sent to ${cleanEmail}. Please verify your email to continue.`,
        );

        return;
      }

      /*
       * LOGIN ONLY.
       *
       * No license key is required here.
       */
      const { error: signInError } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

      if (signInError) {
        const lower =
          signInError.message.toLowerCase();

        /*
         * Existing account but email is not verified.
         * Send a fresh signup verification code.
         */
        if (lower.includes("email not confirmed")) {
          const { error: resendError } =
            await supabase.auth.resend({
              type: "signup",
              email: cleanEmail,
            });

          if (resendError) {
            throw resendError;
          }

          setStep("otp");
          startResendCooldown();

          setMessage(
            `Your email is not verified. A new verification code was sent to ${cleanEmail}.`,
          );

          return;
        }

        throw signInError;
      }

      /*
       * Login successful.
       *
       * main.tsx will now check the lifetime license:
       * active license → App
       * no license → LicenseActivationScreen
       */
      onAuthSuccess?.();
    } catch (err) {
      setError(
        formatAuthError(
          err instanceof Error
            ? err.message
            : "Something went wrong.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    clearMessages();

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.replace(/\D/g, "").trim();

    if (!cleanEmail) {
      setError("Email address is missing.");
      return;
    }

    if (!/^\d{8}$/.test(cleanOtp)) {
      setError(
        "Please enter the 8-digit verification code.",
      );
      return;
    }

    setLoading(true);

    try {
      /*
       * OTP verification ONLY.
       *
       * License activation does NOT happen here anymore.
       */
      const {
        data: verifyData,
        error: verifyError,
      } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanOtp,
        type: "email",
      });

      if (verifyError) {
        throw verifyError;
      }

      /*
       * Make sure an authenticated session exists.
       */
      if (!verifyData.session) {
        throw new Error(
          "Email was verified, but no authenticated session was returned. Please login again.",
        );
      }

      /*
       * Explicitly persist the returned session.
       */
      const { error: sessionError } =
        await supabase.auth.setSession({
          access_token:
            verifyData.session.access_token,
          refresh_token:
            verifyData.session.refresh_token,
        });

      if (sessionError) {
        throw sessionError;
      }

      /*
       * From this point the account is authenticated.
       *
       * main.tsx will detect:
       * session = true
       * license = false
       *
       * and show LicenseActivationScreen.
       */
      setMessage(
        "Email verified successfully. Now activate your lifetime access.",
      );

      onAuthSuccess?.();
    } catch (err) {
      setError(
        formatAuthError(
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
    if (resendCooldown > 0 || resending) {
      return;
    }

    clearMessages();
    setResending(true);

    try {
      const cleanEmail =
        email.trim().toLowerCase();

      const { error: resendError } =
        await supabase.auth.resend({
          type: "signup",
          email: cleanEmail,
        });

      if (resendError) {
        throw resendError;
      }

      startResendCooldown();

      setMessage(
        `A new verification code was sent to ${cleanEmail}.`,
      );
    } catch (err) {
      setError(
        formatAuthError(
          err instanceof Error
            ? err.message
            : "Could not resend verification code.",
        ),
      );
    } finally {
      setResending(false);
    }
  }

  function backToForm() {
    clearMessages();
    setOtp("");
    setStep("form");
  }

  function switchMode() {
    clearMessages();
    setOtp("");
    setStep("form");

    setMode((current) =>
      current === "login" ? "signup" : "login",
    );
  }

  /*
   * OTP SCREEN
   */
  if (step === "otp") {
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
              disabled={
                resending ||
                resendCooldown > 0 ||
                loading
              }
              onClick={() => void resendCode()}
            >
              {resending
                ? "Sending new code..."
                : resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : "Resend verification code"}
            </button>

            <button
              type="button"
              className="license-link"
              onClick={backToForm}
              disabled={loading || resending}
            >
              ← Back
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

  /*
   * LOGIN / SIGNUP SCREEN
   */
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
            {mode === "login"
              ? "WELCOME BACK"
              : "CREATE ACCOUNT"}
          </span>

          <h1>
            {mode === "login"
              ? "Welcome back."
              : "Create your account."}
          </h1>

          <p>
            {mode === "login"
              ? "Login with your Snip AI account."
              : "Create your account and verify your email."}
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={submit}
        >
          {mode === "signup" && (
            <label className="auth-field">
              <span>Full name</span>

              <div className="auth-input-wrap">
                <User size={17} />

                <input
                  value={fullName}
                  onChange={(event) =>
                    setFullName(event.target.value)
                  }
                  autoComplete="name"
                  placeholder="Your name"
                />
              </div>
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>

            <div className="auth-input-wrap">
              <Mail size={17} />

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
          </label>

          <label className="auth-field">
            <span>Password</span>

            <div className="auth-input-wrap">
              <Lock size={17} />

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete={
                  mode === "login"
                    ? "current-password"
                    : "new-password"
                }
                placeholder="At least 6 characters"
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
              ? "Please wait..."
              : mode === "login"
                ? "Login"
                : "Create Account"}
            <ArrowRight size={17} />
          </button>
        </form>

        <div className="auth-switch">
          <span>
            {mode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}
          </span>

          <button
            type="button"
            disabled={loading}
            onClick={switchMode}
          >
            {mode === "login"
              ? "Create Account"
              : "Login"}
          </button>
        </div>

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Lifetime access · One-time ₹100
        </div>
      </div>
    </div>
  );
}
