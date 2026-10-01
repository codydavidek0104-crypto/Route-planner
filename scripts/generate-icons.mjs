// Regenerates the committed D7 Route icons from the monogram paths.
// Requires Chrome and puppeteer-core (already used in this environment):
//   CHROME_PATH=/usr/bin/google-chrome node scripts/generate-icons.mjs
// The site does not run this. GitHub Pages serves the PNG/SVG/ICO files as-is.
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RED = "#e10600";
const BLACK = "#07080a";
const MARK = `
<path fill="${RED}" fill-rule="evenodd" d="M6 6H20C44 6 50 18 50 32C50 46 44 58 20 58H6ZM18 18H22C34 18 36 24 36 32C36 40 34 46 22 46H18Z"/>
<path fill="${RED}" d="M56 6H76V15H68L54 58H44L58 15H56Z"/>
`;

function svg(sizePad) {
  const scale = sizePad;
  const w = 80 * scale;
  const h = 64 * scale;
  const x = (64 - w) / 2;
  const y = (64 - h) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${BLACK}"/>
  <g transform="translate(${x} ${y}) scale(${scale})">
    ${MARK}
  </g>
</svg>
`;
}

function page(markup, size) {
  return `<!DOCTYPE html><html><head><style>
    html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:${BLACK}}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${markup}</body></html>`;
}

function ico(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const entries = [];
  for (const { png, size } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const targets = [
  ["favicon.svg", svg(0.78), null],
  ["icons/mark.svg", svg(0.78), null],
  ["icons/mark-maskable.svg", svg(0.5), null],
  ["favicon-32.png", svg(0.78), 32],
  ["icons/icon-192.png", svg(0.78), 192],
  ["icons/icon-512.png", svg(0.78), 512],
  ["icons/apple-touch-icon.png", svg(0.72), 180],
  ["icons/icon-maskable-512.png", svg(0.5), 512],
];

mkdirSync(join(root, "icons"), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

const pngs = {};
for (const [name, markup, size] of targets) {
  const file = join(root, name);
  if (!size) {
    writeFileSync(file, markup);
    continue;
  }
  const htmlPath = join(tmpdir(), "d7-icon-raster.html");
  writeFileSync(htmlPath, page(markup, size));
  const tab = await browser.newPage();
  await tab.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await tab.goto("file://" + htmlPath, { waitUntil: "load" });
  const png = await tab.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: size, height: size },
  });
  writeFileSync(file, png);
  pngs[size] = png;
  await tab.close();
  console.log(name, png.length);
}
const tab16 = await browser.newPage();
await tab16.setViewport({ width: 16, height: 16, deviceScaleFactor: 1 });
const html16 = join(tmpdir(), "d7-icon-raster.html");
writeFileSync(html16, page(svg(0.78), 16));
await tab16.goto("file://" + html16, { waitUntil: "load" });
const png16 = await tab16.screenshot({ type: "png", clip: { x: 0, y: 0, width: 16, height: 16 } });
await tab16.close();
await browser.close();
try { unlinkSync(html16); } catch { /* temp file already gone */ }

writeFileSync(join(root, "favicon.ico"), ico([
  { size: 16, png: png16 },
  { size: 32, png: pngs[32] },
]));
console.log("favicon.ico written");
