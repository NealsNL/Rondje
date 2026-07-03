import type { MetadataRoute } from "next";

// Web app manifest: makes the site installable as a PWA (home-screen app that
// opens full-screen). Next serves this at /manifest.webmanifest and links it
// automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rondje",
    short_name: "Rondje",
    description: "Fietsroutes tekenen, genereren en exporteren voor je Garmin",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16a34a",
    lang: "nl",
    orientation: "any",
    categories: ["sports", "navigation", "travel"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
