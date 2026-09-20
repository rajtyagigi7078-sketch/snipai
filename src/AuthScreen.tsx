import { FormEvent, useState } from "react";
import { Mail, Lock, User, ArrowLeft, CheckCircle2 } from "lucide-react";
import { supabase } from "./lib/supabase";

type Mode = "login" | "signup";
type Step = "form" | "otp";

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const cleanEmail = email.trim().toLowerCase();

  function clearMessages() {
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    clearMessages();

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

        if (data.session) {
          return;
        }

        setStep("otp");
        setMessage(
          `We sent a verification code to ${cleanEmail}.`,
        );
      } else {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

        if (signInError) {
          if (
            signInError.message
              .toLowerCase()
              .includes("email not confirmed")
          ) {
            const { error: resendError } =
              await supabase.auth.resend({
                type: "signup",
                email: cleanEmail,
              });

            if (resendError) {
              throw resendError;
            }

            setStep("otp");
            setMessage(
              `Your email is not verified. We sent a new verification code to ${cleanEmail}.`,
            );
            return;
          }

          throw signInError;
        }
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();

    clearMessages();

    const cleanOtp = otp.replace(/\D/g, "");

    if (cleanOtp.length !== 8) {
      setError("Enter the 8-digit verification code.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: verifyError } =
        await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanOtp,
          type: "email",
        });

      if (verifyError) {
        throw verifyError;
      }

      if (!data.session) {
        throw new Error(
          "Verification completed, but no session was created. Please try logging in.",
        );
      }

      setMessage("Email verified successfully.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Invalid or expired verification code.";

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    clearMessages();
    setResending(true);

    try {
      const { error: resendError } =
        await supabase.auth.resend({
          type: "signup",
          email: cleanEmail,
        });

      if (resendError) {
        throw resendError;
      }

      setMessage("A new verification code has been sent.");
      setOtp("");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not resend the verification code.";

      setError(message);
    } finally {
      setResending(false);
    }
  }

  function switchMode(nextMode: Mode) {
    clearMessages();
    setMode(nextMode);
    setStep("form");
    setOtp("");
  }

  function backToForm() {
    clearMessages();
    setStep("form");
    setOtp("");
  }

  return (
    <div className="auth-screen">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />

      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">
            <span>S</span>
          </div>

          <div>
            <strong>SNIP AI</strong>
            <span>AI clipping studio</span>
          </div>
        </div>

        {step === "form" ? (
          <>
            <div className="auth-heading">
              <span className="auth-eyebrow">
                {mode === "signup"
                  ? "CREATE ACCOUNT"
                  : "WELCOME BACK"}
              </span>

              <h1>
                {mode === "signup"
                  ? "Create your account"
                  : "Welcome back"}
              </h1>

              <p>
                {mode === "signup"
                  ? "Create your Snip AI account and start creating clips."
                  : "Sign in to continue creating clips with Snip AI."}
              </p>
            </div>

            <form
              className="auth-form"
              onSubmit={handleSubmit}
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
                      placeholder="Your name"
                      autoComplete="name"
                      disabled={loading}
                    />
                  </div>
                </label>
              )}

              <label className="auth-field">
                <span>Email address</span>

                <div className="auth-input-wrap">
                  <Mail size={17} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    placeholder="you@example.com"
                    autoComplete="email"
                    disabled={loading}
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
                    placeholder="Minimum 6 characters"
                    autoComplete={
                      mode === "signup"
                        ? "new-password"
                        : "current-password"
                    }
                    disabled={loading}
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
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            <div className="auth-switch">
              <span>
                {mode === "signup"
                  ? "Already have an account?"
                  : "Don't have an account?"}
              </span>

              <button
                type="button"
                onClick={() =>
                  switchMode(
                    mode === "signup"
                      ? "login"
                      : "signup",
                  )
                }
              >
                {mode === "signup"
                  ? "Sign in"
                  : "Create account"}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="auth-back"
              onClick={backToForm}
              disabled={loading || resending}
            >
              <ArrowLeft size={16} />
              Back
            </button>

            <div className="auth-heading otp-heading">
              <span className="auth-eyebrow">
                EMAIL VERIFICATION
              </span>

              <h1>Enter your code</h1>

              <p>
                We sent an 8-digit verification code to
                <strong> {cleanEmail}</strong>.
              </p>
            </div>

            <form
              className="auth-form"
              onSubmit={handleVerifyOtp}
            >
              <label className="auth-field">
                <span>Verification code</span>

                <input
                  className="auth-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={otp}
                  onChange={(event) =>
                    setOtp(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, 8),
                    )
                  }
                  placeholder="00000000"
                  autoFocus
                  disabled={loading}
                />
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
                type="submit"
                disabled={loading || otp.length !== 8}
              >
                {loading
                  ? "Verifying..."
                  : "Verify email"}
              </button>
            </form>

            <div className="auth-resend">
              <span>Didn't receive the code?</span>

              <button
                type="button"
                onClick={handleResend}
                disabled={resending || loading}
              >
                {resending ? "Sending..." : "Resend code"}
              </button>
            </div>
          </>
        )}

        <div className="auth-footer">
          <span>Your account is secured by Supabase Auth.</span>
        </div>
      </div>

      <style>{`
        .auth-screen {
          min-height: 100vh;
          width: 100%;
          display: grid;
          place-items: center;
          position: relative;
          overflow: hidden;
          background:
            radial-gradient(circle at 20% 20%, rgba(55, 115, 255, 0.12), transparent 32%),
            radial-gradient(circle at 80% 75%, rgba(30, 92, 255, 0.10), transparent 34%),
            #080a0f;
          color: #f4f7fb;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 32px 20px;
          box-sizing: border-box;
        }

        .auth-ambient {
          position: absolute;
          width: 420px;
          height: 420px;
          border-radius: 50%;
          filter: blur(90px);
          pointer-events: none;
          opacity: .34;
        }

        .auth-ambient-one {
          background: #245cff;
          left: -180px;
          top: -150px;
        }

        .auth-ambient-two {
          background: #1677ff;
          right: -190px;
          bottom: -170px;
        }

        .auth-card {
          width: min(440px, 100%);
          position: relative;
          z-index: 1;
          box-sizing: border-box;
          padding: 34px;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 24px;
          background: rgba(14, 17, 24, .88);
          box-shadow:
            0 30px 100px rgba(0,0,0,.48),
            inset 0 1px 0 rgba(255,255,255,.035);
          backdrop-filter: blur(22px);
        }

        .auth-brand {
          display: flex;
          align-items: center;
          gap: 11px;
          margin-bottom: 42px;
        }

        .auth-logo {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: linear-gradient(145deg, #3b78ff, #1550df);
          box-shadow: 0 8px 25px rgba(39, 101, 255, .28);
          font-weight: 800;
        }

        .auth-brand strong {
          display: block;
          font-size: 14px;
          letter-spacing: .12em;
        }

        .auth-brand span {
          display: block;
          margin-top: 2px;
          color: #697487;
          font-size: 10px;
        }

        .auth-heading {
          margin-bottom: 28px;
        }

        .auth-eyebrow {
          color: #5e91ff;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .16em;
        }

        .auth-heading h1 {
          margin: 8px 0 8px;
          font-size: 28px;
          line-height: 1.15;
          letter-spacing: -.03em;
        }

        .auth-heading p {
          margin: 0;
          color: #7e899a;
          font-size: 13px;
          line-height: 1.6;
        }

        .auth-heading p strong {
          color: #dfe5ee;
        }

        .auth-form {
          display: grid;
          gap: 17px;
        }

        .auth-field {
          display: grid;
          gap: 8px;
        }

        .auth-field > span {
          color: #aab3c1;
          font-size: 11px;
          font-weight: 600;
        }

        .auth-input-wrap {
          height: 46px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 13px;
          border: 1px solid #252c38;
          border-radius: 11px;
          background: #0b0e14;
          box-sizing: border-box;
          transition: border-color .18s, box-shadow .18s;
        }

        .auth-input-wrap:focus-within {
          border-color: #356ff1;
          box-shadow: 0 0 0 3px rgba(53,111,241,.10);
        }

        .auth-input-wrap svg {
          flex: 0 0 auto;
          color: #586477;
        }

        .auth-input-wrap input {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          color: #f2f5fa;
          font-size: 13px;
        }

        .auth-input-wrap input::placeholder {
          color: #4e5868;
        }

        .auth-submit {
          height: 46px;
          margin-top: 4px;
          border: 0;
          border-radius: 11px;
          background: linear-gradient(135deg, #3a76ff, #1e58e6);
          color: white;
          font-size: 13px;
          font-weight: 750;
          cursor: pointer;
          box-shadow: 0 10px 30px rgba(35, 94, 235, .22);
          transition: transform .15s, filter .15s, opacity .15s;
        }

        .auth-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.08);
        }

        .auth-submit:disabled {
          opacity: .48;
          cursor: not-allowed;
        }

        .auth-message {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 11px 12px;
          border-radius: 10px;
          font-size: 11px;
          line-height: 1.5;
        }

        .auth-error {
          border: 1px solid rgba(255, 91, 91, .16);
          background: rgba(255, 72, 72, .07);
          color: #ff9b9b;
        }

        .auth-success {
          border: 1px solid rgba(64, 190, 128, .16);
          background: rgba(64, 190, 128, .07);
          color: #8ce0b8;
        }

        .auth-switch,
        .auth-resend {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
          margin-top: 22px;
          color: #697487;
          font-size: 11px;
        }

        .auth-switch button,
        .auth-resend button,
        .auth-back {
          border: 0;
          background: transparent;
          color: #6e9bff;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
        }

        .auth-switch button:hover,
        .auth-resend button:hover,
        .auth-back:hover {
          color: #9ab9ff;
        }

        .auth-resend button:disabled,
        .auth-back:disabled {
          opacity: .45;
          cursor: not-allowed;
        }

        .auth-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 25px;
          font-size: 11px;
        }

        .otp-heading {
          margin-bottom: 25px;
        }

        .auth-otp {
          width: 100%;
          height: 58px;
          box-sizing: border-box;
          border: 1px solid #252c38;
          border-radius: 12px;
          outline: 0;
          background: #0b0e14;
          color: #f5f7fb;
          text-align: center;
          font-size: 25px;
          font-weight: 750;
          letter-spacing: .48em;
          padding-left: .48em;
        }

        .auth-otp:focus {
          border-color: #356ff1;
          box-shadow: 0 0 0 3px rgba(53,111,241,.10);
        }

        .auth-otp::placeholder {
          color: #394251;
        }

        .auth-footer {
          margin-top: 30px;
          padding-top: 17px;
          border-top: 1px solid rgba(255,255,255,.055);
          text-align: center;
          color: #4f5969;
          font-size: 9px;
        }

        @media (max-width: 520px) {
          .auth-card {
            padding: 26px 22px;
            border-radius: 20px;
          }

          .auth-brand {
            margin-bottom: 32px;
          }

          .auth-heading h1 {
            font-size: 25px;
          }
        }
      `}</style>
    </div>
  );
}
