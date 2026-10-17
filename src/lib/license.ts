import { supabase } from "./supabase";

export type LicenseState = {
  active: boolean;
  keyLast4?: string | null;
};

export async function getLifetimeLicenseState(): Promise<LicenseState> {
  const { data, error } = await supabase.rpc("get_lifetime_license_state");
  if (error) throw error;
  return {
    active: Boolean(data?.active),
    keyLast4: data?.key_last4 ?? null,
  };
}

export async function activateLifetimeLicense(licenseKey: string) {
  const key = licenseKey.trim().toUpperCase();
  if (!key) throw new Error("Please enter your lifetime license key.");

  const { data, error } = await supabase.rpc("activate_lifetime_license", {
    p_license_key: key,
  });

  if (error) throw error;
  if (!data?.active) {
    throw new Error(data?.message || "License activation failed.");
  }

  return data;
}
