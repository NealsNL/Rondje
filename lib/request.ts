// Shared request validation helpers for the API routes.

import type { LonLat } from "./coords";

/** Validate and normalise an untrusted "waypoints" payload into LonLat[]. */
export function parseWaypoints(input: unknown): LonLat[] {
  if (!Array.isArray(input) || input.length < 2) {
    throw new Error("Een route heeft minstens twee punten nodig.");
  }
  return input.map((raw, i) => {
    const p = raw as Record<string, unknown>;
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Punt ${i + 1} heeft ongeldige coördinaten.`);
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error(`Punt ${i + 1} ligt buiten geldige coördinaten.`);
    }
    return { lon, lat };
  });
}
