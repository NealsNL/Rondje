// Coordinate helpers.
//
// One convention across the whole app: a point is { lon, lat }.
// The tricky part is that different systems order coordinates differently:
//   - BRouter "lonlats" query : lon,lat   (longitude first)
//   - GeoJSON coordinates      : [lon, lat]
//   - MapLibre LngLat          : [lon, lat] / { lng, lat }
//   - GPX <trkpt>              : lat="" lon=""  (latitude first)  <-- handled by BRouter
// Because BRouter produces the GPX for us, the only order we build by hand is
// lon,lat (BRouter query + GeoJSON), so we keep everything as { lon, lat }.

export type LonLat = { lon: number; lat: number };

/** Build the BRouter "lonlats" parameter: "lon,lat|lon,lat|...". */
export function toLonLatsParam(points: LonLat[]): string {
  return points.map((p) => `${round6(p.lon)},${round6(p.lat)}`).join("|");
}

/** GeoJSON coordinate [lon, lat, ele?] -> { lon, lat }. */
export function fromGeoJsonCoord(c: number[]): LonLat {
  return { lon: c[0], lat: c[1] };
}

/** { lon, lat } -> MapLibre LngLat array [lng, lat]. */
export function toLngLat(p: LonLat): [number, number] {
  return [p.lon, p.lat];
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
