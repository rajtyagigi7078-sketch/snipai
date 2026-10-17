import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import App from "./App";
import AuthScreen from "./AuthScreen";
import LicenseActivationScreen from "./LicenseActivationScreen";
import { supabase } from "./lib/supabase";
import { getLifetimeLicenseState } from "./lib/license";

function LoadingScreen({
  message,
}: {
  message: string;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#080a0f",
        color: "#7d8798",
      }}
    >
      {message}
    </div>
  );
}

function Root() {
  const [session, setSession] =
    useState<Session | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [licenseLoading, setLicenseLoading] =
    useState(false);

  const [licenseActive, setLicenseActive] =
    useState(false);

  const [licenseCheckError, setLicenseCheckError] =
    useState(false);

  async function refreshLicense() {
    setLicenseLoading(true);
    setLicenseCheckError(false);

    try {
      const state =
        await getLifetimeLicenseState();

      setLicenseActive(state.active);
    } catch (error) {
      console.error(
        "[License] Failed to check lifetime license:",
        error,
      );

      setLicenseActive(false);
      setLicenseCheckError(true);
    } finally {
      setLicenseLoading(false);
    }
  }

  function handleLicenseActivated() {
    setLicenseActive(true);
    setLicenseCheckError(false);
    setLicenseLoading(false);
  }

  async function handleBackToLogin() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message || "Could not return to login.");
    }

    setSession(null);
    setLicenseActive(false);
    setLicenseLoading(false);
    setLicenseCheckError(false);
  }

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const {
        data,
        error,
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error(
          "[Auth] Failed to get session:",
          error,
        );

        setSession(null);
        setLicenseLoading(false);
      } else {
        setSession(data.session);

        if (data.session) {
          /*
           * Every authenticated session gets one license check.
           */
          void refreshLicense();
        } else {
          setLicenseLoading(false);
        }
      }

      setLoading(false);
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) return;

        setSession(nextSession);

        if (!nextSession) {
          setLicenseActive(false);
          setLicenseLoading(false);
          setLicenseCheckError(false);
          return;
        }

        /*
         * New login / OTP verification.
         * Check license after authentication.
         */
        void refreshLicense();
      },
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <LoadingScreen
        message="Loading Snip AI..."
      />
    );
  }

  /*
   * STEP 1:
   * No authenticated account.
   */
  if (!session) {
    return <AuthScreen />;
  }

  /*
   * STEP 2:
   * Authentication exists.
   * Check lifetime license.
   */
  if (licenseLoading) {
    return (
      <LoadingScreen
        message="Checking lifetime access..."
      />
    );
  }

  /*
   * License lookup itself failed.
   * Don't pretend the account is unlicensed.
   */
  if (licenseCheckError) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#080a0f",
          color: "#7d8798",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ marginBottom: 12 }}>
            Could not verify your lifetime access.
          </div>

          <button
            type="button"
            onClick={() => void refreshLicense()}
            style={{
              border: "1px solid #293241",
              borderRadius: 10,
              background: "#11151d",
              color: "#ffffff",
              padding: "10px 16px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  /*
   * STEP 3:
   * Account exists and is authenticated,
   * but lifetime license has not been activated.
   *
   * NEVER sign out here.
   */
  if (!licenseActive) {
    return (
      <LicenseActivationScreen
        onLicenseActivated={handleLicenseActivated}
        onBackToLogin={handleBackToLogin}
      />
    );
  }

  /*
   * STEP 4:
   * Authenticated + lifetime license active.
   */
  return <App />;
}

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
