// Central configuration, read from environment variables (see .env.example).

/** Base URL of the local BRouter server. */
export const BROUTER_URL = process.env.BROUTER_URL ?? "http://localhost:17777";

/** The two routing profiles we ship (file names in brouter/profiles2/). */
export const PROFILES = ["paved", "unpaved"] as const;
export type Profile = (typeof PROFILES)[number];

export function isProfile(v: unknown): v is Profile {
  return typeof v === "string" && (PROFILES as readonly string[]).includes(v);
}

/** Quiet-roads slider: 0 = direct, 3 = avoid busy roads as much as possible. */
export function clampQuietness(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, n));
}

/** Trip type: "loop" = rondje back to start, "ptp" = one-way from A to B. */
export type TripType = "loop" | "ptp";

export function isTripType(v: unknown): v is TripType {
  return v === "loop" || v === "ptp";
}

/** Close the waypoint list back to the start when it is a loop. */
export function routeWaypoints<T>(waypoints: T[], tripType: TripType): T[] {
  return tripType === "loop" && waypoints.length >= 2
    ? [...waypoints, waypoints[0]]
    : waypoints;
}
