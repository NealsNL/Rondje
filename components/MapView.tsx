"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { LonLat } from "@/lib/coords";
import type { ColoredSegment } from "@/lib/surface";

type Props = {
  waypoints: LonLat[];
  loop: boolean;
  segments: ColoredSegment[] | null;
  arrows: { lon: number; lat: number; bearing: number }[];
  fitToken: number;
  flyTo: { lon: number; lat: number; nonce: number } | null;
  hoverPoint: number[] | null;
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

// A white chevron (pointing up) with a dark halo, rotated per-feature to show
// the travel direction along the route.
function directionArrow(): ImageData {
  const s = 44;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(s / 2, s / 2);
  const chevron = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-11, 6);
    ctx.lineTo(0, -9);
    ctx.lineTo(11, 6);
    ctx.stroke();
  };
  chevron("#0f172a", 11);
  chevron("#ffffff", 6);
  return ctx.getImageData(0, 0, s, s);
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
      // Direction arrows along the route (which way it goes).
      if (!map.hasImage("arrow")) {
        map.addImage("arrow", directionArrow(), { pixelRatio: 2 });
      }
      map.addSource("arrows", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "route-arrows",
        type: "symbol",
        source: "arrows",
        layout: {
          "icon-image": "arrow",
          "icon-size": 0.7,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": false,
          "icon-padding": 4,
        },
      });
      // Marker that follows the elevation-chart hover.
      map.addSource("hover", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "hover-pt",
        type: "circle",
        source: "hover",
        paint: {
          "circle-radius": 6,
          "circle-color": "#111827",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
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

  // --- draw / update the direction arrows ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("arrows") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: props.arrows.map((a) => ({
        type: "Feature",
        properties: { bearing: a.bearing },
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      })),
    });
  }, [props.arrows, ready]);

  // --- zoom to fit the whole route when asked (generate / load / import) ---
  const lastFitRef = useRef(props.fitToken);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (props.fitToken === lastFitRef.current) return;
    const segs = props.segments;
    if (!segs?.length) return; // wait until the new route is drawn
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const s of segs)
      for (const c of s.coordinates) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      }
    if (minLng === Infinity) return;
    lastFitRef.current = props.fitToken;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 64, duration: 600, maxZoom: 15 },
    );
  }, [props.fitToken, props.segments, ready]);

  // --- fly to a searched place ---
  const lastFlyRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.flyTo) return;
    if (props.flyTo.nonce === lastFlyRef.current) return;
    lastFlyRef.current = props.flyTo.nonce;
    map.flyTo({ center: [props.flyTo.lon, props.flyTo.lat], zoom: 13, duration: 800 });
  }, [props.flyTo, ready]);

  // --- move the elevation-hover marker ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("hover") as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      props.hoverPoint
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: props.hoverPoint },
              },
            ],
          }
        : EMPTY,
    );
  }, [props.hoverPoint, ready]);

  // --- keep markers in sync with the waypoints ---
  const lastLoopRef = useRef(props.loop);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const wps = props.waypoints;
    const loopChanged = lastLoopRef.current !== props.loop;
    lastLoopRef.current = props.loop;

    if (markersRef.current.length !== wps.length || loopChanged) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = wps.map((wp, i) =>
        createMarker(map, wp, i, wps.length, props.loop, live),
      );
    } else {
      wps.forEach((wp, i) => markersRef.current[i].setLngLat([wp.lon, wp.lat]));
    }
  }, [props.waypoints, props.loop, ready]);

  return <div id="map" ref={containerRef} />;
}

function createMarker(
  map: maplibregl.Map,
  wp: LonLat,
  index: number,
  total: number,
  loop: boolean,
  live: React.RefObject<Props>,
): maplibregl.Marker {
  const el = document.createElement("div");
  // In a loop there is no separate end marker (start is also the finish).
  const role =
    index === 0 ? "start" : !loop && index === total - 1 ? "end" : "via";
  el.className = `wp-marker ${role}`;
  el.title =
    role === "via"
      ? "Tussenstop · sleep om te verplaatsen, rechtsklik om te verwijderen"
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
