"use client";

import { useMemo, useRef, useState } from "react";
import { haversineMeters } from "@/lib/geo";

// Draws a small, interactive elevation profile from BRouter geometry
// ([lon, lat, ele]). Hovering shows the height/distance/gradient at that point
// and reports the map coordinate to the parent so it can mark it on the map.

const W = 300;
const H = 96;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

type Props = {
  coords: number[][];
  ascentMeters?: number | null;
  onHover?: (coord: number[] | null) => void;
};

export default function ElevationChart({ coords, ascentMeters, onHover }: Props) {
  const chart = useMemo(() => build(coords, ascentMeters), [coords, ascentMeters]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ xPct: number; label: string } | null>(null);

  if (!chart) return null;
  const { area, line, minE, maxE, ascent, descent, distanceKm, cum, totalD } = chart;

  const yFor = (e: number) =>
    PAD_TOP + (1 - (e - minE) / (maxE - minE || 1)) * (H - PAD_TOP - PAD_BOTTOM);

  function handleMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const target = frac * totalD;

    // nearest geometry point by cumulative distance
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    const ele = coords[idx][2] ?? 0;
    const grad = gradientAt(coords, cum, idx);
    setHover({
      xPct: (cum[idx] / totalD) * 100,
      label: `${(cum[idx] / 1000).toFixed(1).replace(".", ",")} km · ${Math.round(ele)} m · ${grad >= 0 ? "" : "-"}${Math.abs(grad).toFixed(0)}%`,
    });
    onHover?.(coords[idx]);
  }

  function handleLeave() {
    setHover(null);
    onHover?.(null);
  }

  return (
    <div className="elevation">
      {hover && (
        <div className="tip" style={{ left: `${hover.xPct}%` }}>
          {hover.label}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={handleLeave}
      >
        <path d={area} fill="#2563eb" fillOpacity="0.14" />
        <path
          d={line}
          fill="none"
          stroke="#2563eb"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        {hover && (
          <line
            x1={(hover.xPct / 100) * W}
            x2={(hover.xPct / 100) * W}
            y1={0}
            y2={H}
            stroke="#111827"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <p className="hint">
        ↑ {ascent} m · ↓ {descent} m · {Math.round(minE)}–{Math.round(maxE)} m ·{" "}
        {distanceKm.toFixed(1)} km
      </p>
    </div>
  );
}

function gradientAt(coords: number[][], cum: number[], idx: number): number {
  const window = 60;
  let j = idx;
  while (j < coords.length - 1 && cum[j] - cum[idx] < window) j++;
  const dist = cum[j] - cum[idx];
  if (dist < 20) {
    // near the end: look backwards instead
    let k = idx;
    while (k > 0 && cum[idx] - cum[k] < window) k--;
    const d2 = cum[idx] - cum[k];
    if (d2 < 20) return 0;
    return (((coords[idx][2] ?? 0) - (coords[k][2] ?? 0)) / d2) * 100;
  }
  return (((coords[j][2] ?? 0) - (coords[idx][2] ?? 0)) / dist) * 100;
}

function build(coords: number[][], ascentMeters?: number | null) {
  if (!coords || coords.length < 2) return null;

  const cum: number[] = [0];
  let cumDist = 0;
  let rawAscent = 0;
  let rawDescent = 0;
  let lastE = coords[0][2] ?? 0;
  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      cumDist += haversineMeters(
        { lon: coords[i - 1][0], lat: coords[i - 1][1] },
        { lon: coords[i][0], lat: coords[i][1] },
      );
      cum.push(cumDist);
    }
    const e = coords[i][2] ?? lastE;
    if (i > 0) {
      const de = e - lastE;
      if (de > 0) rawAscent += de;
      else rawDescent -= de;
    }
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    lastE = e;
  }

  const totalD = cumDist || 1;
  const span = maxE - minE || 1;
  const net = (coords[coords.length - 1][2] ?? 0) - (coords[0][2] ?? 0);
  let ascent: number;
  let descent: number;
  if (ascentMeters != null && Number.isFinite(ascentMeters)) {
    ascent = ascentMeters;
    descent = Math.max(0, ascentMeters - net);
  } else {
    ascent = rawAscent;
    descent = rawDescent;
  }

  const x = (d: number) => (d / totalD) * W;
  const y = (e: number) => PAD_TOP + (1 - (e - minE) / span) * (H - PAD_TOP - PAD_BOTTOM);

  // Downsample for the path only.
  const step = Math.max(1, Math.floor(coords.length / W));
  const idxs: number[] = [];
  for (let i = 0; i < coords.length; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== coords.length - 1) idxs.push(coords.length - 1);

  const line = idxs
    .map((i, k) => `${k === 0 ? "M" : "L"}${x(cum[i]).toFixed(1)},${y(coords[i][2] ?? 0).toFixed(1)}`)
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
    cum,
    totalD,
  };
}
