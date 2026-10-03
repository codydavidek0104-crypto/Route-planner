const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('manifest, icons, and theme color are linked for install', () => {
  assert.match(html, /<title>D7 Route \| D7 Marketing<\/title>/);
  assert.match(html, /<meta\s+name="description"/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#07080a">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="D7 Route">/);
  assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.doesNotMatch(html, /serviceWorker|service-worker/);
  assert.doesNotMatch(html, /d7-forest-road-background/);

  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'D7 Route');
  assert.equal(manifest.short_name, 'D7 Route');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#07080a');
  assert.equal(manifest.background_color, '#07080a');
  assert.ok(manifest.start_url.startsWith('./') || manifest.start_url.startsWith('.'));
  assert.ok(!manifest.start_url.startsWith('/'));
  assert.ok(!manifest.scope.startsWith('/'));

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

test('brand colors stay in custom properties and the map control guard remains', () => {
  assert.match(html, /:root\s*\{[^}]*--red:\s*#e10600/s);
  assert.match(html, /#map button \{ min-height: 0; \}/);
  assert.match(html, /key=AIzaSyDlsd2EZo4MxLunslRRMm-Xuy_Y0g6yEYM&libraries=places&callback=initMap/);
});

test('approved silver background and soft graphite address cards keep red primary action', () => {
  assert.match(html, /--bg: #55595d/);
  assert.match(html, /--address-panel: #4b5055/);
  assert.match(html, /--address-input: #5b6167/);
  assert.match(html, /\.route-step, \.stop-item, \.stop-composer \{[\s\S]*?background: linear-gradient\(145deg, #52585e, var\(--address-panel\)\)/);
  assert.match(html, /id="plan-route" class="btn action-button optimize-button"/);
  assert.match(html, /button\.btn\.optimize-button, button#start-trip, button#finish-trip \{[\s\S]*?background: linear-gradient\(140deg,#e70712,var\(--red\) 75%\)/);
});
