import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function LicenseActivation() {
  const [licenseKey, setLicenseKey] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const checkLicense = async () => {
    try {
      const { data, error: rpcError } =
        await supabase.rpc("get_lifetime_license_state");

      if (rpcError) {
        console.error(
          "[License] State check failed:",
          rpcError,
        );
        return;
      }

      setActive(Boolean(data?.active));
    } catch (err) {
      console.error(
        "[License] State check failed:",
        err,
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void checkLicense();
  }, []);

  const activate = async () => {
    setError("");
    setMessage("");

    const cleaned = licenseKey
      .trim()
      .replace(/\s+/g, "");

    if (!cleaned) {
      setError("Please enter your license key.");
      return;
    }

    try {
      setActivating(true);

      const { data, error: rpcError } =
        await supabase.rpc(
          "activate_lifetime_license",
          {
            p_license_key: cleaned,
          },
        );

      if (rpcError) {
        throw new Error(
          rpcError.message ||
            "License activation failed.",
        );
      }

      if (!data?.active) {
        throw new Error(
          data?.error ||
            "Invalid or already-used license key.",
        );
      }

      setActive(true);
      setLicenseKey("");
      setMessage(
        "Lifetime license activated successfully.",
      );

      window.setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (err) {
      console.error(
        "[License] Activation failed:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "License activation failed.",
      );
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="settings-card license-settings-card">
      <div className="settings-card-title">
        <div className="settings-card-icon">
          <KeyRound size={17} />
        </div>

        <div>
          <strong>Lifetime license</strong>
          <span>
            Activate your Snip AI lifetime license key.
          </span>
        </div>
      </div>

      {loading ? (
        <div className="license-loading">
          <LoaderCircle
            size={16}
            className="button-spinner"
          />
          Checking license...
        </div>
      ) : active ? (
        <div className="license-active-box">
          <div className="license-active-icon">
            <Check size={17} />
          </div>

          <div>
            <strong>Lifetime access active</strong>
            <span>
              This account has an active Snip AI
              lifetime license.
            </span>
          </div>

          <ShieldCheck size={17} />
        </div>
      ) : (
        <>
          <label className="settings-label">
            License key
          </label>

          <div className="license-input-row">
            <input
              className="welcome-settings-input license-key-input"
              value={licenseKey}
              onChange={(event) =>
                setLicenseKey(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void activate();
                }
              }}
              placeholder="SNIP-LIFE-XXXXXXXXXXXXXXXXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              type="button"
              className="generate-button license-activate-button"
              onClick={() => void activate()}
              disabled={activating}
            >
              {activating ? (
                <>
                  <LoaderCircle
                    size={16}
                    className="button-spinner"
                  />
                  Activating...
                </>
              ) : (
                <>
                  <KeyRound size={16} />
                  Activate
                </>
              )}
            </button>
          </div>

          {message && (
            <div className="license-success">
              <Check size={14} />
              {message}
            </div>
          )}

          {error && (
            <div className="license-error">
              {error}
            </div>
          )}

          <small className="license-help">
            Enter the lifetime license key provided
            with your Snip AI purchase.
          </small>
        </>
      )}
    </div>
  );
}
