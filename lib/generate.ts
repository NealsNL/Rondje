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

const LOOP_POINTS = 5; // waypoints placed around the circle (besides the start)

/**
 * Build a round loop. The waypoints sit on a circle around a centre placed in
 * the chosen direction, spanning a 280-degree arc (an 80-degree gap is left on
 * the start side). Because the first and last waypoints are on opposite sides
 * of the start, the outbound and return legs approach from different roads
 * instead of doubling back on the same street.
 *
 * Returns the OPEN loop [start, p0, ..., pN]; the caller closes it back to the
 * start.
 */
function buildLoop(
  start: LonLat,
  bearingDeg: number,
  radiusMeters: number,
): LonLat[] {
  const arcSpan = 280;
  const center = destinationPoint(start, bearingDeg, radiusMeters);
  const wps: LonLat[] = [start];
  for (let k = 0; k < LOOP_POINTS; k++) {
    const b = bearingDeg - arcSpan / 2 + (k * arcSpan) / (LOOP_POINTS - 1);
    wps.push(destinationPoint(center, b, radiusMeters));
  }
  return wps;
}

export async function generateLoop(opts: {
  start: LonLat;
  direction: Direction;
  targetKm: number;
  profile: Profile;
}): Promise<GenerateResult> {
  const { start, direction, targetKm, profile } = opts;
  const bearing = BEARINGS[direction];

  // Seed: for a circular loop the radius is roughly targetKm / (2*pi).
  let radius = 0.15 * targetKm * 1000;

  let best:
    | { open: LonLat[]; result: RouteResult; err: number; iteration: number }
    | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const open = buildLoop(start, bearing, radius);
    const closed = [...open, start]; // route back to the start to measure

    let result: RouteResult;
    try {
      result = await fetchRoute(closed, profile);
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
    if (!best || err < best.err) best = { open, result, err, iteration: i + 1 };
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
    // Open loop; the app closes it back to the start in "rondje" mode.
    waypoints: best.open,
    distanceKm: best.result.distanceKm,
    ascendMeters: best.result.ascendMeters,
    coordinates: best.result.coordinates,
    iterations: best.iteration,
    withinTolerance: best.err <= TOLERANCE,
  };
}
