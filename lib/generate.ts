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

/** The route vertex at a given cumulative distance (null if out of range). */
function vertexAtCum(coords: number[][], cum: number[], target: number): number[] | null {
  const total = cum[cum.length - 1];
  if (target < 0 || target > total) return null;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return coords[lo];
}

/**
 * Waypoints that make the route detour instead of ride through, among the ones
 * `isCandidate` allows to be dropped. Two kinds are detected:
 *  - out-and-back excursions (the route leaves the path and returns to it);
 *  - turnarounds (the route reaches the waypoint and comes straight back, so the
 *    path a little before and after it is almost the same place). The second
 *    catches short dead-end spurs the excursion test is too coarse for.
 */
function detourWaypoints(
  points: LonLat[],
  coords: number[][],
  isCandidate: (k: number) => boolean,
): Set<number> {
  const bad = new Set<number>();
  if (coords.length < 4 || points.length < 3) return bad;
  const cum = cumulativeMeters(coords);
  const idxOf = points.map((p) => nearestVertexIndex(coords, p));

  // (1) out-and-back excursions: drop the candidate waypoint nearest each tip.
  for (const [i, j] of findExcursions(coords, cum)) {
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
    for (let k = 0; k < points.length; k++) {
      if (!isCandidate(k)) continue;
      const d = Math.abs(idxOf[k] - tip);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestK >= 0) bad.add(bestK);
  }

  // (2) turnaround at the waypoint: come in and leave along nearly the same
  // path. ~45 m before/after ending up within ~25 m means a fold.
  for (let k = 0; k < points.length; k++) {
    if (!isCandidate(k)) continue;
    const idx = idxOf[k];
    const before = vertexAtCum(coords, cum, cum[idx] - 45);
    const after = vertexAtCum(coords, cum, cum[idx] + 45);
    if (before && after && hav(before, after) < 25) bad.add(k);
  }

  return bad;
}

/** Drop every via that makes a generated loop detour (always keeps the start). */
function removeBadVias(openLoop: LonLat[], coords: number[][]): LonLat[] {
  if (openLoop.length <= 3) return openLoop;
  const bad = detourWaypoints(openLoop, coords, (k) => k >= 1);
  if (bad.size === 0) return openLoop;
  const kept = openLoop.filter((_, i) => !bad.has(i));
  return kept.length >= 3 ? kept : openLoop; // always keep start + 2 vias
}

/**
 * Route through `points`, then drop any intermediate waypoint that makes the
 * route poke out and back (a dead-end spur) and re-route — repeated until the
 * route is clean or a few rounds pass. The endpoints are never dropped. Returns
 * the surviving waypoints, the indices of the input that survived, and the final
 * route. Every route the app draws or exports goes through here, so a spur can
 * never reach the final route.
 */
export async function routeWithoutDetours(
  points: LonLat[],
  profile: Profile,
  quietness = 0,
): Promise<{ points: LonLat[]; keptIndices: number[]; result: RouteResult }> {
  let pts = points;
  let idx = points.map((_, i) => i);
  let result = await fetchRoute(pts, profile, quietness);
  const originalKm = result.distanceKm;

  for (let round = 0; round < 3; round++) {
    const bad = detourWaypoints(pts, result.coordinates, (k) => k > 0 && k < pts.length - 1);
    if (bad.size === 0) break;
    const nextPts = pts.filter((_, k) => !bad.has(k));
    if (nextPts.length < 2 || nextPts.length === pts.length) break;
    const nextResult = await fetchRoute(nextPts, profile, quietness);
    // Removing a spur should only shave a bit off. If cleaning would slash the
    // route (below half the original), the "spur" is really most of the ride —
    // e.g. a deliberate there-and-back — so stop and keep what we have.
    if (nextResult.distanceKm < 0.5 * originalKm) break;
    const nextIdx = idx.filter((_, k) => !bad.has(k));
    result = nextResult;
    pts = nextPts;
    idx = nextIdx;
  }

  return { points: pts, keptIndices: idx, result };
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
  quietness: number,
  maxIter = MAX_ITERATIONS,
): Promise<Attempt | null> {
  let radius = 0.15 * targetKm * 1000;
  let best: Attempt | null = null;
  let stale = 0; // consecutive iterations that didn't meaningfully improve

  for (let i = 0; i < maxIter; i++) {
    let open = buildLoop(start, bearing, radius);
    let result: RouteResult;
    try {
      result = await fetchRoute([...open, start], profile, quietness); // close to measure
    } catch (err) {
      if (err instanceof BrouterError) {
        radius *= 0.8;
        continue;
      }
      throw err;
    }

    // Drop vias that cause a detour/turnaround and re-route. Two rounds catches
    // a spur that only appears after the first cleanup shifts a via; each round
    // is free when there is nothing to clean (no reroute happens).
    for (let round = 0; round < 2; round++) {
      const cleaned = removeBadVias(open, result.coordinates);
      if (cleaned.length === open.length) break;
      try {
        result = await fetchRoute([...cleaned, start], profile, quietness);
        open = cleaned;
      } catch (err) {
        if (!(err instanceof BrouterError)) throw err; // keep uncleaned result
        break;
      }
    }

    const actual = result.distanceKm || 0.0001;
    const err = Math.abs(actual - targetKm) / targetKm;
    const spur = spurMeters(result.coordinates);
    const improved = !best || err < best.err - 0.005;
    if (!best || err < best.err) best = { open, result, err, spur };
    // Stop as soon as the distance is right; small out-and-backs are acceptable.
    if (err <= TOLERANCE && spur < 400) break;
    // Long loops sometimes oscillate around the target without ever landing in
    // tolerance. Once we stop improving, keep the best so far instead of burning
    // more (slow) routing calls — this is what made long rides feel sluggish.
    stale = improved ? 0 : stale + 1;
    if (stale >= 2) break;

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
  quietness?: number;
}): Promise<GenerateResult> {
  const { start, direction, targetKm, profile, quietness = 0 } = opts;
  const bearing = BEARINGS[direction];

  let best = await attempt(start, bearing, targetKm, profile, quietness);

  // If the requested direction still doubles back badly (e.g. wedged against
  // water), try a couple of nearby directions and keep the cleanest loop. This
  // is what rescues hard/long loops, so we always run it when needed. Sequential
  // on purpose: BRouter is CPU-bound, so running these at once only slows both.
  if (best && best.spur > 500) {
    for (const off of [35, -35]) {
      const alt = await attempt(start, (bearing + off + 360) % 360, targetKm, profile, quietness, 4);
      if (alt && alt.spur < best.spur - 100) best = alt;
      if (best.spur < 300) break;
    }
  }

  if (!best) {
    throw new BrouterError(
      "Kon geen rondrit genereren vanaf dit punt. Probeer een ander startpunt, richting of afstand.",
    );
  }

  // Generated vias sit on a geometric circle, which can land in a field far from
  // the road BRouter actually snapped the route to — leaving a marker floating
  // off-route. Move every waypoint onto the nearest point of the real route so
  // each marker sits on a road you ride along.
  const coords = best.result.coordinates;
  const waypoints = best.open.map((wp) => {
    const c = coords[nearestVertexIndex(coords, wp)];
    return { lon: c[0], lat: c[1] };
  });

  return {
    // Open loop; the app closes it back to the start in "rondje" mode.
    waypoints,
    distanceKm: best.result.distanceKm,
    ascendMeters: best.result.ascendMeters,
    coordinates: best.result.coordinates,
    iterations: MAX_ITERATIONS,
    withinTolerance: best.err <= TOLERANCE,
  };
}
