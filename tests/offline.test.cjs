const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker({ installFails = false, networkFails = false } = {}) {
  const scope = 'https://example.test/Route-planner/';
  const events = {}, entries = new Map(), removed = [], fetched = [];
  let claims = 0, activations = 0;
  const cache = {
    async addAll(urls) {
      if (installFails) throw new Error('Download failed');
      for (const request of urls) {
        assert.equal(request.cache, 'reload');
        entries.set(request.url, `cached:${request.url}`);
      }
    },
    async match(url) { return entries.get(url); },
  };
  const context = vm.createContext({ URL, Request,
    self: { registration: { scope },
      async skipWaiting() { activations++; },
      addEventListener: (name, fn) => { events[name] = fn; },
      clients: { async claim() { claims++; } },
    },
    caches: {
      async open() { return cache; },
      async keys() { return [
        vm.runInContext('CACHE_NAME', context), 'd7-shell-%2FRoute-planner%2F-old',
        'd7-shell-%2FAnother-app%2F-v1', 'unrelated-cache',
      ]; },
      async delete(name) { removed.push(name); },
    },
    async fetch(request) {
      fetched.push(request.url);
      if (networkFails) throw new Error('Offline');
      return `network:${request.url}`;
    },
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8'), context);
  async function lifecycle(name) {
    let task;
    events[name]({ waitUntil(promise) { task = promise; } });
    await task;
  }
  async function request(url, method = 'GET') {
    let task;
    events.fetch({ request: { url, method }, respondWith(promise) { task = promise; } });
    return task;
  }
  return { scope, entries, removed, fetched, lifecycle, request, get claims() { return claims; }, get activations() { return activations; } };
}

test('the installed shell reopens at the Pages subpath with no network', async () => {
  const w = worker({ networkFails: true });
  await w.lifecycle('install');
  for (const [url, expected] of w.entries) {
    const relative = url.slice(w.scope.length) || 'index.html';
    assert.equal(existsSync(path.join(__dirname, '..', relative)), true, relative);
    assert.equal(await w.request(url), expected);
  }
  assert.equal(await w.request(w.scope + '?review=1'), 'cached:' + w.scope);
  assert.deepEqual(w.fetched, []);
});

test('Maps, tiles, API calls, other apps and non-GET requests bypass the worker', async () => {
  const w = worker(); await w.lifecycle('install');
  for (const url of [
    'https://maps.googleapis.com/maps/api/js',
    'https://maps.googleapis.com/maps/api/directions/json',
    'https://maps.gstatic.com/mapfiles/tile.png',
    'https://example.test/Another-app/index.html',
    w.scope + 'route.json', w.scope + 'service-worker.js',
  ]) assert.equal(await w.request(url), undefined);
  assert.equal(await w.request(w.scope + 'index.html', 'POST'), undefined);
  assert.deepEqual(w.fetched, []);
});

test('activation removes only obsolete caches belonging to this app scope', async () => {
  const w = worker(); await w.lifecycle('activate');
  assert.deepEqual(w.removed, ['d7-shell-%2FRoute-planner%2F-old']);
  assert.equal(w.claims, 1);
});

test('failed precaching rejects installation rather than claiming offline readiness', async () => {
  const w = worker({ installFails: true });
  await assert.rejects(w.lifecycle('install'), /Download failed/);
  assert.equal(w.claims, 0);
  assert.equal(w.activations, 0);
  assert.equal(w.entries.size, 0);
});
