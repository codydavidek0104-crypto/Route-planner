// Derive square icons from the approved D7-only mark, with no added lettering.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const original = readFileSync(join(root, 'icons/d7-mark-only.png'));
const ratio = 1;
function svg(scale) {
  const width = 512 * scale, height = width * ratio;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#fff"/><image x="${(512-width)/2}" y="${(512-height)/2}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${original.toString('base64')}"/></svg>\n`;
}
async function render(scale, size) {
  return sharp(Buffer.from(svg(scale))).resize(size, size).flatten({background:'#fff'}).removeAlpha().png().toBuffer();
}
for (const [file, scale, size] of [
  ['favicon.svg', .96], ['icons/mark.svg', .96], ['icons/mark-maskable.svg', .66],
  ['favicon-32.png', .96, 32], ['icons/icon-192.png', .96, 192],
  ['icons/icon-512.png', .96, 512], ['icons/apple-touch-icon.png', .96, 180],
  ['icons/icon-maskable-512.png', .66, 512],
]) writeFileSync(join(root,file), size ? await render(scale,size) : svg(scale));
const images = await Promise.all([16,32].map(async size=>({size,png:await render(.96,size)})));
const header = Buffer.alloc(6); header.writeUInt16LE(1,2); header.writeUInt16LE(images.length,4);
let offset = 6 + images.length * 16;
const entries = images.map(({size,png}) => {
  const entry = Buffer.alloc(16); entry[0]=size; entry[1]=size;
  entry.writeUInt16LE(1,4); entry.writeUInt16LE(24,6);
  entry.writeUInt32LE(png.length,8); entry.writeUInt32LE(offset,12); offset+=png.length;
  return entry;
});
writeFileSync(join(root,'favicon.ico'), Buffer.concat([header,...entries,...images.map(x=>x.png)]));
