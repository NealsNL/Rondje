// Generates the PWA app icons from a small inline SVG (green tile with a white
// route + start/end dots). Run once after changing the design:
//   node scripts/make-icons.mjs
// The resulting PNGs live in public/ and app/ and are committed to the repo.

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const appDir = join(root, "app");

function svg({ square }) {
  const bg = square
    ? `<rect width="512" height="512" fill="#16a34a"/>`
    : `<rect width="512" height="512" rx="112" ry="112" fill="#16a34a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    ${bg}
    <path d="M132 372 C 250 350 196 236 292 224 C 372 214 300 116 388 140"
          fill="none" stroke="#ffffff" stroke-width="30"
          stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="132" cy="372" r="34" fill="#ffffff"/>
    <circle cx="132" cy="372" r="15" fill="#16a34a"/>
    <circle cx="388" cy="140" r="30" fill="#ffffff"/>
  </svg>`;
}

async function render(svgString, size, outFile) {
  await sharp(Buffer.from(svgString)).resize(size, size).png().toFile(outFile);
  console.log("  ->", outFile);
}

const rounded = svg({ square: false });
const solid = svg({ square: true });

await render(rounded, 192, join(pub, "icon-192.png"));
await render(rounded, 512, join(pub, "icon-512.png"));
await render(solid, 512, join(pub, "maskable-512.png"));
await render(solid, 180, join(pub, "apple-icon.png"));
await render(rounded, 256, join(appDir, "icon.png")); // browser tab / favicon

console.log("Klaar.");
