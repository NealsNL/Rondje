"use client";

import { useMemo } from "react";
import { haversineMeters } from "@/lib/geo";

// Draws a small elevation profile from BRouter geometry ([lon, lat, ele]).
// Pure SVG, no chart library. X = distance along the route, Y = elevation.

const W = 300;
const H = 96;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

export default function ElevationChart({
  coords,
  ascentMeters,
}: {
  coords: number[][];
  ascentMeters?: number | null;
}) {
  const chart = useMemo(() => build(coords, ascentMeters), [coords, ascentMeters]);
  if (!chart) return null;

  const { area, line, minE, maxE, ascent, descent, distanceKm } = chart;
  return (
    <div className="elevation">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <path d={area} fill="#2563eb" fillOpacity="0.14" />
        <path
          d={line}
          fill="none"
          stroke="#2563eb"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="hint">
        ↑ {ascent} m · ↓ {descent} m · {Math.round(minE)}–{Math.round(maxE)} m ·{" "}
        {distanceKm.toFixed(1)} km
      </p>
    </div>
  );
}

function build(coords: number[][], ascentMeters?: number | null) {
  if (!coords || coords.length < 2) return null;

  // Cumulative distance + elevation at full resolution.
  const pts: { d: number; e: number }[] = [];
  let cum = 0;
  let lastE = coords[0][2] ?? 0;
  let rawAscent = 0;
  let rawDescent = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      cum += haversineMeters(
        { lon: coords[i - 1][0], lat: coords[i - 1][1] },
        { lon: coords[i][0], lat: coords[i][1] },
      );
    }
    const e = coords[i][2] ?? lastE;
    if (i > 0) {
      const de = e - lastE;
      if (de > 0) rawAscent += de;
      else rawDescent -= de;
    }
    pts.push({ d: cum, e });
    lastE = e;
  }

  // Prefer BRouter's filtered ascent (noise-removed) so the number matches the
  // one shown next to the distance. Descent follows from the net-height
  // identity: net = endEle - startEle = ascent - descent.
  const net = pts[pts.length - 1].e - pts[0].e;
  let ascent: number;
  let descent: number;
  if (ascentMeters != null && Number.isFinite(ascentMeters)) {
    ascent = ascentMeters;
    descent = Math.max(0, ascentMeters - net);
  } else {
    ascent = rawAscent;
    descent = rawDescent;
  }

  const totalD = cum || 1;
  let minE = Infinity;
  let maxE = -Infinity;
  for (const p of pts) {
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
  }
  const span = maxE - minE || 1;

  // Downsample to keep the SVG light.
  const step = Math.max(1, Math.floor(pts.length / W));
  const sampled = pts.filter((_, i) => i % step === 0);
  if (sampled[sampled.length - 1] !== pts[pts.length - 1]) {
    sampled.push(pts[pts.length - 1]);
  }

  const x = (d: number) => (d / totalD) * W;
  const y = (e: number) =>
    PAD_TOP + (1 - (e - minE) / span) * (H - PAD_TOP - PAD_BOTTOM);

  const line = sampled
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  return {
    area,
    line,
    minE,
    maxE,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    distanceKm: totalD / 1000,
  };
}
