// BRouter already returns valid GPX 1.1 with <trk>/<trkseg>/<trkpt lat lon>/<ele>.
// We only replace the track <name> so the course shows a friendly name in
// Garmin Connect.

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

/** Replace the first <name>…</name> (BRouter puts it inside <trk>). */
export function setGpxTrackName(gpx: string, name: string): string {
  const safe = escapeXml(name.trim() || "Route");
  if (/<name>[\s\S]*?<\/name>/.test(gpx)) {
    return gpx.replace(/<name>[\s\S]*?<\/name>/, `<name>${safe}</name>`);
  }
  return gpx.replace(/<trk>/, `<trk>\n  <name>${safe}</name>`);
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
