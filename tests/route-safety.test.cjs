const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the actual page script with controlled Maps responses and a minimal DOM.
function setup(confirmations = [], {
  init = true, storage = {}, places = true, navigatorApi = {},
  initialTime = Date.parse('2026-09-28T16:00:00Z')
} = {}) {
  const elements = new Map();
  const downloads = [];
  const blobs = [];
  const fallbackCopies = [];
  function element(tagName = 'div') {
    return {
      tagName,
      value: '', textContent: '', hidden: true, children: [], listeners: {},
      className: '', style: {},
      set innerHTML(value) { this.children = []; },
      appendChild(child) { this.children.push(child); child.parent = this; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
      click() {
        if (this.tagName === 'a') downloads.push({ href: this.href, download: this.download });
        return this.listeners.click?.();
      },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute(name, value) { this[name] = value; },
      focus() {}, select() {}, scrollIntoView() {},
    };
  }
  const el = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  el('vehicle-mpg').value = '15';
  el('fuel-price').value = '4.50';
  const requests = [];
  const renderers = [];
  const autocompletes = [];
  const stored = storage;
  const opened = [];
  const confirmationMessages = [];
  // Fake timers: advance(ms) runs due callbacks in order.
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const advance = ms => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target)
        .sort((x, y) => x[1].at - y[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
  };
  const maps = {
    Map: class {},
    DirectionsService: class { route(options, callback) { requests.push({ options, callback }); } },
    DirectionsRenderer: class {
      constructor() { renderers.push(this); }
      setMap(map) { this.map = map; }
      setDirections(result) { this.result = result; }
    },
    TravelMode: { DRIVING: 'DRIVING' },
  };
  if (places) {
    maps.places = {
      Autocomplete: class {
        constructor(input, options) {
          this.input = input;
          this.options = options;
          this.listeners = {};
          this.place = null;
          autocompletes.push(this);
        }
        addListener(name, fn) { this.listeners[name] = fn; }
        getPlace() { return this.place || {}; }
      },
    };
  }
  const context = vm.createContext({
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [initialTime + now])); }
      static now() { return initialTime + now; }
    },
    navigator: navigatorApi,
    Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:report-test'; }, revokeObjectURL() {} },
    document: {
      getElementById: el, createElement: element, body: el('body'),
      execCommand(command) {
        assert.equal(command, 'copy');
        fallbackCopies.push(el('body').children.at(-1).value);
        return true;
      },
    },
    setTimeout: (fn, ms) => { const id = nextTimerId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
    localStorage: {
      getItem: key => stored[key] || null,
      setItem: (key, value) => { stored[key] = value; },
      removeItem: key => { delete stored[key]; },
    },
    window: {
      location: { href: '' },
      open: (url, target) => { opened.push({ url, target }); },
      confirm: message => {
        confirmationMessages.push(message);
        return confirmations.length ? confirmations.shift() : true;
      },
    },
    google: { maps },
  });
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  if (init) vm.runInContext('initMap()', context);
  const click = id => el(id).listeners.click();
  const add = address => { el('stop-input').value = address; click('add-stop'); };
  const destination = address => { el('destination').value = address; el('destination').listeners.input(); };
  const reply = (index, status = 'OK', order = [], legs = [{ distance: { value: 16093.44 }, duration: { value: 5100 } }]) => requests[index].callback({ routes: [{
    waypoint_order: order,
    legs,
  }] }, status);
  const calculate = () => click('plan-route');
  const stale = () => {
    assert.equal(el('route-stale-warning').hidden, false);
    assert.equal(renderers[0].map, null);
    assert.doesNotMatch(el('route-message').textContent, /miles|Est\. fuel/);
  };
  if (init) {
    el('start').value = 'Origin';
    add('Start');
    destination('End');
  }
  const savedRoutes = () => JSON.parse(stored.d7SavedRoutes || '{}');
  return {
    el, click, add, destination, requests, renderers, reply, calculate, stale,
    savedRoutes, confirmationMessages, advance, context, autocompletes, stored, opened,
    downloads, blobs, fallbackCopies,
  };
}

function beginTrip(a) {
  a.calculate(); a.reply(a.requests.length - 1); a.click('start-trip');
}

function finishTwoStopTrip(a) {
  beginTrip(a);
  a.click('trip-next'); a.click('trip-next'); a.click('finish-trip');
  return JSON.parse(a.stored.d7TripReports)[0];
}

test('trip start snapshots optimized addresses, per-leg estimates, and fuel inputs', () => {
  const a = setup(); a.add('Second'); a.click('plan-route');
  a.reply(0, 'OK', [1, 0], [
    { distance: { value: 1609.344 }, duration: { value: 60 } },
    { distance: { value: 3218.688 }, duration: { value: 120 } },
    { distance: { value: 4828.032 }, duration: { value: 180 } },
  ]);
  a.el('vehicle-mpg').value = '12'; a.el('fuel-price').value = '4';
  a.click('start-trip');
  const trip = JSON.parse(a.stored.d7TripProgress);
  assert.equal(trip.startedAt, '2026-09-28T16:00:00.000Z');
  assert.deepEqual(trip.addresses, ['Second', 'Start', 'End']);
  assert.deepEqual(trip.completedAt, [null, null, null]);
  assert.deepEqual(trip.routeSnapshot, {
    start: 'Origin', stops: ['Second', 'Start'], destination: 'End',
    plannedMiles: 6, plannedMinutes: 6, mpg: 12, fuelPrice: 4, fuelCost: 2,
    legs: [
      { from: 'Origin', to: 'Second', plannedMiles: 1, plannedMinutes: 1 },
      { from: 'Second', to: 'Start', plannedMiles: 2, plannedMinutes: 2 },
      { from: 'Start', to: 'End', plannedMiles: 3, plannedMinutes: 3 },
    ],
  });
  a.destination('Changed'); a.el('vehicle-mpg').value = '99';
  assert.deepEqual(JSON.parse(a.stored.d7TripProgress), trip);
});

test('arrival times survive refresh and Back replaces a completion with the latest time', () => {
  const a = setup(); beginTrip(a); a.advance(60000); a.click('trip-next');
  assert.equal(JSON.parse(a.stored.d7TripProgress).completedAt[0], '2026-09-28T16:01:00.000Z');
  const b = setup([], { storage: a.stored, initialTime: Date.parse('2026-09-28T16:02:00Z') });
  assert.equal(b.el('trip-stop-address').textContent, 'End');
  b.click('trip-back'); b.click('trip-next'); b.advance(60000); b.click('trip-next');
  const trip = JSON.parse(b.stored.d7TripProgress);
  assert.deepEqual(trip.completedAt, ['2026-09-28T16:02:00.000Z', '2026-09-28T16:03:00.000Z']);
  assert.equal(b.el('finish-trip').hidden, false);
  b.click('finish-trip');
  const report = JSON.parse(b.stored.d7TripReports)[0];
  assert.equal(report.elapsedMinutes, 3);
  assert.equal(report.incomplete, false);
  assert.equal(report.routeSnapshot.plannedMiles, 10);
  assert.equal(report.routeSnapshot.plannedMinutes, 85);
  assert.equal(report.routeSnapshot.fuelCost, 3);
  assert.equal(b.stored.d7TripProgress, undefined);
  assert.equal(b.el('trip-panel').hidden, true);
  assert.equal(b.el('trip-report').hidden, false);
  assert.ok(b.el('report-summary').children.some(p => p.textContent === 'Stops completed: 2 of 2'));
});

test('early ending asks for confirmation, supports cancel, and saves an incomplete report', () => {
  const a = setup([false, true]); beginTrip(a);
  assert.equal(a.el('finish-trip').hidden, true);
  a.advance(30000); a.click('trip-next'); a.click('end-trip');
  assert.equal(a.stored.d7TripReports, undefined);
  assert.ok(a.stored.d7TripProgress);
  a.click('end-trip');
  assert.equal(a.confirmationMessages[0], 'End trip early? The report will show it as incomplete.');
  const report = JSON.parse(a.stored.d7TripReports)[0];
  assert.equal(report.incomplete, true);
  assert.equal(report.elapsedMinutes, 0.5);
  assert.equal(report.completedAt.filter(Boolean).length, 1);
  assert.equal(a.el('report-stops').children[1].textContent, 'End — Not completed');
});

test('revisiting the destination updates its arrival time before finishing', () => {
  const a = setup(); beginTrip(a);
  a.click('trip-next'); a.click('trip-next');
  a.click('trip-back'); a.advance(60000); a.click('trip-next');
  assert.equal(a.el('trip-next').disabled, false);
  a.click('trip-next'); a.click('finish-trip');
  assert.equal(JSON.parse(a.stored.d7TripReports)[0].completedAt[1], '2026-09-28T16:01:00.000Z');
});

test('legacy progress restores without inventing times or planned route figures', () => {
  const storage = { d7TripProgress: JSON.stringify({ addresses: ['Legacy stop', 'Legacy destination'], index: 1 }) };
  const a = setup([], { storage, init: false });
  assert.equal(a.el('trip-panel').hidden, false);
  assert.equal(a.el('trip-stop-address').textContent, 'Legacy destination');
  a.click('trip-next'); a.click('finish-trip');
  const report = JSON.parse(storage.d7TripReports)[0];
  assert.equal(report.startedAt, null);
  assert.equal(report.elapsedMinutes, null);
  assert.equal(report.routeSnapshot.plannedMiles, null);
  // The driver had already passed the first stop; its time was never recorded.
  assert.equal(report.incomplete, false);
  assert.equal(a.el('report-stops').children[0].textContent, 'Legacy stop — Completed (time not recorded)');
  assert.ok(a.el('report-summary').children.some(p => p.textContent === 'Stops completed: 2 of 2'));
  assert.ok(a.el('report-summary').children.some(p => p.textContent === 'Start time: Not recorded'));
});

test('driver and notes are saved safely and included in identical copy, email, and share text', async () => {
  const copies = [], shares = [];
  const a = setup([], { navigatorApi: {
    clipboard: { writeText: async text => copies.push(text) },
    share: async data => shares.push(data),
  } });
  finishTwoStopTrip(a);
  const driver = 'Pat & <Lee> "Jr"';
  const notes = 'Gate #2, north entrance\nCall + wait & confirm.';
  a.el('driver-name').value = driver; a.el('driver-name').listeners.input();
  a.el('report-notes').value = notes; a.el('report-notes').listeners.input();
  await a.click('copy-report');
  assert.equal(a.el('report-message').textContent, 'Copied!');
  assert.match(copies[0], /Driver: Pat & <Lee> "Jr"/);
  assert.match(copies[0], /Stops completed: 2 of 2/);
  assert.match(copies[0], /Start address: Origin/);
  assert.match(copies[0], /Planned route miles: 10.0/);
  assert.match(copies[0], /Planned route drive time: 85.0 min/);
  assert.match(copies[0], /Planned route estimated fuel cost: \$3.00/);
  assert.ok(copies[0].endsWith('Notes: ' + notes));
  a.click('email-report');
  const report = JSON.parse(a.stored.d7TripReports)[0];
  const subject = `D7 Route trip report - ${report.date} - ${driver}`;
  assert.equal(a.context.window.location.href,
    'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(copies[0]));
  assert.equal(a.el('share-report').hidden, false);
  await a.click('share-report');
  assert.equal(shares[0].title, subject);
  assert.equal(shares[0].text, copies[0]);
  assert.equal(report.notes, notes);
  assert.equal(a.stored.d7DriverName, driver);
  assert.match(a.el('trip-reports-list').children[0].children[0].textContent, /Pat & <Lee>/);
  const next = setup([], { storage: a.stored });
  assert.equal(finishTwoStopTrip(next).driver, driver);
});

test('copy fallback works when clipboard is missing or rejects and Share stays hidden', async () => {
  for (const navigatorApi of [{}, { clipboard: { writeText: async () => { throw new Error('Denied'); } } }]) {
    const a = setup([], { navigatorApi }); finishTwoStopTrip(a);
    assert.equal(a.el('share-report').hidden, true);
    await a.click('copy-report');
    assert.match(a.fallbackCopies[0], /D7 Route trip report/);
    assert.equal(a.el('report-message').textContent, 'Copied!');
    assert.equal(a.el('body').children.length, 0);
  }
});

test('history lists and reopens saved reports and deletes only after confirmation', () => {
  const a = setup(); const report = finishTwoStopTrip(a);
  const b = setup([false, true], { storage: a.stored });
  const row = b.el('trip-reports-list').children[0];
  assert.ok(row.children[0].textContent.includes(report.date));
  assert.match(row.children[0].textContent, /2 of 2 stops/);
  row.children[0].listeners.click();
  assert.equal(b.el('trip-report').hidden, false);
  assert.equal(b.el('report-stops').children.length, 2);
  row.children[1].listeners.click();
  assert.equal(JSON.parse(b.stored.d7TripReports).length, 1);
  row.children[1].listeners.click();
  assert.equal(JSON.parse(b.stored.d7TripReports).length, 0);
  assert.equal(b.el('trip-report').hidden, true);
  assert.equal(b.el('export-reports').disabled, true);
});

test('history retains only the most recent 100 reports', () => {
  const a = setup(); const sample = finishTwoStopTrip(a);
  a.stored.d7TripReports = JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ ...sample, id: `old-${index}` })));
  const latest = finishTwoStopTrip(a);
  const reports = JSON.parse(a.stored.d7TripReports);
  assert.equal(reports.length, 100);
  assert.equal(reports[0].id, latest.id);
  assert.equal(reports.at(-1).id, 'old-98');
  assert.equal(a.el('trip-reports-list').children.length, 100);
});

test('CSV download contains all reports and escapes commas, quotes, and newlines', async () => {
  const a = setup(); finishTwoStopTrip(a);
  a.el('driver-name').value = 'Lee, "Jr"'; a.el('driver-name').listeners.input();
  a.el('report-notes').value = 'Line 1, "quoted"\r\nLine 2'; a.el('report-notes').listeners.input();
  const report = JSON.parse(a.stored.d7TripReports)[0];
  finishTwoStopTrip(a);
  a.click('export-reports');
  assert.deepEqual(a.downloads, [{ href: 'blob:report-test', download: 'd7-trip-reports.csv' }]);
  const csv = await a.blobs[0].text();
  assert.match(csv, /"elapsed minutes","stops completed","total stops"/);
  assert.ok(csv.includes('"Lee, ""Jr"""'));
  assert.equal(csv.split(`"${report.date}",`).length, 3);
  assert.ok(csv.endsWith('"Line 1, ""quoted""\r\nLine 2"'));
  assert.ok(csv.includes(`"${report.startedAt}","${report.endedAt}","0","2","2","10","85","15","4.5","3"`));
});

test('storage errors keep a trip available to retry and a saved report prevents duplicate restoration', () => {
  const a = setup(); beginTrip(a); a.click('trip-next'); a.click('trip-next');
  const savedProgress = a.stored.d7TripProgress;
  const setItem = a.context.localStorage.setItem;
  a.context.localStorage.setItem = () => { throw new Error('Full'); };
  a.click('finish-trip');
  assert.ok(a.stored.d7TripProgress);
  assert.equal(a.el('trip-panel').hidden, false);
  assert.match(a.el('report-message').textContent, /Could not save the report/);
  a.context.localStorage.setItem = setItem;
  a.click('finish-trip');
  assert.equal(JSON.parse(a.stored.d7TripReports).length, 1);
  a.stored.d7TripProgress = savedProgress;
  const b = setup([], { storage: a.stored });
  assert.equal(b.el('trip-panel').hidden, true);
});

test('snapshot fuel cost matches the displayed estimate; Maps controls keep their own size', () => {
  const a = setup(); a.calculate();
  a.reply(0, 'OK', [], [{ distance: { value: 27951.8 }, duration: { value: 1901 } }]);
  assert.match(a.el('route-message').textContent, /17.4 miles .* Est. fuel: \$5.22/);
  a.click('start-trip');
  assert.equal(JSON.parse(a.stored.d7TripProgress).routeSnapshot.fuelCost.toFixed(2), '5.22');
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /#map button \{ min-height: 0; \}/);
});

test('Navigate uses encoded addresses in optimized waypoint order', () => {
  const a = setup();
  a.destination('Final #4, CA');
  a.add('First & Main');
  a.add('Second / Oak');
  a.click('plan-route');
  // Middle stops are Start, First & Main, Second / Oak; the start field is the origin.
  a.reply(0, 'OK', [2, 1, 0]);
  assert.equal(a.el('navigation-results').hidden, false);
  assert.equal(a.el('navigation-controls').children[0].textContent, 'Navigate');
  a.el('navigation-controls').children[0].listeners.click();
  assert.deepEqual(a.opened[0], {
    url: 'https://www.google.com/maps/dir/?api=1&origin=Origin&destination=Final%20%234%2C%20CA&waypoints=Second%20%2F%20Oak|First%20%26%20Main|Start&travelmode=driving',
    target: '_blank',
  });
});

test('20 stops split into overlapping navigation legs with at most nine waypoints', () => {
  const a = setup();
  for (let i = 2; i <= 20; i++) a.add(`Stop ${i}`);
  a.calculate(); a.reply(0);
  // Start field + 20 middle stops + destination = 22 points: 9, 9, then 0 waypoints.
  const buttons = a.el('navigation-controls').children;
  assert.equal(buttons.length, 3);
  assert.equal(buttons[0].textContent, 'Navigate leg 1 of 3');
  assert.equal(buttons[2].textContent, 'Navigate leg 3 of 3');
  for (const button of buttons) button.listeners.click();
  const urls = a.opened.map(item => new URL(item.url));
  assert.equal(urls[0].searchParams.get('origin'), 'Origin');
  assert.equal(urls[0].searchParams.get('waypoints').split('|').length, 9);
  assert.equal(urls[1].searchParams.get('waypoints').split('|').length, 9);
  assert.equal(urls[2].searchParams.has('waypoints'), false);
  assert.equal(urls[0].searchParams.get('destination'), urls[1].searchParams.get('origin'));
  assert.equal(urls[1].searchParams.get('destination'), urls[2].searchParams.get('origin'));
  assert.equal(urls[2].searchParams.get('origin'), 'Stop 20');
  assert.equal(urls[2].searchParams.get('destination'), 'End');
});

test('Start from my location omits the origin parameter', () => {
  const a = setup(); a.calculate(); a.reply(0);
  a.el('start-from-location').checked = true;
  a.el('navigation-controls').children[0].listeners.click();
  assert.equal(new URL(a.opened[0].url).searchParams.has('origin'), false);
});

test('Start from my location omits the origin only on the first leg', () => {
  const a = setup();
  for (let i = 2; i <= 14; i++) a.add(`Stop ${i}`);
  a.calculate(); a.reply(0);
  a.el('start-from-location').checked = true;
  const buttons = a.el('navigation-controls').children;
  assert.equal(buttons.length, 2);
  buttons[0].listeners.click(); buttons[1].listeners.click();
  const urls = a.opened.map(item => new URL(item.url));
  assert.equal(urls[0].searchParams.has('origin'), false);
  assert.equal(urls[1].searchParams.get('origin'), urls[0].searchParams.get('destination'));
  assert.equal(urls[1].searchParams.get('origin'), 'Stop 10');
});

test('Navigate appears only for a current successful result', () => {
  const a = setup();
  assert.equal(a.el('navigation-results').hidden, true);
  a.calculate();
  assert.equal(a.el('navigation-results').hidden, true);
  a.reply(0);
  assert.equal(a.el('navigation-results').hidden, false);
  a.destination('Changed');
  assert.equal(a.el('navigation-results').hidden, true);
  a.calculate(); a.reply(1, 'ZERO_RESULTS');
  assert.equal(a.el('navigation-results').hidden, true);
});

test('next-stop progress saves, restores, moves back, and ends', () => {
  const storage = {};
  const a = setup([], { storage });
  a.add('Middle'); a.calculate(); a.reply(0);
  a.click('start-trip');
  // The start field is the origin, so the first trip stop is the first middle stop.
  assert.equal(a.el('trip-stop-number').textContent, 'Stop 1 of 3');
  assert.equal(a.el('trip-stop-address').textContent, 'Start');
  a.click('navigate-stop');
  assert.equal(new URL(a.opened[0].url).searchParams.get('destination'), 'Start');
  assert.equal(new URL(a.opened[0].url).searchParams.has('origin'), false);
  a.click('trip-next');
  assert.equal(JSON.parse(storage.d7TripProgress).index, 1);
  const restored = setup([], { storage });
  assert.equal(restored.el('trip-panel').hidden, false);
  assert.equal(restored.el('trip-stop-address').textContent, 'Middle');
  restored.click('trip-back');
  assert.equal(JSON.parse(storage.d7TripProgress).index, 0);
  restored.click('end-trip');
  assert.equal(restored.el('trip-panel').hidden, true);
  assert.equal(storage.d7TripProgress, undefined);
  assert.equal(storage.d7SavedRoutes, undefined);
});

test('calculation preserves distance, duration and fuel; destination edits clear results', () => {
  const a = setup(); a.calculate(); a.reply(0);
  assert.match(a.el('route-message').textContent, /10.0 miles • 1 hr 25 min • Est. fuel: \$3.00/);
  a.destination('New end'); a.stale();
  a.calculate(); a.reply(1);
  assert.equal(a.el('route-stale-warning').hidden, true);
  assert.ok(a.renderers[0].map);
});

test('adding and removing stops invalidates displayed results', () => {
  const a = setup(); a.calculate(); a.reply(0);
  a.add('Middle'); a.stale();
  a.calculate(); a.reply(1);
  a.el('stops-container').children[1].children[2].listeners.click();
  a.stale();
});

test('edit then undo while calculating cannot restore an obsolete response', () => {
  const a = setup(); a.calculate();
  a.destination('Changed'); a.destination('End'); a.reply(0); a.stale();
});

test('older success or failure cannot overwrite a newer success', () => {
  for (const status of ['OK', 'ZERO_RESULTS']) {
    const a = setup(); a.calculate(); a.calculate(); a.reply(1);
    const message = a.el('route-message').textContent;
    a.reply(0, status);
    assert.equal(a.el('route-message').textContent, message);
    assert.ok(a.renderers[0].map);
  }
});

test('save feedback does not hide the stale warning; load cancels pending work', () => {
  const a = setup(); a.el('route-name').value = 'Daily'; a.click('save-route');
  a.calculate(); a.reply(0); a.destination('Changed'); a.click('save-route'); a.stale();
  a.calculate(); a.el('saved-route-select').value = 'Daily'; a.click('load-route');
  a.reply(1); a.stale();
});

test('failed recalculation leaves no previous route or totals', () => {
  const a = setup(); a.calculate(); a.reply(0); a.destination('Bad address');
  a.calculate(); a.reply(1, 'ZERO_RESULTS'); a.stale();
  assert.match(a.el('route-message').textContent, /ZERO_RESULTS/);
});

test('optimization still reorders stops and publishes a current route', () => {
  const a = setup(); a.add('A'); a.add('B'); a.click('plan-route');
  assert.equal(a.requests[0].options.optimizeWaypoints, true);
  assert.equal(a.requests[0].options.origin, 'Origin');
  // Middle stops are Start, A, and B. The start field stays the origin.
  a.reply(0, 'OK', [0, 2, 1]);
  assert.equal(a.el('stops-container').children[1].children[1].textContent, 'B');
  assert.equal(a.el('route-stale-warning').hidden, true);
  assert.ok(a.renderers[0].map);
});

test('initial address entry does not claim results are stale', () => {
  const a = setup(); a.add('Middle'); a.destination('Different');
  assert.equal(a.el('route-stale-warning').hidden, true);
});

test('existing route names require confirmation before overwrite', () => {
  const a = setup([false, true]);
  a.el('route-name').value = 'Synthetic Route';
  a.click('save-route');
  a.destination('Changed destination');

  a.click('save-route');
  assert.equal(a.savedRoutes()['Synthetic Route'].destination, 'End');
  assert.equal(a.el('route-message').textContent, 'Route was not overwritten.');

  a.click('save-route');
  assert.equal(a.savedRoutes()['Synthetic Route'].destination, 'Changed destination');
  assert.match(a.confirmationMessages[0], /Replace.*Synthetic Route/);
});

test('delete confirmation removes only the selected saved route', () => {
  const a = setup([false, true]);
  for (const name of ['Synthetic One', 'Synthetic Two']) {
    a.el('route-name').value = name;
    a.click('save-route');
  }

  a.el('saved-route-select').value = 'Synthetic One';
  a.click('delete-route');
  assert.deepEqual(Object.keys(a.savedRoutes()).sort(), ['Synthetic One', 'Synthetic Two']);
  assert.equal(a.el('route-message').textContent, 'Route was not deleted.');

  a.click('delete-route');
  assert.deepEqual(Object.keys(a.savedRoutes()), ['Synthetic Two']);
  assert.match(a.confirmationMessages.at(-1), /Delete.*Synthetic One/);
});

const MAPS_ERROR = "The map couldn't load. The Google Maps API key may not be authorized for this site.";

test('Maps auth failure makes Calculate and Optimize report the error instead of hanging', () => {
  const a = setup();
  a.context.window.gm_authFailure();
  assert.equal(a.el('route-message').textContent, MAPS_ERROR);
  a.calculate();
  assert.equal(a.el('route-message').textContent, MAPS_ERROR);
  a.click('plan-route');
  assert.equal(a.el('route-message').textContent, MAPS_ERROR);
  assert.equal(a.requests.length, 0);
});

test('Maps auth failure during a pending request abandons it', () => {
  const a = setup(); a.calculate();
  a.context.window.gm_authFailure();
  assert.equal(a.el('route-message').textContent, MAPS_ERROR);
  a.reply(0);
  assert.equal(a.el('route-message').textContent, MAPS_ERROR);
  assert.equal(a.renderers[0].map, null);
});

test('Maps script error or load timeout marks maps unavailable', () => {
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /<script[^>]*onerror="handleMapsLoadFailure\(\)"[^>]*maps\.googleapis\.com/);

  const errored = setup([], { init: false });
  vm.runInContext('handleMapsLoadFailure()', errored.context);
  errored.el('start').value = 'Origin';
  errored.add('Start'); errored.destination('End'); errored.calculate();
  assert.equal(errored.el('route-message').textContent, MAPS_ERROR);

  const slow = setup([], { init: false });
  slow.advance(14999);
  assert.equal(slow.el('route-message').textContent, '');
  slow.advance(1);
  assert.equal(slow.el('route-message').textContent, MAPS_ERROR);
  slow.el('start').value = 'Origin';
  slow.add('Start'); slow.destination('End'); slow.calculate();
  assert.equal(slow.el('route-message').textContent, MAPS_ERROR);
  assert.equal(slow.requests.length, 0);

  // A late initMap after a timeout (not an auth failure) restores routing.
  vm.runInContext('initMap()', slow.context);
  slow.calculate(); slow.reply(0);
  assert.match(slow.el('route-message').textContent, /Route optimized/);
});

test('route requests time out after 20 seconds and ignore late responses', () => {
  const a = setup(); a.calculate();
  a.advance(19999);
  assert.equal(a.el('route-message').textContent, 'Optimizing route...');
  a.advance(1);
  assert.equal(a.el('route-message').textContent, 'Route request timed out. Please try again.');
  a.reply(0);
  assert.equal(a.el('route-message').textContent, 'Route request timed out. Please try again.');
  assert.equal(a.renderers[0].map, null);
  // Busy state was reset, so an edit does not claim results are stale.
  a.destination('End');
  assert.equal(a.el('route-stale-warning').hidden, true);
  a.calculate(); a.reply(1);
  assert.match(a.el('route-message').textContent, /Route optimized/);
});

test('a timely route response cancels the timeout', () => {
  const a = setup(); a.calculate(); a.reply(0);
  const message = a.el('route-message').textContent;
  a.advance(20000);
  assert.equal(a.el('route-message').textContent, message);
  assert.ok(a.renderers[0].map);
});

test('start is required, used as the route origin, and not reordered by Optimize', () => {
  const a = setup();
  a.el('start').value = '   ';
  a.calculate();
  assert.equal(a.el('route-message').textContent, 'Enter a starting address.');
  assert.equal(a.requests.length, 0);
  a.click('plan-route');
  assert.equal(a.el('route-message').textContent, 'Enter a starting address.');
  assert.equal(a.requests.length, 0);

  a.el('start').value = 'Depot';
  a.calculate();
  assert.equal(a.requests[0].options.origin, 'Depot');
  assert.equal(a.requests[0].options.destination, 'End');
  assert.deepEqual(
    [...a.requests[0].options.waypoints.map((waypoint) => waypoint.location)],
    ['Start']
  );

  a.add('A');
  a.add('B');
  a.click('plan-route');
  const optimizeRequest = a.requests.at(-1);
  assert.equal(optimizeRequest.options.origin, 'Depot');
  assert.equal(optimizeRequest.options.optimizeWaypoints, true);
  assert.deepEqual(
    [...optimizeRequest.options.waypoints.map((waypoint) => waypoint.location)],
    ['Start', 'A', 'B']
  );
  a.reply(a.requests.length - 1, 'OK', [2, 0, 1]);
  assert.equal(a.el('start').value, 'Depot');
  assert.equal(a.el('stops-container').children[0].children[1].textContent, 'B');
  assert.equal(a.el('stops-container').children[1].children[1].textContent, 'Start');
  assert.equal(a.el('stops-container').children[2].children[1].textContent, 'A');
  assert.equal(a.el('route-stale-warning').hidden, true);
});

test('the stop limit counts only stops between start and destination', () => {
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="start"/);
  assert.match(html, /0 of 20 stops between start and destination/);

  const a = setup();
  assert.match(a.el('stop-counter').textContent, /1 of 20 stops between start and destination/);
  for (let i = 0; i < 19; i += 1) a.add(`Stop ${i}`);
  assert.match(a.el('stop-counter').textContent, /20 of 20 stops between start and destination/);
  assert.equal(a.el('add-stop').disabled, true);
  assert.equal(a.el('stop-input').disabled, true);
  a.el('stop-input').value = 'Extra';
  a.click('add-stop');
  assert.equal(a.el('route-message').textContent, 'You have reached the 20-stop limit.');
  assert.equal(a.el('stops-container').children.length, 20);
  assert.equal(a.el('start').value, 'Origin');
});

test('autocomplete is attached to start, stops including newly added ones, and destination', () => {
  const a = setup();
  const boundTo = (input) => a.autocompletes.some((autocomplete) => autocomplete.input === input);
  assert.equal(boundTo(a.el('start')), true);
  assert.equal(boundTo(a.el('stop-input')), true);
  assert.equal(boundTo(a.el('destination')), true);
  // Stop rows attach lazily on first focus, so re-rendering rows doesn't
  // create a new Autocomplete (and leaked .pac-container) for every row.
  const firstRow = a.el('stops-container').children[0].children[1];
  assert.equal(boundTo(firstRow), false);
  firstRow.listeners.focus();
  assert.equal(boundTo(firstRow), true);

  const before = a.autocompletes.length;
  a.add('Fresh market');
  a.add('Another');
  assert.equal(a.autocompletes.length, before);
  const added = a.el('stops-container').children.at(-1).children[1];
  assert.equal(added.textContent, 'Another');
  for (const item of a.el('stops-container').children) {
    item.children[1].listeners.focus();
    item.children[1].listeners.focus();
    assert.equal(boundTo(item.children[1]), true);
  }
  assert.equal(a.autocompletes.length, before + 3);

  const startAutocomplete = a.autocompletes.find((autocomplete) => autocomplete.input === a.el('start'));
  assert.equal(startAutocomplete.options.strictBounds, false);
  assert.equal(startAutocomplete.options.bounds.north, 42);
  assert.ok(startAutocomplete.options.bounds.south < startAutocomplete.options.bounds.north);
  assert.deepEqual([...startAutocomplete.options.fields], ['formatted_address']);
});

test('picking a suggestion fills in the formatted address', () => {
  const a = setup();
  const pick = (input, formatted) => {
    const autocomplete = [...a.autocompletes].reverse().find((item) => item.input === input);
    autocomplete.place = { formatted_address: formatted };
    autocomplete.listeners.place_changed();
  };

  pick(a.el('start'), '100 Capitol Mall, Sacramento, CA');
  assert.equal(a.el('start').value, '100 Capitol Mall, Sacramento, CA');

  pick(a.el('destination'), '1 Dr Carlton B Goodlett Pl, San Francisco, CA');
  assert.equal(a.el('destination').value, '1 Dr Carlton B Goodlett Pl, San Francisco, CA');

  pick(a.el('stop-input'), '500 J St, Sacramento, CA');
  assert.equal(a.el('stop-input').value, '500 J St, Sacramento, CA');
  a.click('add-stop');
  const added = a.el('stops-container').children.at(-1).children[1];
  assert.equal(added.textContent, '500 J St, Sacramento, CA');

  added.listeners.focus();
  pick(added, '800 K St, Sacramento, CA');
  assert.equal(added.value, '800 K St, Sacramento, CA');
  assert.equal(added.textContent, '800 K St, Sacramento, CA');

  a.el('stop-input').value = 'plain address, no suggestion';
  const addAutocomplete = [...a.autocompletes].reverse()
    .find((item) => item.input === a.el('stop-input'));
  addAutocomplete.place = { name: 'plain address, no suggestion' };
  addAutocomplete.listeners.place_changed();
  assert.equal(a.el('stop-input').value, 'plain address, no suggestion');
});

test('the page still works when Places is missing', () => {
  const a = setup([], { places: false });
  assert.equal(a.autocompletes.length, 0);
  a.el('start').value = 'Depot';
  a.add('Typed stop');
  a.destination('Typed end');
  a.calculate();
  a.reply(0);
  assert.equal(a.requests[0].options.origin, 'Depot');
  assert.match(a.el('route-message').textContent, /Route optimized/);
  assert.equal(a.el('stops-container').children.at(-1).children[1].textContent, 'Typed stop');
});

test('an old saved route without a start uses its first stop as the start', () => {
  const a = setup([], {
    storage: {
      d7SavedRoutes: JSON.stringify({
        Legacy: {
          stops: ['Old Start', 'Mid', 'Late'],
          destination: 'Old End',
          vehicleMpg: '12',
          fuelPrice: '3.25',
        },
      }),
    },
  });
  a.el('saved-route-select').value = 'Legacy';
  a.click('load-route');
  assert.equal(a.el('start').value, 'Old Start');
  assert.equal(a.el('destination').value, 'Old End');
  assert.equal(a.el('vehicle-mpg').value, '12');
  assert.equal(a.el('fuel-price').value, '3.25');
  assert.equal(a.el('stops-container').children.length, 2);
  assert.equal(a.el('stops-container').children[0].children[1].textContent, 'Mid');
  assert.equal(a.el('stops-container').children[1].children[1].textContent, 'Late');

  a.el('route-name').value = 'Current';
  a.el('start').value = 'Depot';
  a.click('save-route');
  assert.equal(a.savedRoutes().Current.start, 'Depot');
  assert.deepEqual([...a.savedRoutes().Current.stops], ['Mid', 'Late']);

  a.el('start').value = 'Changed';
  a.el('saved-route-select').value = 'Current';
  a.click('load-route');
  assert.equal(a.el('start').value, 'Depot');
  assert.equal(a.el('stops-container').children[0].children[1].textContent, 'Mid');
  assert.equal(a.el('stops-container').children.length, 2);
});

test('editing the start clears the result', () => {
  const a = setup();
  a.calculate();
  a.reply(0);
  assert.match(a.el('route-message').textContent, /Route optimized/);
  assert.equal(a.el('navigation-results').hidden, false);
  a.el('start').value = 'New depot';
  a.el('start').listeners.input();
  a.stale();
  assert.equal(a.el('navigation-results').hidden, true);

  a.calculate();
  a.reply(1);
  const startAutocomplete = [...a.autocompletes].reverse()
    .find((item) => item.input === a.el('start'));
  startAutocomplete.place = { formatted_address: '200 I St, Sacramento, CA' };
  startAutocomplete.listeners.place_changed();
  assert.equal(a.el('start').value, '200 I St, Sacramento, CA');
  a.stale();
});

test('Enter in the add-stop field waits while any suggestion dropdown is open', () => {
  const a = setup();
  const hidden = { style: { display: 'none' }, offsetParent: null };
  const open = { style: { display: '' }, offsetParent: {} };
  let pacs = [hidden, open, hidden];
  a.context.document.querySelectorAll = () => pacs;
  const before = a.el('stops-container').children.length;
  a.el('stop-input').value = 'Crocker';
  a.el('stop-input').listeners.keydown({ key: 'Enter' });
  assert.equal(a.el('stops-container').children.length, before);
  pacs = [hidden, hidden, hidden];
  a.el('stop-input').listeners.keydown({ key: 'Enter' });
  assert.equal(a.el('stops-container').children.length, before + 1);
  assert.equal(a.el('stops-container').children.at(-1).children[1].textContent, 'Crocker');
});

test('one Plan Route action optimizes and publishes the complete ordered itinerary', () => {
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="plan-route"[^>]*>Plan Route<\/button>/);
  assert.doesNotMatch(html, /id="(?:calculate|optimize)-route"/);
  assert.equal((html.match(/<details class="panel extra-panel">/g) || []).length, 2);
  const a = setup(); a.add('Second'); a.calculate();
  assert.equal(a.requests[0].options.optimizeWaypoints, true);
  a.reply(0, 'OK', [1, 0]);
  assert.deepEqual(a.el('route-itinerary').children.map(x => x.textContent), [
    'Start: Origin', 'Stop 1: Second', 'Stop 2: Start', 'Finish: End'
  ]);
  a.destination('Changed');
  assert.equal(a.el('navigation-results').hidden, true);
});

test('planning never silently omits an unadded stop', () => {
  const a = setup(); a.el('stop-input').value = 'Unadded address'; a.calculate();
  assert.equal(a.requests.length, 0);
  assert.equal(a.el('route-message').textContent, 'Add your typed stop before planning the route.');
  a.click('add-stop'); a.calculate();
  assert.deepEqual([...a.requests[0].options.waypoints.map(x => x.location)], ['Start', 'Unadded address']);
});

test('malformed optimized order cannot duplicate or lose entered stops', () => {
  for (const order of [[0, 0], [0, 9], [0, 0.5]]) {
    const a = setup(); a.add('Second'); a.calculate(); a.reply(0, 'OK', order);
    assert.deepEqual(a.el('stops-container').children.map(x => x.children[1].value), ['Start', 'Second']);
  }
});
