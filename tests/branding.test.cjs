const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { inflateSync } = require('node:zlib');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8').replace(/AIza[0-9A-Za-z_-]+/g, 'REDACTED_BROWSER_MAPS_KEY');
const css = readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = readFileSync(path.join(root, 'app.js'), 'utf8');

function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// Decode the committed image pixels rather than approving a specific renderer
// or raster hash. The generated icons use ordinary 8-bit RGB/RGBA PNGs.
function pngPixels(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    assert.ok(offset + length + 12 <= bytes.length, 'PNG chunk must be complete');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'Icon PNG must use 8-bit channels');
      assert.ok(data[9] === 2 || data[9] === 6, 'Icon PNG must use RGB or RGBA');
      channels = data[9] === 6 ? 4 : 3;
      assert.equal(data[10], 0); assert.equal(data[11], 0); assert.equal(data[12], 0, 'Icon PNG must not be interlaced');
    } else if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  assert.ok(width && height && channels && compressed.length, 'PNG needs dimensions and pixel data');
  const stride = width * channels;
  const rows = inflateSync(Buffer.concat(compressed));
  assert.equal(rows.length, height * (stride + 1));
  const pixels = Buffer.alloc(height * stride);
  function paeth(left, up, upperLeft) {
    const predicted = left + up - upperLeft;
    const a = Math.abs(predicted - left), b = Math.abs(predicted - up), c = Math.abs(predicted - upperLeft);
    return a <= b && a <= c ? left : b <= c ? up : upperLeft;
  }
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1), filter = rows[row];
    assert.ok(filter <= 4, 'PNG filter must be supported');
    for (let x = 0; x < stride; x++) {
      const output = y * stride + x;
      const left = x >= channels ? pixels[output - channels] : 0;
      const up = y ? pixels[output - stride] : 0;
      const upperLeft = y && x >= channels ? pixels[output - stride - channels] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up :
        filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      pixels[output] = (rows[row + x + 1] + prediction) & 255;
    }
  }
  return { width, height, channels, pixels };
}

test('manifest, icons, and theme color are linked for install', () => {
  assert.match(html, /<title>D7 Route \| D7 Marketing<\/title>/);
  assert.match(html, /<meta\s+name="description"/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#000000">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="D7 Route">/);
  assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png(?:\?[^" ]+)?">/);
  assert.match(html, /id="offline-status"/);
  assert.doesNotMatch(html, /d7-forest-road-background/);

  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'D7 Route');
  assert.equal(manifest.short_name, 'D7 Route');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#000000');
  assert.equal(manifest.background_color, '#000000');
  assert.ok(manifest.start_url.startsWith('./') || manifest.start_url.startsWith('.'));
  assert.ok(!manifest.start_url.startsWith('/'));
  assert.ok(!manifest.scope.startsWith('/'));
  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, 'https://example.test/Route-planner/');
    assert.equal(iconUrl.origin, 'https://example.test');
    assert.ok(iconUrl.pathname.startsWith('/Route-planner/icons/'));
    const localFile = path.join(root, iconUrl.pathname.slice('/Route-planner/'.length));
    assert.equal(existsSync(localFile), true, `Manifest icon must exist: ${icon.src}`);
    const dimensions = pngSize(localFile);
    assert.equal(icon.sizes, `${dimensions.width}x${dimensions.height}`);
  }

  for (const file of [
    'favicon.svg',
    'favicon.ico',
    'favicon-32.png',
    'icons/mark.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png',
    'icons/icon-maskable-512.png',
  ]) {
    assert.equal(existsSync(path.join(root, file)), true, file);
  }

  assert.deepEqual(pngSize(path.join(root, 'icons/icon-192.png')), { width: 192, height: 192 });
  assert.deepEqual(pngSize(path.join(root, 'icons/icon-512.png')), { width: 512, height: 512 });
  assert.deepEqual(pngSize(path.join(root, 'icons/apple-touch-icon.png')), { width: 180, height: 180 });
  assert.deepEqual(pngSize(path.join(root, 'icons/icon-maskable-512.png')), { width: 512, height: 512 });
  assert.deepEqual(pngSize(path.join(root, 'favicon-32.png')), { width: 32, height: 32 });
  const ico = readFileSync(path.join(root, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1);
});

test('installed icons have an opaque white canvas, the original company artwork and a safe maskable inset', () => {
  for (const file of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png']) {
    const { width, height, channels, pixels } = pngPixels(path.join(root, file));
    let nonOpaque = 0, white = 0, whiteBorderErrors = 0, crimson = 0, farthestColoredSquared = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels;
        const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
        if (channels === 4 && pixels[offset + 3] !== 255) nonOpaque++;
        const isWhite = r === 255 && g === 255 && b === 255;
        if (isWhite) white++;
        else {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          farthestColoredSquared = Math.max(farthestColoredSquared,
            (x + .5 - width / 2) ** 2 + (y + .5 - height / 2) ** 2);
        }
        if (!isWhite && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) whiteBorderErrors++;
        if (r > 170 && g < 70 && b < 100) crimson++;
      }
    }
    assert.equal(nonOpaque, 0, `${file}: every pixel must be fully opaque`);
    assert.equal(whiteBorderErrors, 0, `${file}: canvas edges must be white`);
    assert.ok(white > width * height * .5, `${file}: the background must remain predominantly white`);
    assert.ok(crimson > width * height * .005, `${file}: the mark must include visible original red artwork`);
    assert.ok(maxX - minX + 1 >= width * .25 && maxY - minY + 1 >= height * .25,
      `${file}: the mark must remain large enough to recognize`);
    if (file.includes('maskable')) {
      assert.ok(farthestColoredSquared <= (.4 * Math.min(width, height)) ** 2,
        `${file}: colored pixels must remain inside the 40%-radius safe circle`);
    }
  }
});

test('brand colors stay in custom properties and the map control guard remains', () => {
  assert.match(css, /:root\s*\{[^}]*--red:\s*#e10600/s);
  assert.match(css, /#map button \{ min-height: 0; \}/);
  const mapsScript = html.match(/src="(https:\/\/maps\.googleapis\.com[^" ]+)"/)[1];
  const parameters = new URL(mapsScript).searchParams;
  assert.equal(parameters.has("key"), true);
  assert.equal(parameters.get("libraries"), "places");
  assert.equal(parameters.get("callback"), "initMap");
});

test('facelift markup retains every application control once', () => {
  const markupIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(markupIds).size, markupIds.length, 'Markup IDs must be unique');
  const literalIds = [...app.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g)].map(match => match[1]);
  const workflowIds = ['view-plan', 'view-saved', 'view-reports', 'plan-view', 'saved-view', 'reports-view',
    'plan-route', 'calculate-route', 'map-access-note', 'journey-controls', 'planner-fields', 'report-message', 'history-message',
    'home-link', 'skip-link', 'route-heading', 'trip-heading'];
  for (const id of new Set([...literalIds, ...workflowIds])) {
    assert.equal(markupIds.filter(value => value === id).length, 1, `Missing or repeated control: ${id}`);
  }
});

test('route actions remain distinct and address fields remain labelled', () => {
  for (const [id, label] of [['plan-route', 'Optimize Route'], ['calculate-route', 'Calculate Route']]) {
    const button = html.match(new RegExp(`<button\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/button>`));
    assert.ok(button, `Missing ${id} button`);
    assert.match(button[0], /\btype=["']button["']/);
    assert.ok(button[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().includes(label), `Missing visible action label: ${label}`);
  }
  for (const id of ['start', 'stop-input', 'destination', 'vehicle-mpg', 'fuel-price', 'route-name', 'saved-route-select', 'driver-name', 'report-notes']) {
    assert.match(html, new RegExp(`<label\\b[^>]*\\bfor=["']${id}["']`), `Missing field label: ${id}`);
  }
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.pac-container/);
});

test('the header and installed assets use only the approved D7 mark while preserving the original reference', () => {
  const { createHash } = require('node:crypto');
  const original = readFileSync(path.join(root, 'icons/d7-logo-original.png'));
  assert.equal(createHash('sha256').update(original).digest('hex'), 'df64ed682406e6c8bf5034f80e775fe05fa59209d5a80cfe86f23f6527b9d3ce');
  const mark = readFileSync(path.join(root, 'icons/d7-mark-only.png'));
  assert.equal(createHash('sha256').update(mark).digest('hex'), 'e717b033bc65d238f9414152bb3af6732d714ce31682e413ceae50e5b36d47bb');
  assert.match(html, /<img class="logo-mark" src="icons\/d7-mark-only\.png" width="1280" height="1280" alt="D7"/);
  assert.doesNotMatch(html, /<svg class="logo-mark"/);
  for (const file of ['favicon.svg', 'icons/mark.svg', 'icons/mark-maskable.svg']) {
    const svg = readFileSync(path.join(root, file), 'utf8');
    const embedded = svg.match(/href="data:image\/png;base64,([^"]+)"/)[1];
    assert.deepEqual(Buffer.from(embedded, 'base64'), mark);
    assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  }
  assert.doesNotMatch(html, /Jacquelyn|651\.206\.2939|Director of Finance|MyInstallTeam|Installation Services/);
  assert.doesNotMatch(html, /src="icons\/d7-logo-original\.png"/);
  assert.match(html, /<p class="brand-sub">D7 Marketing<\/p>/);
});