// Server-side client for the local BRouter routing engine.
// The browser never calls BRouter directly; it goes through our API routes,
// which use the functions below.

import "server-only";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROUTER_URL, type Profile } from "./config";
import { toLonLatsParam, type LonLat } from "./coords";
import { buildSurfaceInfo, type SurfaceInfo } from "./surface";

// "Quiet roads" is a slider (0 = direct, 3 = very quiet). BRouter ignores URL
// profile parameters, so we template a profile variant with the matching
// busy-road penalty and route with that. Variants are written once and reused.
const PROFILE_DIR = join(process.cwd(), "brouter", "profiles2");
const QUIET_PENALTY = [0, 1, 2, 3.5];

function resolveProfileName(profile: Profile, quietness: number): string {
  const q = Math.max(0, Math.min(3, Math.round(quietness || 0)));
  if (q === 0) return profile;
  const name = `${profile}-q${q}`;
  const file = join(PROFILE_DIR, `${name}.brf`);
  try {
    if (!existsSync(file)) {
      const base = readFileSync(join(PROFILE_DIR, `${profile}.brf`), "utf8");
      writeFileSync(
        file,
        base.replace(
          /assign\s+busy_road_penalty\s*=\s*[\d.]+/,
          `assign busy_road_penalty = ${QUIET_PENALTY[q]}`,
        ),
        "utf8",
      );
    }
    return name;
  } catch {
    return profile; // fall back to the base profile on any filesystem error
  }
}

export type RouteResult = {
  /** Route geometry as GeoJSON coordinates: [lon, lat, elevation]. */
  coordinates: number[][];
  /** Total ride distance in kilometres (from BRouter's track-length). */
  distanceKm: number;
  /** Total climb in metres (BRouter "filtered ascend"), if provided. */
  ascendMeters: number | null;
  /** Total ride time in seconds (BRouter kinematic estimate), if provided. */
  totalTimeSeconds: number | null;
  /** Surface breakdown + colour-coded geometry, if BRouter returned tags. */
  surface: SurfaceInfo | null;
};

export class BrouterError extends Error {}

function buildUrl(
  points: LonLat[],
  profileName: string,
  format: "geojson" | "gpx",
): string {
  const params = new URLSearchParams({
    lonlats: toLonLatsParam(points),
    profile: profileName,
    alternativeidx: "0",
    format,
  });
  return `${BROUTER_URL}/brouter?${params.toString()}`;
}

async function requestBrouter(
  points: LonLat[],
  profile: Profile,
  format: "geojson" | "gpx",
  quietness: number,
): Promise<string> {
  if (points.length < 2) {
    throw new BrouterError("Een route heeft minstens twee punten nodig.");
  }
  const url = buildUrl(points, resolveProfileName(profile, quietness), format);

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new BrouterError(
      "Kan BRouter niet bereiken. Draait de routeserver? (start-brouter)",
    );
  }

  const text = await res.text();
  // BRouter reports routing problems as a short plain-text body (often with
  // status 200), so we detect them by shape rather than by HTTP status.
  if (!res.ok || looksLikeError(text, format)) {
    throw new BrouterError(cleanupBrouterMessage(text));
  }
  return text;
}

function looksLikeError(body: string, format: "geojson" | "gpx"): boolean {
  const trimmed = body.trimStart();
  if (format === "geojson") return !trimmed.startsWith("{");
  return !trimmed.startsWith("<"); // gpx/xml
}

function cleanupBrouterMessage(body: string): string {
  const msg = body.trim().slice(0, 300);
  if (/from-position not mapped|to-position not mapped/i.test(msg)) {
    return "Een van de punten ligt te ver van een (fiets)weg. Zet het punt dichter bij een weg.";
  }
  if (/target island detected|no route/i.test(msg)) {
    return "Geen route gevonden tussen deze punten met dit profiel.";
  }
  return msg || "BRouter gaf een onbekende fout terug.";
}

/** Fetch a route as GeoJSON and extract geometry + distance + climb. */
export async function fetchRoute(
  points: LonLat[],
  profile: Profile,
  quietness = 0,
): Promise<RouteResult> {
  const body = await requestBrouter(points, profile, "geojson", quietness);

  let json: BrouterGeoJson;
  try {
    json = JSON.parse(body) as BrouterGeoJson;
  } catch {
    throw new BrouterError("Ongeldig antwoord van BRouter (geen geldige GeoJSON).");
  }

  const feature = json.features?.[0];
  if (!feature?.geometry?.coordinates?.length) {
    throw new BrouterError("BRouter gaf een lege route terug.");
  }

  const props = feature.properties ?? {};
  const trackLength = Number(props["track-length"]);
  const ascend = props["filtered ascend"] ?? props["plain-ascend"];
  const totalTime = Number(props["total-time"]);
  const coordinates = feature.geometry.coordinates;

  return {
    coordinates,
    distanceKm: Number.isFinite(trackLength) ? trackLength / 1000 : 0,
    ascendMeters: ascend != null ? Number(ascend) : null,
    totalTimeSeconds: Number.isFinite(totalTime) ? totalTime : null,
    surface: buildSurfaceInfo(coordinates, feature.properties?.messages),
  };
}

/** Fetch the route as a GPX 1.1 document (BRouter builds it for us). */
export async function fetchGpx(
  points: LonLat[],
  profile: Profile,
  quietness = 0,
): Promise<string> {
  return requestBrouter(points, profile, "gpx", quietness);
}

// Minimal shape of the BRouter GeoJSON response we rely on.
type BrouterGeoJson = {
  features?: Array<{
    properties?: Record<string, string> & { messages?: string[][] };
    geometry?: { type: string; coordinates: number[][] };
  }>;
};
