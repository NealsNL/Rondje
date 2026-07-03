"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { LonLat } from "@/lib/coords";
import type { ColoredSegment } from "@/lib/surface";

type Props = {
  waypoints: LonLat[];
  segments: ColoredSegment[] | null;
  onMapClick: (p: LonLat) => void;
  onLineClick: (p: LonLat) => void;
  onWaypointMove: (index: number, p: LonLat) => void;
  onWaypointDelete: (index: number) => void;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// Colour by surface: green = paved, amber = semi (firm gravel), orange = unpaved.
const SURFACE_COLOR = [
  "match",
  ["get", "surface"],
  "paved",
  "#16a34a",
  "semi",
  "#eab308",
  "unpaved",
  "#ea580c",
  "#2563eb",
] as const;

function lineData(segments: ColoredSegment[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments.map((s) => ({
      type: "Feature",
      properties: { surface: s.surface },
      geometry: { type: "LineString", coordinates: s.coordinates },
    })),
  };
}

export default function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  // Keep the newest props/handlers in a ref so the once-registered map click
  // handler never reads stale values.
  const live = useRef(props);
  live.current = props;

  // --- create the map once ---
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [4.9, 51.4], // between NL and BE
      zoom: 7.2,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({}), "top-right");

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": SURFACE_COLOR as unknown as maplibregl.ExpressionSpecification,
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
      // Wide, invisible line on top to make the route easy to click.
      map.addLayer({
        id: "route-hit",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#000", "line-width": 22, "line-opacity": 0 },
      });
      setReady(true);
    });

    map.on("click", (e) => {
      const p = { lon: e.lngLat.lng, lat: e.lngLat.lat };
      const onLine =
        !!live.current.segments?.length &&
        map.queryRenderedFeatures(e.point, { layers: ["route-hit"] }).length > 0;
      if (onLine) live.current.onLineClick(p);
      else live.current.onMapClick(p);
    });

    map.on("mouseenter", "route-hit", () => {
      map.getCanvas().style.cursor = "copy";
    });
    map.on("mouseleave", "route-hit", () => {
      map.getCanvas().style.cursor = "";
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      setReady(false);
    };
  }, []);

  // --- draw / update the route line ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    src?.setData(props.segments?.length ? lineData(props.segments) : EMPTY);
  }, [props.segments, ready]);

  // --- keep markers in sync with the waypoints ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const wps = props.waypoints;

    if (markersRef.current.length !== wps.length) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = wps.map((wp, i) =>
        createMarker(map, wp, i, wps.length, live),
      );
    } else {
      wps.forEach((wp, i) => markersRef.current[i].setLngLat([wp.lon, wp.lat]));
    }
  }, [props.waypoints, ready]);

  return <div id="map" ref={containerRef} />;
}

function createMarker(
  map: maplibregl.Map,
  wp: LonLat,
  index: number,
  total: number,
  live: React.RefObject<Props>,
): maplibregl.Marker {
  const el = document.createElement("div");
  const role = index === 0 ? "start" : index === total - 1 ? "end" : "via";
  el.className = `wp-marker ${role}`;
  el.title =
    role === "via"
      ? "Sleep om te verplaatsen · rechtsklik om te verwijderen"
      : role === "start"
        ? "Startpunt"
        : "Eindpunt";

  const marker = new maplibregl.Marker({ element: el, draggable: true })
    .setLngLat([wp.lon, wp.lat])
    .addTo(map);

  marker.on("dragend", () => {
    const { lng, lat } = marker.getLngLat();
    live.current.onWaypointMove(index, { lon: lng, lat });
  });

  el.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    live.current.onWaypointDelete(index);
  });

  return marker;
}
