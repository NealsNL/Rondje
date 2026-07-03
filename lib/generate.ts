// Round-trip generation: given a start, a compass direction and a target
// distance, build a loop of waypoints and iterate on its size until the real
// (road-snapped) ride distance is close to the target.

import "server-only";
import { fetchRoute, BrouterError, type RouteResult } from "./brouter";
import { destinationPoint, nearestVertexIndex } from "./geo";
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

// --- out-and-back spur removal ---------------------------------------------
// A generated via can snap onto a dead-end road, making BRouter ride out to it
// and straight back (a U-turn on the same street). We detect vias where the
// route sharply reverses and drop them, so the loop stays clean.

const toRad = (d: number) => (d * Math.PI) / 180;

function hav(a: number[], b: number[]): number {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cumulativeMeters(coords: number[][]): number[] {
  const out = [0];
  let cum = 0;
  for (let i = 1; i < coords.length; i++) {
    cum += hav(coords[i - 1], coords[i]);
    out.push(cum);
  }
  return out;
}

// Find out-and-back excursions: stretches [i..j] that return within ~20 m of
// where they started but are 150 m..8 km long along the path. The 8 km cap
// keeps a real loop's self-approach (which is far along the path) from counting.
function findExcursions(coords: number[][], cum: number[]): [number, number][] {
  const cell = 0.0003; // ~33 m grid
  const grid = new Map<string, number[]>();
  for (let idx = 0; idx < coords.length; idx++) {
    const key = `${Math.round(coords[idx][0] / cell)},${Math.round(coords[idx][1] / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(idx);
  }
  const used = new Set<number>();
  const out: [number, number][] = [];
  for (let idx = 0; idx < coords.length; idx++) {
    if (used.has(idx)) continue;
    let best = -1;
    const cx = Math.round(coords[idx][0] / cell);
    const cy = Math.round(coords[idx][1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const along = cum[j] - cum[idx];
          if (j > idx && along > 150 && along < 8000 && hav(coords[idx], coords[j]) < 20) {
            if (j > best) best = j;
          }
        }
      }
    }
    if (best > idx) {
      out.push([idx, best]);
      for (let t = idx; t <= best; t++) used.add(t);
    }
  }
  return out;
}

/** Drop the via nearest each out-and-back excursion so the loop stays clean. */
function removeSpurVias(openLoop: LonLat[], coords: number[][]): LonLat[] {
  if (coords.length < 4 || openLoop.length <= 3) return openLoop;
  const cum = cumulativeMeters(coords);
  const excursions = findExcursions(coords, cum);
  if (excursions.length === 0) return openLoop;

  const viaIndex = openLoop.slice(1).map((v) => nearestVertexIndex(coords, v));
  const bad = new Set<number>();
  for (const [i, j] of excursions) {
    // tip = farthest point from the entry, i.e. the turnaround
    let tip = i;
    let far = 0;
    for (let t = i; t <= j; t++) {
      const d = hav(coords[i], coords[t]);
      if (d > far) {
        far = d;
        tip = t;
      }
    }
    let bestK = -1;
    let bestD = Infinity;
    for (let k = 0; k < viaIndex.length; k++) {
      const d = Math.abs(viaIndex[k] - tip);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestK >= 0) bad.add(bestK + 1); // +1 -> index into openLoop
  }

  const kept = openLoop.filter((_, i) => i === 0 || !bad.has(i));
  return kept.length >= 3 ? kept : openLoop; // always keep start + 2 vias
}

type Attempt = { open: LonLat[]; result: RouteResult; err: number; spur: number };

/** Total length of out-and-back excursions still present in a route. */
function spurMeters(coords: number[][]): number {
  const cum = cumulativeMeters(coords);
  return findExcursions(coords, cum).reduce((a, [i, j]) => a + (cum[j] - cum[i]), 0);
}

/** One full generation attempt for a given bearing (tune radius, drop spurs). */
async function attempt(
  start: LonLat,
  bearing: number,
  targetKm: number,
  profile: Profile,
): Promise<Attempt | null> {
  let radius = 0.15 * targetKm * 1000;
  let best: Attempt | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let open = buildLoop(start, bearing, radius);
    let result: RouteResult;
    try {
      result = await fetchRoute([...open, start], profile); // close to measure
    } catch (err) {
      if (err instanceof BrouterError) {
        radius *= 0.8;
        continue;
      }
      throw err;
    }

    // Drop vias that cause an out-and-back and re-route (a couple of rounds).
    for (let round = 0; round < 2; round++) {
      const cleaned = removeSpurVias(open, result.coordinates);
      if (cleaned.length === open.length) break;
      try {
        result = await fetchRoute([...cleaned, start], profile);
        open = cleaned;
      } catch (err) {
        if (err instanceof BrouterError) break;
        throw err;
      }
    }

    const actual = result.distanceKm || 0.0001;
    const err = Math.abs(actual - targetKm) / targetKm;
    const spur = spurMeters(result.coordinates);
    if (!best || err < best.err) best = { open, result, err, spur };
    if (err <= TOLERANCE && spur < 200) break;

    const factor = Math.max(0.5, Math.min(2, targetKm / actual));
    radius *= factor;
  }
  return best;
}

export async function generateLoop(opts: {
  start: LonLat;
  direction: Direction;
  targetKm: number;
  profile: Profile;
}): Promise<GenerateResult> {
  const { start, direction, targetKm, profile } = opts;
  const bearing = BEARINGS[direction];

  let best = await attempt(start, bearing, targetKm, profile);

  // If the requested direction still doubles back (e.g. wedged against water),
  // try nearby directions and keep the cleanest loop.
  if (best && best.spur > 300) {
    for (const off of [30, -30, 60, -60]) {
      const alt = await attempt(start, (bearing + off + 360) % 360, targetKm, profile);
      if (alt && alt.spur < best.spur - 100) best = alt;
      if (best.spur < 200) break;
    }
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
    iterations: MAX_ITERATIONS,
    withinTolerance: best.err <= TOLERANCE,
  };
}
