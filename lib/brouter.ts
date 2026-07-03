// Server-side client for the local BRouter routing engine.
// The browser never calls BRouter directly; it goes through our API routes,
// which use the functions below.

import "server-only";
import { BROUTER_URL, type Profile } from "./config";
import { toLonLatsParam, type LonLat } from "./coords";

export type RouteResult = {
  /** Route geometry as GeoJSON coordinates: [lon, lat, elevation]. */
  coordinates: number[][];
  /** Total ride distance in kilometres (from BRouter's track-length). */
  distanceKm: number;
  /** Total climb in metres (BRouter "filtered ascend"), if provided. */
  ascendMeters: number | null;
};

export class BrouterError extends Error {}

function buildUrl(
  points: LonLat[],
  profile: Profile,
  format: "geojson" | "gpx",
): string {
  const params = new URLSearchParams({
    lonlats: toLonLatsParam(points),
    profile,
    alternativeidx: "0",
    format,
  });
  return `${BROUTER_URL}/brouter?${params.toString()}`;
}

async function requestBrouter(
  points: LonLat[],
  profile: Profile,
  format: "geojson" | "gpx",
): Promise<string> {
  if (points.length < 2) {
    throw new BrouterError("Een route heeft minstens twee punten nodig.");
  }
  const url = buildUrl(points, profile, format);

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
): Promise<RouteResult> {
  const body = await requestBrouter(points, profile, "geojson");

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

  return {
    coordinates: feature.geometry.coordinates,
    distanceKm: Number.isFinite(trackLength) ? trackLength / 1000 : 0,
    ascendMeters: ascend != null ? Number(ascend) : null,
  };
}

/** Fetch the route as a GPX 1.1 document (BRouter builds it for us). */
export async function fetchGpx(
  points: LonLat[],
  profile: Profile,
): Promise<string> {
  return requestBrouter(points, profile, "gpx");
}

// Minimal shape of the BRouter GeoJSON response we rely on.
type BrouterGeoJson = {
  features?: Array<{
    properties?: Record<string, string>;
    geometry?: { type: string; coordinates: number[][] };
  }>;
};
