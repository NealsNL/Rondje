// Turns BRouter's per-segment "messages" (which carry the OSM way tags) into
// something a road cyclist actually wants: how much of the route is paved, and
// exactly where it is not. Fully offline — BRouter already knows the surface.

export type SurfaceClass = "paved" | "semi" | "unpaved";

export type SurfaceBreakdown = {
  paved: number; // metres
  semi: number;
  unpaved: number;
};

export type ColoredSegment = { surface: SurfaceClass; coordinates: number[][] };

export type SurfaceInfo = {
  breakdown: SurfaceBreakdown;
  segments: ColoredSegment[];
};

// Smooth, road-bike friendly surfaces.
const PAVED = new Set([
  "asphalt",
  "concrete",
  "concrete:plates",
  "concrete:lanes",
  "paved",
  "paving_stones",
  "sett",
  "chipseal",
  "metal",
  "wood",
]);
// Firm but not asphalt: rideable, but you feel it.
const SEMI = new Set(["compacted", "fine_gravel", "gravel"]);
// Everything else with a surface tag (dirt, ground, sand, grass, mud,
// pebblestone, cobblestone, unpaved, ...) counts as rough/unpaved.

function classify(surface: string | undefined, highway: string | undefined): SurfaceClass {
  if (surface) {
    if (PAVED.has(surface)) return "paved";
    if (SEMI.has(surface)) return "semi";
    return "unpaved";
  }
  // No surface tag: infer from the road type. In NL/BE tracks and paths are
  // usually unpaved, while roads and cycleways are usually paved.
  if (highway && /^(track|path|bridleway)$/.test(highway)) return "unpaved";
  return "paved";
}

function tag(wayTags: string, key: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`).exec(wayTags);
  return m?.[1];
}

/**
 * Build the surface breakdown and a colour-coded version of the route.
 * `coordinates` is the full geometry ([lon,lat,ele]); `messages` is the raw
 * BRouter messages table (first row is the header).
 */
export function buildSurfaceInfo(
  coordinates: number[][],
  messages: string[][] | undefined,
): SurfaceInfo | null {
  if (!messages || messages.length < 2 || coordinates.length < 2) return null;
  const header = messages[0];
  const iWt = header.indexOf("WayTags");
  const iDist = header.indexOf("Distance");
  if (iWt < 0 || iDist < 0) return null;

  // Per-segment class + cumulative distance at the end of each segment.
  const classes: SurfaceClass[] = [];
  const cumEnd: number[] = [];
  const breakdown: SurfaceBreakdown = { paved: 0, semi: 0, unpaved: 0 };
  let cum = 0;
  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const cls = classify(tag(row[iWt] || "", "surface"), tag(row[iWt] || "", "highway"));
    const dist = Number(row[iDist]) || 0;
    cum += dist;
    classes.push(cls);
    cumEnd.push(cum);
    breakdown[cls] += dist;
  }
  const total = cum || 1;

  // Cumulative distance along the geometry, rescaled to match `total` so it
  // lines up with the message boundaries.
  const geomCum = geometryCumulative(coordinates);
  const geomTotal = geomCum[geomCum.length - 1] || 1;
  const scale = total / geomTotal;

  // Assign each geometry point the class of the segment it falls in, then group
  // consecutive points of the same class into colour runs.
  const segments: ColoredSegment[] = [];
  let seg = 0;
  const classAt = (pointIndex: number): SurfaceClass => {
    const pos = geomCum[pointIndex] * scale;
    while (seg < cumEnd.length - 1 && pos > cumEnd[seg]) seg++;
    return classes[seg];
  };

  let runClass = classAt(0);
  let runCoords: number[][] = [coordinates[0]];
  for (let i = 1; i < coordinates.length; i++) {
    const c = classAt(i);
    runCoords.push(coordinates[i]);
    if (c !== runClass && i < coordinates.length - 1) {
      segments.push({ surface: runClass, coordinates: runCoords });
      runCoords = [coordinates[i]]; // share the transition vertex (no gap)
      runClass = c;
    }
  }
  segments.push({ surface: runClass, coordinates: runCoords });

  return { breakdown, segments };
}

function geometryCumulative(coords: number[][]): number[] {
  const out = [0];
  let cum = 0;
  for (let i = 1; i < coords.length; i++) {
    cum += haversine(coords[i - 1], coords[i]);
    out.push(cum);
  }
  return out;
}

function haversine(a: number[], b: number[]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
