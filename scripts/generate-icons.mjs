// Regenerates the committed D7 Route icons from the approved vector monogram.
// Requires sharp (a CPU SVG renderer); no browser or site build step is used.
// Run: node scripts/generate-icons.mjs
// Add --preview to also write review/d7-home-screen-icon-preview.png.
// sharp may be installed locally or provided through Node's NODE_PATH.
// GitHub Pages serves the generated PNG/SVG/ICO files as-is.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RED = "#db1236";
const BLACK = "#000000";
const MARK = `
<path fill="${RED}" d="M9 8L18 10V56L9 59V57L13 54V13L9 10Z"/>
<path fill="${RED}" d="M22 10C45 12 54 27 51 41C48 54 35 58 22 59V55C38 53 42 43 41 32C40 20 32 15 22 13Z"/>
<path fill="${RED}" d="M39 31L72 27L49 78H43L64 33L38 36Z"/>
`;

// The actual mark bounds are x=9..72, y=8..78 in its 80-square source.
// Center the artwork itself rather than the source viewBox's empty margins.
// Maskable scale .65 confines even those bounds to a circle of radius 30.61;
// the required safe circle has radius 32 (40% of the 80-square canvas).
const REGULAR_SCALE = 0.90;
const APPLE_SCALE = 0.86;
const MASKABLE_SCALE = 0.65;

function drawing(scale) {
  const x = Number((40 - 40.5 * scale).toFixed(4));
  const y = Number((40 - 43 * scale).toFixed(4));
  return `<rect width="80" height="80" fill="${BLACK}"/>
  <g transform="translate(${x} ${y}) scale(${scale})">${MARK}</g>`;
}

function svg(scale) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  ${drawing(scale)}
</svg>
`;
}

async function render(markup, size) {
  return sharp(Buffer.from(markup))
    .resize(size, size)
    .flatten({ background: BLACK })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false, progressive: false })
    .toBuffer();
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ png, size }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(24, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(image => image.png)]);
}

const targets = [
  ["favicon.svg", REGULAR_SCALE, null],
  ["icons/mark.svg", REGULAR_SCALE, null],
  ["icons/mark-maskable.svg", MASKABLE_SCALE, null],
  ["favicon-32.png", REGULAR_SCALE, 32],
  ["icons/icon-192.png", REGULAR_SCALE, 192],
  ["icons/icon-512.png", REGULAR_SCALE, 512],
  ["icons/apple-touch-icon.png", APPLE_SCALE, 180],
  ["icons/icon-maskable-512.png", MASKABLE_SCALE, 512]
];

mkdirSync(join(root, "icons"), { recursive: true });
const favicon32 = new Map();
for (const [name, scale, size] of targets) {
  const markup = svg(scale);
  const output = size ? await render(markup, size) : markup;
  writeFileSync(join(root, name), output);
  if (size === 32) favicon32.set(size, output);
  console.log(`${name}${size ? ` ${size}x${size}` : ""} written`);
}
writeFileSync(join(root, "favicon.ico"), ico([
  { size: 16, png: await render(svg(REGULAR_SCALE), 16) },
  { size: 32, png: favicon32.get(32) }
]));
console.log("favicon.ico 16x16 + 32x32 written");

if (process.argv.includes("--preview")) {
  // The OS applies its own mask to the square icon; preview those masks without
  // baking rounded corners or transparency into any installed icon asset.
  const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="600" viewBox="0 0 1120 600">
    <defs>
      <clipPath id="rounded"><rect x="92" y="158" width="224" height="224" rx="48"/></clipPath>
      <clipPath id="circle"><circle cx="576" cy="270" r="112"/></clipPath>
      <clipPath id="apple"><rect x="826" y="178" width="180" height="180" rx="40"/></clipPath>
    </defs>
    <rect width="1120" height="600" fill="#101114"/>
    <text x="60" y="66" fill="#f3f2ef" font-family="Arial,sans-serif" font-size="26">D7 · Ready for your Samsung home screen</text>
    <text x="60" y="99" fill="#9c9fa6" font-family="Arial,sans-serif" font-size="15">Approved monogram · Crimson on true black</text>
    <g clip-path="url(#rounded)"><svg x="92" y="158" width="224" height="224" viewBox="0 0 80 80">${drawing(REGULAR_SCALE)}</svg></g>
    <g clip-path="url(#circle)"><svg x="464" y="158" width="224" height="224" viewBox="0 0 80 80">${drawing(MASKABLE_SCALE)}</svg></g>
    <g clip-path="url(#apple)"><svg x="826" y="178" width="180" height="180" viewBox="0 0 80 80">${drawing(APPLE_SCALE)}</svg></g>
    <g font-family="Arial,sans-serif" text-anchor="middle">
      <text x="204" y="424" fill="#f3f2ef" font-size="18">Samsung · D7 Route</text>
      <text x="204" y="451" fill="#9c9fa6" font-size="14">192 / 512 · Regular app icon</text>
      <text x="576" y="424" fill="#f3f2ef" font-size="18">Android · Adaptive</text>
      <text x="576" y="451" fill="#9c9fa6" font-size="14">512 × 512 · Maskable icon</text>
      <text x="916" y="424" fill="#f3f2ef" font-size="18">iPhone</text>
      <text x="916" y="451" fill="#9c9fa6" font-size="14">180 × 180 · Apple touch icon</text>
    </g>
    <line x1="60" y1="501" x2="1060" y2="501" stroke="#2a2c31"/>
    <svg x="60" y="531" width="16" height="16" viewBox="0 0 80 80">${drawing(REGULAR_SCALE)}</svg>
    <svg x="96" y="523" width="32" height="32" viewBox="0 0 80 80">${drawing(REGULAR_SCALE)}</svg>
    <text x="150" y="545" fill="#9c9fa6" font-family="Arial,sans-serif" font-size="14">Browser tab · 16 / 32 px</text>
    <text x="1060" y="545" text-anchor="end" fill="#9c9fa6" font-family="Arial,sans-serif" font-size="14">Preview masks · Final shape depends on your device</text>
  </svg>`;
  const output = await sharp(Buffer.from(preview)).png({ compressionLevel: 9, palette: false, progressive: false }).toBuffer();
  mkdirSync(join(root, "review"), { recursive: true });
  writeFileSync(join(root, "review/d7-home-screen-icon-preview.png"), output);
  console.log("review/d7-home-screen-icon-preview.png 1120x600 written");
}
