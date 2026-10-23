// Prepare a separate-path Pages candidate without modifying the published root.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Provide a new output directory outside the source checkout.');
const output = resolve(process.argv[2]);
if (output === source || output.startsWith(source + '/') || output.startsWith(source + '\\')) {
  throw new Error('Keep release output outside the source checkout.');
}
const files = [
  'index.html', 'styles.css', 'map-theme.js', 'app.js', 'calendar.js', 'route-tools.js',
  'stop-import.js', 'instruction-assistant.js', 'service-worker.js', 'manifest.webmanifest',
  'favicon.svg', 'favicon-32.png', 'favicon.ico',
  'vendor/exceljs.min.js', 'vendor/exceljs-LICENSE.txt',
  'icons/mark.svg', 'icons/mark-maskable.svg', 'icons/d7-mark-only.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];
// mkdir must fail if output already exists: never replace a previous candidate.
await mkdir(output);
const hashes = [];
for (const file of files) {
  const bytes = await readFile(join(source, file));
  const target = join(output, 'updated', file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(source, file), target);
  hashes.push({ file: 'updated/' + file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
await writeFile(join(output, 'candidate-manifest.json'), JSON.stringify({
  status: 'unpublished-review-candidate',
  target: 'https://codydavidek0104-crypto.github.io/Route-planner/updated/',
  files: hashes
}, null, 2) + '\n');
await writeFile(join(output, 'RELEASE-NOTES.txt'), [
  'D7 update — unpublished review candidate',
  '',
  'Copy only the updated/ directory into the current Pages publishing root.',
  'Keep existing root files intact. Do not publish local preview fixtures.',
  'Verify actual Google Maps, traffic, NWS weather and offline setup on the new address.',
  'The two links share origin-based browser storage; offline shell caches use separate paths.',
  '',
  'Includes: compact local calendar, on-demand U.S. stop forecasts, traffic toggle,',
  'full-route map control and clearer numbered stops.',
  'Calendar scheduling is explicit. Calendar entries stay on this browser/device.',
  'Traffic is a visual overlay and does not change route estimates.',
  ''
].join('\n'));
console.log(`Prepared ${files.length} runtime assets in ${output}`);
