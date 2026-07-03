// Pure geometry helpers (no BRouter, no DOM). Safe on client and server.

import type { LonLat } from "./coords";

const EARTH_RADIUS_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres between two points. */
export function haversineMeters(a: LonLat, b: LonLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Point reached by travelling `distanceMeters` from `origin` along a compass
 * bearing (degrees, 0 = North, 90 = East). Used to seed generated loops.
 */
export function destinationPoint(
  origin: LonLat,
  bearingDeg: number,
  distanceMeters: number,
): LonLat {
  const ang = distanceMeters / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) +
      Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lon: ((toDeg(lon2) + 540) % 360) - 180, lat: toDeg(lat2) };
}

/** Index of the polyline vertex nearest to `point`. */
export function nearestVertexIndex(coordinates: number[][], point: LonLat): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coordinates.length; i++) {
    const dLon = coordinates[i][0] - point.lon;
    const dLat = coordinates[i][1] - point.lat;
    const d = dLon * dLon + dLat * dLat; // squared degrees is enough for argmin
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Where to insert a new waypoint when the user clicks the route line.
 * The route runs waypoint[0] -> waypoint[1] -> ... in order, so we find how far
 * along the polyline the click landed and return the index of the first
 * waypoint that lies further along. The new point is inserted before it.
 */
export function insertIndexForLineClick(
  coordinates: number[][],
  waypoints: LonLat[],
  clicked: LonLat,
): number {
  const clickedVertex = nearestVertexIndex(coordinates, clicked);
  for (let i = 1; i < waypoints.length; i++) {
    const wpVertex = nearestVertexIndex(coordinates, waypoints[i]);
    if (clickedVertex <= wpVertex) return i;
  }
  return Math.max(1, waypoints.length - 1);
}

/** Compass bearing in degrees (0 = North, clockwise) from `a` to `b`. */
export function bearingDegrees(a: LonLat, b: LonLat): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Sample points along a route polyline about every `everyMeters`, each carrying
 * the local travel bearing — used to draw direction arrows on the map so you can
 * see which way the route goes. Input coords are [lon, lat, ...].
 */
export function arrowsAlongRoute(
  coordinates: number[][],
  everyMeters: number,
): { lon: number; lat: number; bearing: number }[] {
  if (coordinates.length < 2 || everyMeters <= 0) return [];
  const out: { lon: number; lat: number; bearing: number }[] = [];
  let acc = 0;
  let next = everyMeters;
  for (let i = 1; i < coordinates.length; i++) {
    const a = { lon: coordinates[i - 1][0], lat: coordinates[i - 1][1] };
    const b = { lon: coordinates[i][0], lat: coordinates[i][1] };
    const seg = haversineMeters(a, b);
    if (seg === 0) continue;
    const bearing = bearingDegrees(a, b);
    while (acc + seg >= next) {
      const t = (next - acc) / seg;
      out.push({
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        bearing,
      });
      next += everyMeters;
    }
    acc += seg;
  }
  return out;
}
