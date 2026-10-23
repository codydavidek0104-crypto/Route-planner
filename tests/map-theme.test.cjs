const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../map-theme.js'), 'utf8');

function setup({ googleAvailable = true, markerAvailable = true, pointAvailable = true, failAt = 0 } = {}) {
  const created = [];
  let attempts = 0;
  const maps = {};
  if (pointAvailable) maps.Point = class {
    constructor(x, y) { this.x = x; this.y = y; }
  };
  if (markerAvailable) maps.Marker = class {
    constructor(options) {
      if (++attempts === failAt) throw new Error('Marker capability failed');
      this.options = options;
      this.map = options.map;
      created.push(this);
    }
    setMap(map) { this.map = map; }
  };
  const context = vm.createContext(googleAvailable ? { google: { maps } } : {});
  vm.runInContext(source, context);
  const map = {};
  return {
    created, map,
    render: result => context.renderRouteMarkers(map, result),
    renderWithoutMap: result => context.renderRouteMarkers(null, result)
  };
}

function route(points) {
  return { routes: [{ legs: points.slice(1).map((end, index) => ({
    start_location: points[index], end_location: end
  })) }] };
}

test('route markers use actual LatLng and literal positions with accessible stop numbering', () => {
  const { render, created, map } = setup();
  const origin = { lat: () => 38.5816, lng: () => -121.4944 };
  const stop = { lat: 38.59, lng: -121.5 };
  const finish = { lat: 38.6, lng: -121.51 };
  const markers = render(route([origin, stop, finish]));
  assert.equal(markers.length, 3);
  assert.equal(markers[0], created[0]);
  assert.deepEqual(created.map(marker => marker.options.title), ['Start', 'Stop 1', 'Finish']);
  assert.equal(created[0].options.position.lat, origin.lat());
  assert.equal(created[0].options.position.lng, origin.lng());
  assert.equal(created[1].options.position.lat, stop.lat);
  assert.equal(created[1].options.position.lng, stop.lng);
  assert.equal(created[2].options.position.lat, finish.lat);
  assert.equal(created[2].options.position.lng, finish.lng);
  assert.ok(created.every(marker => marker.map === map && marker.options.optimized === false));
  assert.match(decodeURIComponent(created[1].options.icon.url), />1<\/text>/);
  assert.equal(created[0].options.icon.anchor.x, 16);
  assert.equal(created[0].options.icon.anchor.y, 16);
  assert.equal(created[2].options.icon.anchor.x, 16);
  assert.equal(created[2].options.icon.anchor.y, 16);
});

test('all twenty intermediate stops keep their real positions and numbers', () => {
  const { render, created } = setup();
  const points = Array.from({ length: 22 }, (_, index) => ({ lat: 30 + index / 1000, lng: -120 - index / 1000 }));
  assert.equal(render(route(points)).length, 22);
  for (let index = 1; index <= 20; index++) {
    assert.equal(created[index].options.title, `Stop ${index}`);
    assert.match(decodeURIComponent(created[index].options.icon.url), new RegExp(`>${index}</text>`));
    assert.equal(created[index].options.position.lat, points[index].lat);
    assert.equal(created[index].options.position.lng, points[index].lng);
  }
});

test('three-digit stop numbers get larger markers and endpoints remain distinct', () => {
  const { render, created } = setup();
  const points = Array.from({ length: 502 }, (_, i) => ({ lat: 30 + i / 1000, lng: -120 }));
  assert.equal(render(route(points)).length, 502);
  assert.match(decodeURIComponent(created[500].options.icon.url), /width="42"/);
  assert.match(decodeURIComponent(created[500].options.icon.url), />500<\/text>/);
  assert.match(decodeURIComponent(created[0].options.icon.url), />S<\/text>/);
  assert.match(decodeURIComponent(created[501].options.icon.url), />F<\/text>/);
});

test('missing and invalid route coordinates preserve the renderer fallback without partial markers', () => {
  const valid = { lat: 38.58, lng: -121.49 };
  const cases = [
    null,
    { routes: [] },
    { routes: [{ legs: [] }] },
    { routes: [{ legs: [{ start_location: valid }] }] },
    { routes: [{ legs: [{ end_location: valid }] }] },
    route([valid, { lat: Infinity, lng: 0 }]),
    route([valid, { lat: 91, lng: 0 }]),
    route([valid, { lat: 0, lng: -181 }]),
    route([valid, { lat: '38.58', lng: -121.49 }]),
    route([valid, { lat: () => { throw new Error('Location unavailable'); }, lng: () => 0 }])
  ];
  for (const result of cases) {
    const { render, created } = setup();
    assert.equal(render(result), null);
    assert.equal(created.length, 0);
  }
  const { render, created } = setup();
  const brokenMiddle = route([valid, { lat: 38.59, lng: -121.5 }, { lat: 38.6, lng: -121.51 }]);
  delete brokenMiddle.routes[0].legs[1].start_location;
  assert.equal(render(brokenMiddle), null);
  assert.equal(created.length, 0);
});

test('zero coordinates remain valid rather than triggering an invented fallback location', () => {
  const { render, created } = setup();
  assert.equal(render(route([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }])).length, 2);
  assert.equal(created[0].options.position.lat, 0);
  assert.equal(created[0].options.position.lng, 0);
});

test('missing optional Maps marker capabilities and missing map return the renderer fallback', () => {
  const result = route([{ lat: 38.58, lng: -121.49 }, { lat: 38.6, lng: -121.51 }]);
  for (const options of [{ googleAvailable: false }, { markerAvailable: false }, { pointAvailable: false }]) {
    const { render, created } = setup(options);
    assert.equal(render(result), null);
    assert.equal(created.length, 0);
  }
  const { renderWithoutMap, created } = setup();
  assert.equal(renderWithoutMap(result), null);
  assert.equal(created.length, 0);
});

test('partial marker construction failure rolls back every created marker', () => {
  const { render, created } = setup({ failAt: 3 });
  const result = route([
    { lat: 38.58, lng: -121.49 }, { lat: 38.59, lng: -121.5 },
    { lat: 38.6, lng: -121.51 }, { lat: 38.61, lng: -121.52 }
  ]);
  assert.equal(render(result), null);
  assert.equal(created.length, 2);
  assert.ok(created.every(marker => marker.map === null));
});
