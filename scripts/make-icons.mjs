// Generates the PWA app icons from the brand logo (brand/logo.png).
// The source is an AI-generated tile with a white border + drop shadow; we trim
// that away, clip the rounded-corner white to transparent, and place the mark on
// a solid green square for a clean full-bleed icon. Run after changing the logo:
//   node scripts/make-icons.mjs

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "brand", "logo.png");
const pub = join(root, "public");
const appDir = join(root, "app");
const GREEN = "#16a34a";
const N = 1000; // work at 1000px, then downscale

async function buildBase() {
  // 1) remove the white border + soft shadow around the tile
  const trimmed = await sharp(src).trim({ background: "#ffffff", threshold: 60 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  // 2) crop the centre (bike + route on green), well inside the tile's rounded
  // corners and edge highlight, so no white/outline remains — then let that green
  // fill the whole square for a clean full-bleed icon.
  const insetX = Math.round(meta.width * 0.12);
  const insetY = Math.round(meta.height * 0.12);
  const core = await sharp(trimmed)
    .extract({
      left: insetX,
      top: insetY,
      width: meta.width - 2 * insetX,
      height: meta.height - 2 * insetY,
    })
    .resize(N, N, { fit: "fill" })
    .toBuffer();
  // 3) flatten onto solid green as a safety net against any stray transparency
  return sharp({ create: { width: N, height: N, channels: 4, background: GREEN } })
    .composite([{ input: core }])
    .flatten({ background: GREEN })
    .png()
    .toBuffer();
}

const base = await buildBase();
const outputs = [
  [192, join(pub, "icon-192.png")],
  [512, join(pub, "icon-512.png")],
  [512, join(pub, "maskable-512.png")],
  [180, join(pub, "apple-icon.png")],
  [180, join(appDir, "apple-icon.png")], // Next file convention -> apple-touch-icon
  [256, join(appDir, "icon.png")],
];
for (const [size, file] of outputs) {
  await sharp(base).resize(size, size).png().toFile(file);
  console.log("  ->", file);
}
console.log("Klaar.");
