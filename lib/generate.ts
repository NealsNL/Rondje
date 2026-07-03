// Round-trip generation: given a start, a compass direction and a target
// distance, build a loop of waypoints and iterate on its size until the real
// (road-snapped) ride distance is close to the target.

import "server-only";
import { fetchRoute, BrouterError, type RouteResult } from "./brouter";
import { destinationPoint } from "./geo";
import type { LonLat } from "./coords";
import type { Profile } from "./config";

const BEARINGS = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
} as const;

export type Direction = keyof typeof BEARINGS;

export function isDirection(v: unknown): v is Direction {
  return typeof v === "string" && v in BEARINGS;
}

export type GenerateResult = {
  waypoints: LonLat[];
  distanceKm: number;
  ascendMeters: number | null;
  coordinates: number[][];
  iterations: number;
  withinTolerance: boolean;
};

const MAX_ITERATIONS = 6;
const TOLERANCE = 0.1; // within 10% of target

/**
 * Build a non-out-and-back loop: start -> side -> far -> other side -> end.
 * The far point sits at `radius` along the chosen bearing; the two side points
 * sit at +/-55 degrees so the loop encloses area instead of doubling back.
 */
function buildLoop(
  start: LonLat,
  end: LonLat,
  bearingDeg: number,
  radiusMeters: number,
): LonLat[] {
  const left = destinationPoint(start, bearingDeg - 55, radiusMeters * 0.62);
  const far = destinationPoint(start, bearingDeg, radiusMeters);
  const right = destinationPoint(start, bearingDeg + 55, radiusMeters * 0.62);
  return [start, left, far, right, end];
}

export async function generateLoop(opts: {
  start: LonLat;
  end?: LonLat;
  direction: Direction;
  targetKm: number;
  profile: Profile;
}): Promise<GenerateResult> {
  const { start, direction, targetKm, profile } = opts;
  const end = opts.end ?? start;
  const bearing = BEARINGS[direction];

  // Seed: straight-line radius is roughly 0.35x the target ride distance.
  let radius = 0.35 * targetKm * 1000;

  let best:
    | { wps: LonLat[]; result: RouteResult; err: number; iteration: number }
    | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const wps = buildLoop(start, end, bearing, radius);

    let result: RouteResult;
    try {
      result = await fetchRoute(wps, profile);
    } catch (err) {
      // A generated point may fall on water or off the map; shrink and retry.
      if (err instanceof BrouterError) {
        radius *= 0.8;
        continue;
      }
      throw err;
    }

    const actual = result.distanceKm || 0.0001;
    const err = Math.abs(actual - targetKm) / targetKm;
    if (!best || err < best.err) best = { wps, result, err, iteration: i + 1 };
    if (err <= TOLERANCE) break;

    // Scale the radius toward the target, but damp big jumps.
    const factor = Math.max(0.5, Math.min(2, targetKm / actual));
    radius *= factor;
  }

  if (!best) {
    throw new BrouterError(
      "Kon geen rondrit genereren vanaf dit punt. Probeer een ander startpunt, richting of afstand.",
    );
  }

  return {
    waypoints: best.wps,
    distanceKm: best.result.distanceKm,
    ascendMeters: best.result.ascendMeters,
    coordinates: best.result.coordinates,
    iterations: best.iteration,
    withinTolerance: best.err <= TOLERANCE,
  };
}
