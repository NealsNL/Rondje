// Final safety net: cut out-and-back overlaps straight out of the finished route
// geometry, regardless of what caused them. Also trims BRouter's per-segment
// messages over the same stretch so the surface/distance data stays in sync.

import { buildSurfaceInfo } from "./surface";
import type { RouteResult } from "./brouter";

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

function hav(a: number[], b: number[]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cumulative(coords: number[][]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + hav(coords[i - 1], coords[i]));
  return out;
}

// Disjoint [i, j] stretches where the path leaves a point and returns within
// ~18 m of it, having travelled between MIN and a capped distance in between.
// The cap keeps a real loop's far self-approach from counting as a spur.
// Geometry cutting targets SHORT over-elkaar bits only (a road run over twice).
// Big structural out-and-backs are the waypoint step's job, and forced ones
// (e.g. the only road past a barrier) must be left alone.
const RETURN_M = 18;
const MIN_M = 40;
const MAX_ABS_M = 800;
const MAX_FRAC = 0.2; // a single cut never removes more than a fifth of the ride
const MAX_TOTAL_FRAC = 0.3; // and all cuts together never remove more than a third

function findOverlaps(coords: number[][], cum: number[]): [number, number][] {
  const total = cum[cum.length - 1];
  const maxAlong = Math.min(MAX_ABS_M, MAX_FRAC * total);
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
          if (j > idx && along > MIN_M && along < maxAlong && hav(coords[idx], coords[j]) < RETURN_M) {
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

function trimMessagesByDistance(
  messages: string[][] | undefined,
  windows: [number, number][],
): string[][] | undefined {
  if (!messages || messages.length < 2) return messages;
  const iDist = messages[0].indexOf("Distance");
  if (iDist < 0) return messages;
  const inWindow = (d: number) => windows.some(([a, b]) => d > a && d <= b);
  const out: string[][] = [messages[0]];
  let cum = 0;
  for (let r = 1; r < messages.length; r++) {
    const dist = Number(messages[r][iDist]) || 0;
    const mid = cum + dist / 2;
    cum += dist;
    if (!inWindow(mid)) out.push(messages[r]);
  }
  return out;
}

/**
 * Find self-overlaps in the geometry and cut them out. Returns the trimmed
 * coordinates + messages and the removed index ranges (in the original
 * coordinates, so the caller can drop waypoints that sat inside a cut stretch),
 * or null when the route is already clean.
 */
export function trimOverlaps(
  coords: number[][],
  messages: string[][] | undefined,
): { coords: number[][]; messages: string[][] | undefined; removed: [number, number][] } | null {
  if (coords.length < 4) return null;
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  const ranges = findOverlaps(coords, cum);
  if (ranges.length === 0) return null;

  // Trim shortest-first, and stop before the cuts together remove too much of
  // the ride (which would mean the "spurs" are actually the route).
  ranges.sort((a, b) => cum[a[1]] - cum[a[0]] - (cum[b[1]] - cum[b[0]]));
  const accepted: [number, number][] = [];
  let removedTotal = 0;
  for (const [i, j] of ranges) {
    const len = cum[j] - cum[i];
    if (removedTotal + len > MAX_TOTAL_FRAC * total) break;
    accepted.push([i, j]);
    removedTotal += len;
  }
  if (accepted.length === 0) return null;

  const drop = new Array<boolean>(coords.length).fill(false);
  const windows: [number, number][] = [];
  for (const [i, j] of accepted) {
    for (let t = i + 1; t <= j; t++) drop[t] = true; // keep coords[i], drop through j
    windows.push([cum[i], cum[j]]);
  }
  const newCoords = coords.filter((_, k) => !drop[k]);
  if (newCoords.length < 2) return null;
  return { coords: newCoords, messages: trimMessagesByDistance(messages, windows), removed: accepted };
}

/** Rebuild a RouteResult from trimmed geometry so its stats stay consistent. */
export function rebuildTrimmedResult(
  old: RouteResult,
  coords: number[][],
  messages: string[][] | undefined,
): RouteResult {
  const cum = cumulative(coords);
  const meters = cum[cum.length - 1];
  let ascend = 0;
  for (let i = 1; i < coords.length; i++) {
    const dz = (coords[i][2] ?? 0) - (coords[i - 1][2] ?? 0);
    if (dz > 0) ascend += dz;
  }
  const hasEle = coords.some((c) => c.length > 2);
  const oldMeters = old.distanceKm * 1000 || meters;
  return {
    coordinates: coords,
    distanceKm: meters / 1000,
    ascendMeters: hasEle ? ascend : old.ascendMeters,
    totalTimeSeconds:
      old.totalTimeSeconds != null ? old.totalTimeSeconds * (meters / oldMeters) : null,
    surface: buildSurfaceInfo(coords, messages),
    messages,
  };
}
