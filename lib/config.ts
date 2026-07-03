// Central configuration, read from environment variables (see .env.example).

/** Base URL of the local BRouter server. */
export const BROUTER_URL = process.env.BROUTER_URL ?? "http://localhost:17777";

/** The two routing profiles we ship (file names in brouter/profiles2/). */
export const PROFILES = ["paved", "unpaved"] as const;
export type Profile = (typeof PROFILES)[number];

export function isProfile(v: unknown): v is Profile {
  return typeof v === "string" && (PROFILES as readonly string[]).includes(v);
}
