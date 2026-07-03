"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LonLat } from "@/lib/coords";
import { insertIndexForLineClick } from "@/lib/geo";
import type { Profile } from "@/lib/config";

// Load the map only in the browser (MapLibre needs window).
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Health = "checking" | "ok" | "down";

export default function Home() {
  const [waypoints, setWaypoints] = useState<LonLat[]>([]);
  const [routeCoords, setRouteCoords] = useState<number[][] | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ascendMeters, setAscendMeters] = useState<number | null>(null);
  const [profile] = useState<Profile>("paved");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("checking");

  // Latest waypoints/route, so map callbacks read fresh values.
  const wpRef = useRef(waypoints);
  wpRef.current = waypoints;
  const routeRef = useRef(routeCoords);
  routeRef.current = routeCoords;

  // Check the routing server on load.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(d.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  // Re-route whenever the waypoints or profile change.
  useEffect(() => {
    if (waypoints.length < 2) {
      setRouteCoords(null);
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
      body: JSON.stringify({ waypoints, profile }),
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
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setRouteCoords(null);
        setDistanceKm(null);
        setAscendMeters(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [waypoints, profile]);

  const handleMapClick = useCallback((p: LonLat) => {
    const wps = wpRef.current;
    if (wps.length === 0) setWaypoints([p]);
    else if (wps.length === 1) setWaypoints([...wps, p]);
    // With 2+ points, reshape by clicking the route line instead.
  }, []);

  const handleLineClick = useCallback((p: LonLat) => {
    const wps = wpRef.current;
    const coords = routeRef.current;
    if (!coords) return;
    const idx = insertIndexForLineClick(coords, wps, p);
    const next = [...wps];
    next.splice(idx, 0, p);
    setWaypoints(next);
  }, []);

  const handleWaypointMove = useCallback((index: number, p: LonLat) => {
    setWaypoints((wps) => wps.map((w, i) => (i === index ? p : w)));
  }, []);

  const handleWaypointDelete = useCallback((index: number) => {
    setWaypoints((wps) => (wps.length <= 2 ? wps : wps.filter((_, i) => i !== index)));
  }, []);

  const clearRoute = useCallback(() => {
    setWaypoints([]);
    setError(null);
  }, []);

  return (
    <>
      <MapView
        waypoints={waypoints}
        routeCoords={routeCoords}
        onMapClick={handleMapClick}
        onLineClick={handleLineClick}
        onWaypointMove={handleWaypointMove}
        onWaypointDelete={handleWaypointDelete}
      />

      <div className="panel">
        <h1>Routeplanner</h1>
        <p className="subtitle">
          <span className={`status-dot ${health === "ok" ? "ok" : health === "down" ? "bad" : "wait"}`} />
          {health === "ok"
            ? "Routeserver verbonden"
            : health === "down"
              ? "Routeserver niet bereikbaar"
              : "Routeserver controleren…"}
        </p>

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
          {loading && <p className="hint">Route berekenen…</p>}
          {error && <p className="error">{error}</p>}
        </div>

        <div className="section">
          <div className="btn-row">
            <button
              className="btn"
              onClick={clearRoute}
              disabled={waypoints.length === 0}
            >
              Nieuwe route
            </button>
          </div>
          <p className="hint">
            {waypoints.length === 0
              ? "Klik op de kaart voor het startpunt."
              : waypoints.length === 1
                ? "Klik op de kaart voor het eindpunt (mag gelijk zijn aan de start)."
                : "Sleep de punten om te schuiven. Klik op de blauwe lijn om een punt toe te voegen. Rechtsklik een punt om het te verwijderen."}
          </p>
        </div>
      </div>
    </>
  );
}
