// Ride statistics derived from the route geometry (client-safe, pure).

export type RouteStats = {
  descentMeters: number;
  /** Steepest climb as a percentage, smoothed over ~60 m to ignore noise. */
  maxGradientPct: number;
};

const GRADIENT_WINDOW_M = 60;

export function computeStats(
  coords: number[][],
  ascentMeters: number | null,
): RouteStats {
  if (!coords || coords.length < 2) return { descentMeters: 0, maxGradientPct: 0 };

  const cum = cumulative(coords);

  // Descent: keep it consistent with the elevation chart by using BRouter's
  // (filtered) ascent and the exact net-height identity when we can.
  const startE = coords[0][2] ?? 0;
  const endE = coords[coords.length - 1][2] ?? startE;
  const net = endE - startE;
  let descent: number;
  if (ascentMeters != null && Number.isFinite(ascentMeters)) {
    descent = Math.max(0, ascentMeters - net);
  } else {
    descent = 0;
    for (let i = 1; i < coords.length; i++) {
      const de = (coords[i][2] ?? 0) - (coords[i - 1][2] ?? 0);
      if (de < 0) descent -= de;
    }
  }

  // Steepest climb over a rolling ~60 m window.
  let maxG = 0;
  let j = 0;
  for (let i = 0; i < coords.length; i++) {
    if (j < i) j = i;
    while (j < coords.length - 1 && cum[j] - cum[i] < GRADIENT_WINDOW_M) j++;
    const dist = cum[j] - cum[i];
    if (dist >= 20) {
      const g = (((coords[j][2] ?? 0) - (coords[i][2] ?? 0)) / dist) * 100;
      if (g > maxG) maxG = g;
    }
  }

  return {
    descentMeters: Math.round(descent),
    maxGradientPct: Math.round(maxG * 10) / 10,
  };
}

/** Format minutes as "1u 42" or "45 min". */
export function formatDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}u ${String(m).padStart(2, "0")}` : `${m} min`;
}

function cumulative(coords: number[][]): number[] {
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
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
