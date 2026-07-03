// BRouter already returns valid GPX 1.1 with <trk>/<trkseg>/<trkpt lat lon>/<ele>.
// We only replace the track <name> so the course shows a friendly name in
// Garmin Connect. This module also parses an imported GPX back into waypoints.

import { haversineMeters } from "./geo";
import type { LonLat } from "./coords";

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

/**
 * Build a GPX 1.1 track from route coordinates ([lon, lat, ele?]). We build it
 * ourselves (instead of taking BRouter's GPX) so the export matches the exact
 * geometry we cleaned and show on the map.
 */
export function buildGpxFromCoords(coords: number[][], name: string): string {
  const safe = escapeXml(name.trim() || "Route");
  const pts = coords
    .map((c) => {
      const ele = c.length > 2 && Number.isFinite(c[2]) ? `<ele>${c[2].toFixed(1)}</ele>` : "";
      return `<trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${ele}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Rondje" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${safe}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

/** Replace the first <name>…</name> (BRouter puts it inside <trk>). */
export function setGpxTrackName(gpx: string, name: string): string {
  const safe = escapeXml(name.trim() || "Route");
  if (/<name>[\s\S]*?<\/name>/.test(gpx)) {
    return gpx.replace(/<name>[\s\S]*?<\/name>/, `<name>${safe}</name>`);
  }
  return gpx.replace(/<trk>/, `<trk>\n  <name>${safe}</name>`);
}

/**
 * Read all track/route points from a GPX document. Attribute order (lat/lon)
 * varies between exporters, so we read each attribute independently. Regex is
 * used so this works both in the browser and on the server.
 */
export function parseGpxTrack(xml: string): LonLat[] {
  const points: LonLat[] = [];
  const re = /<(?:trkpt|rtept|wpt)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const lat = /\blat\s*=\s*"([-\d.]+)"/.exec(m[1])?.[1];
    const lon = /\blon\s*=\s*"([-\d.]+)"/.exec(m[1])?.[1];
    if (lat != null && lon != null) {
      const la = Number(lat);
      const lo = Number(lon);
      if (Number.isFinite(la) && Number.isFinite(lo)) points.push({ lon: lo, lat: la });
    }
  }
  return points;
}

/**
 * Reduce a dense track to a handful of evenly-spaced, draggable waypoints so
 * BRouter can re-route through them and the route becomes editable. Keeps the
 * first and last point (so a loop stays a loop).
 */
export function sampleTrackToWaypoints(track: LonLat[], maxPoints = 24): LonLat[] {
  if (track.length <= maxPoints) return track.slice();

  let total = 0;
  for (let i = 1; i < track.length; i++) total += haversineMeters(track[i - 1], track[i]);
  const spacing = total / (maxPoints - 1);

  const out: LonLat[] = [track[0]];
  let acc = 0;
  for (let i = 1; i < track.length - 1; i++) {
    acc += haversineMeters(track[i - 1], track[i]);
    if (acc >= spacing) {
      out.push(track[i]);
      acc = 0;
    }
  }
  out.push(track[track.length - 1]);
  return out;
}

/** Turn a route name into a safe file name (without extension). */
export function toGpxFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/^-+|-+$/g, "");
  return cleaned || "route";
}
