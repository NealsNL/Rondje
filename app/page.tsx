"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LonLat } from "@/lib/coords";
import { insertIndexForLineClick } from "@/lib/geo";
import { toGpxFileName, parseGpxTrack, sampleTrackToWaypoints } from "@/lib/gpx";
import { computeStats, formatDuration } from "@/lib/stats";
import ElevationChart from "@/components/ElevationChart";
import { routeWaypoints, type Profile, type TripType } from "@/lib/config";
import type { Direction } from "@/lib/generate";
import type { ColoredSegment, SurfaceBreakdown } from "@/lib/surface";

// Load the map only in the browser (MapLibre needs window).
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Health = "checking" | "ok" | "down";

type SavedRouteSummary = {
  id: number;
  name: string;
  profile: Profile;
  tripType: TripType;
  distanceKm: number | null;
  direction: Direction | null;
  targetKm: number | null;
  createdAt: string;
};

// Compass layout as a 3x3 grid; "" cells are spacers.
const COMPASS: (Direction | "")[] = ["NW", "N", "NE", "W", "", "E", "SW", "S", "SE"];

export default function Home() {
  const [waypoints, setWaypoints] = useState<LonLat[]>([]);
  const [routeCoords, setRouteCoords] = useState<number[][] | null>(null);
  const [segments, setSegments] = useState<ColoredSegment[] | null>(null);
  const [breakdown, setBreakdown] = useState<SurfaceBreakdown | null>(null);
  const [hoverPoint, setHoverPoint] = useState<number[] | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ascendMeters, setAscendMeters] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile>("paved");
  const [tripType, setTripType] = useState<TripType>("loop");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("checking");

  // Generation inputs
  const [direction, setDirection] = useState<Direction>("N");
  const [targetKm, setTargetKm] = useState(40);
  const [generating, setGenerating] = useState(false);

  // Personal average speed (km/h), remembered between sessions.
  const [avgSpeed, setAvgSpeed] = useState(25);
  useEffect(() => {
    const saved = Number(localStorage.getItem("avgSpeed"));
    if (Number.isFinite(saved) && saved >= 5 && saved <= 60) setAvgSpeed(saved);
  }, []);
  const changeSpeed = useCallback((v: number) => {
    const s = Math.max(5, Math.min(60, v));
    setAvgSpeed(s);
    localStorage.setItem("avgSpeed", String(s));
  }, []);

  // Route name + saving/exporting
  const [routeName, setRouteName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteSummary[]>([]);
  // Generator settings, remembered only when the route was generated.
  const [genMeta, setGenMeta] = useState<{ direction: Direction; targetKm: number } | null>(
    null,
  );

  // Latest waypoints/route, so map callbacks read fresh values.
  const wpRef = useRef(waypoints);
  wpRef.current = waypoints;
  const routeRef = useRef(routeCoords);
  routeRef.current = routeCoords;
  const tripTypeRef = useRef(tripType);
  tripTypeRef.current = tripType;

  // Check the routing server on load.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(d.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  const refreshSaved = useCallback(() => {
    fetch("/api/routes")
      .then((r) => r.json())
      .then((d) => setSavedRoutes(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);
  useEffect(() => refreshSaved(), [refreshSaved]);

  // Re-route whenever the waypoints, trip type or profile change.
  useEffect(() => {
    const rw = routeWaypoints(waypoints, tripType);
    if (rw.length < 2) {
      setRouteCoords(null);
      setSegments(null);
      setBreakdown(null);
      setDistanceKm(null);
      setAscendMeters(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waypoints: rw, profile }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Routeren mislukt.");
        return d;
      })
      .then((d) => {
        setRouteCoords(d.coordinates);
        setDistanceKm(d.distanceKm);
        setAscendMeters(d.ascendMeters);
        if (d.surface) {
          setSegments(d.surface.segments);
          setBreakdown(d.surface.breakdown);
        } else {
          setSegments([{ surface: "paved", coordinates: d.coordinates }]);
          setBreakdown(null);
        }
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setRouteCoords(null);
        setSegments(null);
        setBreakdown(null);
        setDistanceKm(null);
        setAscendMeters(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [waypoints, tripType, profile]);

  // Each click on empty map adds the next point: start, then stops, then end.
  const handleMapClick = useCallback((p: LonLat) => {
    setInfo(null);
    setWaypoints((wps) => [...wps, p]);
  }, []);

  const handleLineClick = useCallback((p: LonLat) => {
    const wps = wpRef.current;
    const coords = routeRef.current;
    if (!coords) return;
    const rw = routeWaypoints(wps, tripTypeRef.current);
    const idx = insertIndexForLineClick(coords, rw, p);
    const next = [...wps];
    next.splice(Math.min(idx, wps.length), 0, p); // keep inside the open list
    setWaypoints(next);
  }, []);

  const handleWaypointMove = useCallback((index: number, p: LonLat) => {
    setWaypoints((wps) => wps.map((w, i) => (i === index ? p : w)));
  }, []);

  const handleWaypointDelete = useCallback((index: number) => {
    setWaypoints((wps) => (wps.length <= 1 ? wps : wps.filter((_, i) => i !== index)));
  }, []);

  const clearRoute = useCallback(() => {
    setWaypoints([]);
    setError(null);
    setInfo(null);
    setGenMeta(null);
  }, []);

  const reverseRoute = useCallback(() => {
    setWaypoints((wps) => (wps.length < 2 ? wps : [...wps].reverse()));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onGpxFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    setError(null);
    setInfo(null);
    try {
      const track = parseGpxTrack(await file.text());
      if (track.length < 2) throw new Error("Geen route gevonden in dit GPX-bestand.");
      setGenMeta(null);
      setRouteName(file.name.replace(/\.gpx$/i, ""));
      setWaypoints(sampleTrackToWaypoints(track, 24));
      setInfo("GPX geïmporteerd. Versleep de punten om bij te sturen.");
    } catch (err) {
      setError((err as Error).message || "Kon dit GPX-bestand niet lezen.");
    }
  }, []);

  const generate = useCallback(async () => {
    const start = wpRef.current[0];
    if (!start) return;
    setGenerating(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start, direction, distanceKm: targetKm, profile }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Genereren mislukt.");
      setTripType("loop");
      setWaypoints(d.waypoints);
      setGenMeta({ direction, targetKm });
      if (!d.withinTolerance) {
        setInfo(
          `Beste rondrit is ${d.distanceKm.toFixed(1)} km (doel ${targetKm} km). Versleep punten om bij te sturen.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [direction, targetKm, profile]);

  const exportGpx = useCallback(async () => {
    const rw = routeWaypoints(wpRef.current, tripTypeRef.current);
    if (rw.length < 2) return;
    setExporting(true);
    setError(null);
    try {
      const r = await fetch("/api/gpx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          waypoints: rw,
          profile,
          name: routeName || "Route",
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error ?? "Export mislukt.");
      }
      const text = await r.text();
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/gpx+xml" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${toGpxFileName(routeName || "route")}.gpx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }, [profile, routeName]);

  const saveRoute = useCallback(async () => {
    if (wpRef.current.length < 2) return;
    const name = routeName.trim();
    if (!name) {
      setError("Geef de route eerst een naam.");
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch("/api/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          profile,
          tripType,
          waypoints: wpRef.current,
          distanceKm,
          direction: genMeta?.direction ?? null,
          targetKm: genMeta?.targetKm ?? null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Opslaan mislukt.");
      setInfo(`Route "${d.name}" opgeslagen.`);
      refreshSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [routeName, profile, tripType, distanceKm, genMeta, refreshSaved]);

  const loadRoute = useCallback(async (id: number) => {
    setError(null);
    setInfo(null);
    try {
      const r = await fetch(`/api/routes/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Laden mislukt.");
      setProfile(d.profile);
      setTripType(d.tripType === "ptp" ? "ptp" : "loop");
      setRouteName(d.name);
      if (d.direction && d.targetKm) {
        setGenMeta({ direction: d.direction, targetKm: d.targetKm });
        setDirection(d.direction);
        setTargetKm(d.targetKm);
      } else {
        setGenMeta(null);
      }
      setWaypoints(d.waypoints);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const deleteSaved = useCallback(
    async (id: number, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await fetch(`/api/routes/${id}`, { method: "DELETE" });
        refreshSaved();
      } catch {
        /* ignore */
      }
    },
    [refreshSaved],
  );

  const stats = useMemo(
    () => (routeCoords ? computeStats(routeCoords, ascendMeters) : null),
    [routeCoords, ascendMeters],
  );
  const rideTime =
    distanceKm != null && avgSpeed > 0
      ? formatDuration((distanceKm / avgSpeed) * 60)
      : "–";

  const hasStart = waypoints.length >= 1;
  const hasRoute = routeWaypoints(waypoints, tripType).length >= 2;

  return (
    <>
      <MapView
        waypoints={waypoints}
        loop={tripType === "loop"}
        segments={segments}
        hoverPoint={hoverPoint}
        onMapClick={handleMapClick}
        onLineClick={handleLineClick}
        onWaypointMove={handleWaypointMove}
        onWaypointDelete={handleWaypointDelete}
      />

      <div className="panel">
        <h1>Routeplanner</h1>
        <p className="subtitle">
          <span
            className={`status-dot ${health === "ok" ? "ok" : health === "down" ? "bad" : "wait"}`}
          />
          {health === "ok"
            ? "Routeserver verbonden"
            : health === "down"
              ? "Routeserver niet bereikbaar"
              : "Routeserver controleren…"}
        </p>

        <div className="section">
          <p className="section-title">Rittype</p>
          <div className="toggle">
            <button
              className={tripType === "loop" ? "active" : ""}
              onClick={() => setTripType("loop")}
            >
              Rondje
            </button>
            <button
              className={tripType === "ptp" ? "active" : ""}
              onClick={() => setTripType("ptp")}
            >
              Van A naar B
            </button>
          </div>
        </div>

        <div className="section">
          <div className="distance">
            <span className="value">
              {distanceKm != null ? distanceKm.toFixed(1) : "0.0"}
            </span>
            <span className="unit">km</span>
            {ascendMeters != null && (
              <span className="climb">↑ {Math.round(ascendMeters)} m</span>
            )}
          </div>
          {breakdown && <SurfaceBar breakdown={breakdown} />}
          {distanceKm != null && stats && (
            <>
              <div className="stats">
                <div className="stat">
                  <span className="k">Tijd</span>
                  <span className="v">{rideTime}</span>
                </div>
                <div className="stat">
                  <span className="k">Daling</span>
                  <span className="v">↓ {stats.descentMeters} m</span>
                </div>
                <div className="stat">
                  <span className="k">Steilste</span>
                  <span className="v">{stats.maxGradientPct.toFixed(1).replace(".", ",")}%</span>
                </div>
              </div>
              <div className="speed-field">
                <span>Bij</span>
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={avgSpeed}
                  onChange={(e) => changeSpeed(Number(e.target.value))}
                />
                <span>km/u gemiddeld</span>
              </div>
            </>
          )}
          {loading && <p className="hint">Route berekenen…</p>}
          {info && <p className="hint">{info}</p>}
          {error && <p className="error">{error}</p>}
        </div>

        {routeCoords && routeCoords.length > 1 && (
          <div className="section">
            <p className="section-title">Hoogteprofiel</p>
            <ElevationChart
              coords={routeCoords}
              ascentMeters={ascendMeters}
              onHover={setHoverPoint}
            />
          </div>
        )}

        <div className="section">
          <p className="section-title">Ondergrond</p>
          <div className="toggle">
            <button
              className={profile === "paved" ? "active" : ""}
              onClick={() => setProfile("paved")}
            >
              Verhard
            </button>
            <button
              className={profile === "unpaved" ? "active" : ""}
              onClick={() => setProfile("unpaved")}
            >
              Onverhard
            </button>
          </div>
        </div>

        {tripType === "loop" && (
        <div className="section">
          <p className="section-title">Rondrit genereren</p>
          <div className="field">
            <label>Richting vanaf het startpunt</label>
            <div className="compass">
              {COMPASS.map((d, i) =>
                d === "" ? (
                  <button key={i} className="spacer" disabled aria-hidden />
                ) : (
                  <button
                    key={i}
                    className={direction === d ? "active" : ""}
                    onClick={() => setDirection(d)}
                  >
                    {d}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="field">
            <label>Afstand: {targetKm} km</label>
            <input
              type="range"
              min={5}
              max={150}
              step={5}
              value={targetKm}
              onChange={(e) => setTargetKm(Number(e.target.value))}
            />
          </div>
          <button
            className="btn primary"
            onClick={generate}
            disabled={!hasStart || generating || health !== "ok"}
          >
            {generating ? <span className="spinner" /> : null}
            {generating ? "Genereren…" : "Genereer rondrit"}
          </button>
          {!hasStart && (
            <p className="hint">Klik eerst een startpunt op de kaart.</p>
          )}
        </div>
        )}

        <div className="section">
          <p className="section-title">Opslaan &amp; exporteren</p>
          <div className="field">
            <label>Naam van de route</label>
            <input
              type="text"
              value={routeName}
              placeholder="Mijn fietsroute"
              onChange={(e) => setRouteName(e.target.value)}
            />
          </div>
          <div className="btn-row">
            <button
              className="btn primary"
              onClick={saveRoute}
              disabled={!hasRoute || saving}
            >
              {saving ? <span className="spinner" /> : null}
              {saving ? "Opslaan…" : "Bewaar route"}
            </button>
            <button className="btn" onClick={exportGpx} disabled={!hasRoute || exporting}>
              {exporting ? <span className="spinner" /> : null}
              {exporting ? "Exporteren…" : "Exporteer GPX"}
            </button>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => fileInputRef.current?.click()}>
              Importeer GPX
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx"
            onChange={onGpxFile}
            style={{ display: "none" }}
          />
        </div>

        {savedRoutes.length > 0 && (
          <div className="section">
            <p className="section-title">Opgeslagen routes</p>
            <ul className="route-list">
              {savedRoutes.map((r) => (
                <li key={r.id}>
                  <span
                    className="name"
                    title="Klik om te laden"
                    onClick={() => loadRoute(r.id)}
                  >
                    {r.name}
                  </span>
                  <span className="meta">
                    {r.distanceKm != null ? `${r.distanceKm.toFixed(1)} km · ` : ""}
                    {r.tripType === "ptp" ? "A→B" : "Rondje"} ·{" "}
                    {r.profile === "paved" ? "Verhard" : "Onverhard"}
                  </span>
                  <button
                    className="icon-btn"
                    title="Verwijderen"
                    onClick={(e) => deleteSaved(r.id, e)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="section">
          <div className="btn-row">
            <button className="btn" onClick={reverseRoute} disabled={!hasRoute}>
              Omdraaien
            </button>
            <button className="btn" onClick={clearRoute} disabled={waypoints.length === 0}>
              Nieuwe route
            </button>
          </div>
          <p className="hint">
            {waypoints.length === 0
              ? tripType === "loop"
                ? "Klik een startpunt op de kaart, of genereer hieronder een rondje."
                : "Klik het startpunt op de kaart."
              : tripType === "ptp" && waypoints.length === 1
                ? "Klik nu het eindpunt. Extra klikken worden tussenstops."
                : tripType === "loop"
                  ? "Klik om tussenstops toe te voegen — de route keert terug naar de start. Sleep punten of klik op de route om bij te sturen."
                  : "Klik om nog een tussenstop toe te voegen (de laatste is het eindpunt). Sleep of klik op de route om bij te sturen."}
          </p>
        </div>
      </div>
    </>
  );
}

function SurfaceBar({ breakdown }: { breakdown: SurfaceBreakdown }) {
  const total = breakdown.paved + breakdown.semi + breakdown.unpaved || 1;
  const pct = (m: number) => (m / total) * 100;
  const p = pct(breakdown.paved);
  const s = pct(breakdown.semi);
  const u = pct(breakdown.unpaved);
  const fmt = (n: number) => (n > 0 && n < 1 ? "<1" : String(Math.round(n)));
  return (
    <div className="surface">
      <div className="surface-bar" title="Aandeel verhard / halfverhard / onverhard">
        <span className="seg paved" style={{ width: `${p}%` }} />
        <span className="seg semi" style={{ width: `${s}%` }} />
        <span className="seg unpaved" style={{ width: `${u}%` }} />
      </div>
      <p className="surface-legend">
        <span>
          <i className="dot paved" /> {fmt(p)}% verhard
        </span>
        {breakdown.semi > 0 && (
          <span>
            <i className="dot semi" /> {fmt(s)}% half
          </span>
        )}
        {breakdown.unpaved > 0 && (
          <span>
            <i className="dot unpaved" /> {fmt(u)}% onverhard
          </span>
        )}
      </p>
    </div>
  );
}
