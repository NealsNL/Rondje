"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LonLat } from "@/lib/coords";
import { insertIndexForLineClick, arrowsAlongRoute } from "@/lib/geo";
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
  // On phones the panel is a bottom sheet; this tracks whether it's expanded.
  const [panelOpen, setPanelOpen] = useState(false);
  // In "Van A naar B" mode, whether the drawn route closes back to the start.
  const [closeLoop, setCloseLoop] = useState(false);
  // Bumped to ask the map to zoom to fit the whole route (generate/load/import).
  const [fitToken, setFitToken] = useState(0);
  // Undo history: number of stored previous waypoint states.
  const [histLen, setHistLen] = useState(0);
  // Place/address search.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ name: string; lon: number; lat: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; nonce: number } | null>(null);
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
  const closeLoopRef = useRef(closeLoop);
  closeLoopRef.current = closeLoop;

  // Snapshot the current waypoints before an edit so it can be undone.
  const historyRef = useRef<LonLat[][]>([]);
  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-49), wpRef.current];
    setHistLen(historyRef.current.length);
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    historyRef.current = h.slice(0, -1);
    setHistLen(historyRef.current.length);
    setWaypoints(h[h.length - 1]);
    setInfo(null);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

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
    const closing = tripType === "loop" || (tripType === "ptp" && closeLoop);
    const rw = routeWaypoints(waypoints, closing ? "loop" : "ptp");
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
  }, [waypoints, tripType, closeLoop, profile]);

  // Rondje: one clear start point (the loop itself is generated). A→B: each
  // click adds the next point the route rides through.
  const handleMapClick = useCallback((p: LonLat) => {
    setInfo(null);
    pushHistory();
    if (tripTypeRef.current === "loop") {
      setWaypoints([p]);
    } else {
      setWaypoints((wps) => [...wps, p]);
    }
  }, []);

  const handleLineClick = useCallback((p: LonLat) => {
    const wps = wpRef.current;
    const coords = routeRef.current;
    if (!coords) return;
    pushHistory();
    const closing =
      tripTypeRef.current === "loop" ||
      (tripTypeRef.current === "ptp" && closeLoopRef.current);
    const rw = routeWaypoints(wps, closing ? "loop" : "ptp");
    const idx = insertIndexForLineClick(coords, rw, p);
    const next = [...wps];
    next.splice(Math.min(idx, wps.length), 0, p); // keep inside the open list
    setWaypoints(next);
  }, []);

  const handleWaypointMove = useCallback(
    (index: number, p: LonLat) => {
      pushHistory();
      setWaypoints((wps) => wps.map((w, i) => (i === index ? p : w)));
    },
    [pushHistory],
  );

  const handleWaypointDelete = useCallback(
    (index: number) => {
      pushHistory();
      setWaypoints((wps) => (wps.length <= 1 ? wps : wps.filter((_, i) => i !== index)));
    },
    [pushHistory],
  );

  const clearRoute = useCallback(() => {
    pushHistory();
    setWaypoints([]);
    setError(null);
    setInfo(null);
    setGenMeta(null);
    setCloseLoop(false);
  }, []);

  const reverseRoute = useCallback(() => {
    pushHistory();
    setWaypoints((wps) => (wps.length < 2 ? wps : [...wps].reverse()));
  }, [pushHistory]);

  // Free place/address search via OpenStreetMap Nominatim (NL + BE).
  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=nl&countrycodes=nl,be&q=${encodeURIComponent(q)}`,
      );
      const d = (await r.json()) as { display_name: string; lon: string; lat: string }[];
      const list = (Array.isArray(d) ? d : []).map((x) => ({
        name: x.display_name,
        lon: Number(x.lon),
        lat: Number(x.lat),
      }));
      setResults(list);
      if (list.length === 0) setInfo("Geen plaats gevonden.");
    } catch {
      setError("Zoeken lukte niet. Is er internet?");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const pickResult = useCallback(
    (res: { name: string; lon: number; lat: number }) => {
      setFlyTo({ lon: res.lon, lat: res.lat, nonce: Date.now() });
      setQuery(res.name.split(",")[0]);
      setResults([]);
      setInfo(null);
    },
    [],
  );

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
      setCloseLoop(false);
      setRouteName(file.name.replace(/\.gpx$/i, ""));
      pushHistory();
      setWaypoints(sampleTrackToWaypoints(track, 24));
      setFitToken((n) => n + 1);
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
      pushHistory();
      setTripType("loop");
      setCloseLoop(false);
      setWaypoints(d.waypoints);
      setGenMeta({ direction, targetKm });
      setFitToken((n) => n + 1);
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
    const closing =
      tripTypeRef.current === "loop" ||
      (tripTypeRef.current === "ptp" && closeLoopRef.current);
    const rw = routeWaypoints(wpRef.current, closing ? "loop" : "ptp");
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
          tripType:
            tripTypeRef.current === "loop" ||
            (tripTypeRef.current === "ptp" && closeLoopRef.current)
              ? "loop"
              : "ptp",
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
      pushHistory();
      setProfile(d.profile);
      setTripType(d.tripType === "ptp" ? "ptp" : "loop");
      setCloseLoop(false);
      setRouteName(d.name);
      if (d.direction && d.targetKm) {
        setGenMeta({ direction: d.direction, targetKm: d.targetKm });
        setDirection(d.direction);
        setTargetKm(d.targetKm);
      } else {
        setGenMeta(null);
      }
      setWaypoints(d.waypoints);
      setFitToken((n) => n + 1);
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
  const arrows = useMemo(
    () => (routeCoords ? arrowsAlongRoute(routeCoords, 2000) : []),
    [routeCoords],
  );
  const rideTime =
    distanceKm != null && avgSpeed > 0
      ? formatDuration((distanceKm / avgSpeed) * 60)
      : "–";

  const closing = tripType === "loop" || (tripType === "ptp" && closeLoop);
  const hasStart = waypoints.length >= 1;
  const hasRoute = routeWaypoints(waypoints, closing ? "loop" : "ptp").length >= 2;

  return (
    <>
      <MapView
        waypoints={waypoints}
        loop={closing}
        segments={segments}
        arrows={arrows}
        fitToken={fitToken}
        flyTo={flyTo}
        hoverPoint={hoverPoint}
        onMapClick={handleMapClick}
        onLineClick={handleLineClick}
        onWaypointMove={handleWaypointMove}
        onWaypointDelete={handleWaypointDelete}
      />

      <div className={`panel ${panelOpen ? "is-open" : "is-collapsed"}`}>
        <button
          type="button"
          className="panel-handle"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          aria-label={panelOpen ? "Paneel sluiten" : "Paneel openen"}
        >
          <span className="grip" aria-hidden />
          <span className="handle-info">
            <span className="handle-label">
              {distanceKm != null ? (
                <>
                  <strong>{distanceKm.toFixed(1)} km</strong>
                  {ascendMeters != null ? ` · ↑ ${Math.round(ascendMeters)} m` : ""}
                </>
              ) : (
                "Rondje — tik om een route te plannen"
              )}
            </span>
            <span className="handle-caret" aria-hidden>
              {panelOpen ? "▾" : "▴"}
            </span>
          </span>
        </button>

        <div className="panel-body">
        <div className="brand">
          <img
            src="/icon-192.png"
            alt="Rondje-logo"
            className="brand-logo"
            width={32}
            height={32}
          />
          <h1>Rondje</h1>
        </div>
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
          <div className="search">
            <input
              type="text"
              placeholder="Zoek plaats of adres…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
            />
            <button
              className="btn"
              onClick={doSearch}
              disabled={searching || !query.trim()}
            >
              {searching ? <span className="spinner" /> : "Zoek"}
            </button>
          </div>
          {results.length > 0 && (
            <ul className="search-results">
              {results.map((res, i) => (
                <li key={i} onClick={() => pickResult(res)} title={res.name}>
                  {res.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section">
          <p className="section-title">Rittype</p>
          <div className="toggle">
            <button
              className={tripType === "loop" ? "active" : ""}
              onClick={() => {
                setTripType("loop");
                setCloseLoop(false);
                setWaypoints((w) => w.slice(0, 1)); // Rondje keeps only the start
              }}
            >
              Rondje
            </button>
            <button
              className={tripType === "ptp" ? "active" : ""}
              onClick={() => {
                setTripType("ptp");
                setCloseLoop(false);
              }}
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
          {tripType === "ptp" && waypoints.length >= 2 && (
            <div className="btn-row">
              {closeLoop ? (
                <button className="btn" onClick={() => setCloseLoop(false)}>
                  Rondje openen
                </button>
              ) : (
                <button className="btn primary" onClick={() => setCloseLoop(true)}>
                  ↩ Terug naar startpunt
                </button>
              )}
            </div>
          )}
          <div className="btn-row">
            <button className="btn" onClick={undo} disabled={histLen === 0}>
              ↶ Ongedaan maken
            </button>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={reverseRoute} disabled={!hasRoute}>
              Omdraaien
            </button>
            <button className="btn" onClick={clearRoute} disabled={waypoints.length === 0}>
              Nieuwe route
            </button>
          </div>
          <p className="hint">
            {tripType === "loop"
              ? waypoints.length === 0
                ? "Klik een startpunt op de kaart en genereer hieronder je rondje."
                : "Kies richting en afstand en klik op ‘Genereer rondrit’. Klik op de kaart voor een ander startpunt."
              : waypoints.length === 0
                ? "Klik het startpunt op de kaart."
                : waypoints.length === 1
                  ? "Klik het volgende punt — de route gaat langs alle punten die je zet."
                  : closeLoop
                    ? "De route keert terug naar de start. Sleep punten of klik op de route om bij te sturen."
                    : "Sleep punten of klik op de route om bij te sturen. Terug naar de start? Gebruik ‘Terug naar startpunt’."}
          </p>
        </div>
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
