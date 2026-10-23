const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the actual page script with controlled Maps responses and a minimal DOM.
function setup(confirmations = [], {
  init = true, storage = {}, places = true, navigatorApi = {}, mapTheme = false,
  initialTime = Date.parse('2026-09-28T16:00:00Z')
} = {}) {
  const elements = new Map();
  const downloads = [];
  const blobs = [];
  const fallbackCopies = [];
  let focusedElement = null;
  function element(tagName = 'div') {
    return {
      tagName,
      value: '', textContent: '', hidden: true, children: [], listeners: {},
      className: '', style: {},
      set id(value) { this._id=value; elements.set(value,this); }, get id() { return this._id; },
      set innerHTML(value) { this.children = []; },
      appendChild(child) { this.children.push(child); child.parent = this; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
      click() {
        if (this.tagName === 'a') downloads.push({ href: this.href, download: this.download });
        return this.listeners.click?.();
      },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute(name, value) { this[name] = value; },
      focus() { focusedElement = this; }, select() {}, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); },
    };
  }
  const el = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  el('vehicle-mpg').value = '15';
  el('fuel-price').value = '4.50';
  const requests = [];
  const mapsInstances = [];
  const renderers = [];
  const markerInstances = [];
  const pointInstances = [];
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
    Map: class {
      constructor(container, options) { this.container = container; this.options = options; mapsInstances.push(this); }
      fitBounds(bounds) { this.bounds=bounds; }
    },
    DirectionsService: class { route(options, callback) { requests.push({ options, callback }); } },
    DirectionsRenderer: class {
      constructor(options) { this.options = options; renderers.push(this); }
      setMap(map) { this.map = map; }
      setDirections(result) { this.result = result; }
      setOptions(options) { this.options = { ...this.options, ...options }; }
    },
    Point: class {
      constructor(x, y) { this.x = x; this.y = y; pointInstances.push(this); }
    },
    Marker: class {
      constructor(options) { this.options = options; this.map = options.map; markerInstances.push(this); }
      setMap(map) { this.map = map; }
    },
    LatLngBounds: class {
      constructor(sw,ne) { this.points=[]; if(sw && ne) { this.north=ne.lat; this.south=sw.lat; this.east=ne.lng; this.west=sw.lng; } }
      extend(point) { this.points.push(point); }
      union(bounds) { this.points.push(...bounds.points); }
      isEmpty() { return !this.points.length; }
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
    crypto: require('node:crypto').webcrypto,
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
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/AIza[0-9A-Za-z_-]+/g, 'REDACTED_BROWSER_MAPS_KEY');
  const fuelTag = html.match(/<details\b[^>]*\bid=["']fuel-settings["'][^>]*>/)?.[0] || '';
  el('fuel-settings').open = /\sopen(?:\s|=|>)/.test(fuelTag);
  el('fuel-settings').hidden = /\shidden(?:\s|=|>)/.test(fuelTag);
  if (mapTheme) vm.runInContext(readFileSync(path.join(__dirname, '../map-theme.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(__dirname, '../stop-import.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(__dirname, '../calendar.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(__dirname, '../route-tools.js'), 'utf8'), context);
  if (init) vm.runInContext('initMap()', context);
  const click = id => el(id).listeners.click();
  const add = address => { el('stop-input').value = address; click('add-stop'); };
  const destination = address => { el('destination').value = address; el('destination').listeners.input(); };
  const reply = (index, status = 'OK', order, legs) => {
    const count = requests[index].options.waypoints.length;
    requests[index].callback({ routes: [{
      waypoint_order: order ?? Array.from({ length: count }, (_, i) => i),
      legs: legs ?? Array.from({ length: count + 1 }, () => ({
        distance: { value: 16093.44 / (count + 1) }, duration: { value: 5100 / (count + 1) },
      })),
    }] }, status);
  };
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
    el, click, add, destination, requests, mapsInstances, renderers, markerInstances, pointInstances, reply, calculate, stale,
    savedRoutes, confirmationMessages, advance, context, autocompletes, stored, opened,
    downloads, blobs, fallbackCopies, focused: () => focusedElement,
  };
}

function beginTrip(a) {
  a.calculate(); a.reply(a.requests.length - 1); a.click('start-trip');
}

function calendarEntries(a) { return JSON.parse(a.stored.d7CalendarV1 || '{"entries":[]}').entries; }
function schedule(a, start = '2026-10-21', end = start, name = 'Northern stores') {
  a.click('add-to-calendar');
  a.el('calendar-name').value = name;
  a.el('calendar-start').value = start;
  a.el('calendar-end').value = end;
  a.el('calendar-editor').listeners.submit({ preventDefault() {} });
}
function calendarAction(a, label) {
  return a.el('calendar-entries').children[0].children.at(-1).children.find(item => item.textContent === label).click();
}

test('fuel preference survives reopening with two decimals and ignores invalid edits', () => {
  const a = setup();
  a.el('fuel-price').value = '5.679'; a.el('fuel-price').listeners.change();
  assert.equal(a.el('fuel-price').value, '5.68');
  assert.equal(a.stored.d7FuelPricePreference, '5.68');
  a.el('fuel-price').value = ''; a.el('fuel-price').listeners.change();
  assert.equal(a.stored.d7FuelPricePreference, '5.68');
  const b = setup([], { storage: a.stored });
  assert.equal(b.el('fuel-price').value, '5.68');
  vm.runInContext('localStorage.setItem = () => { throw new Error("Unavailable"); }', b.context);
  b.el('fuel-price').value = '4.2'; b.el('fuel-price').listeners.change();
  assert.equal(b.el('fuel-price').value, '4.20');
  assert.match(b.el('fuel-price-source').textContent, /session/);
});

test('calendar schedules only on explicit submission and retains final order independently', () => {
  const a = setup(); a.add('Second'); a.calculate(); a.reply(0, 'OK', [1, 0]);
  assert.equal(calendarEntries(a).length, 0);
  a.click('add-to-calendar'); a.click('calendar-cancel');
  assert.equal(calendarEntries(a).length, 0);
  schedule(a, '2026-10-21', '2026-10-23');
  const entry = calendarEntries(a)[0];
  assert.deepEqual(entry.route.stops, ['Second', 'Start']);
  assert.equal(a.el('calendar-view').hidden, false);
  assert.match(a.el('calendar-message').textContent, /added/);
  a.add('Later draft edit');
  assert.deepEqual(calendarEntries(a)[0], entry);
  assert.equal(a.stored.d7SavedRoutes, undefined);
  a.click('calendar-day-2026-10-23');
  assert.equal(a.el('calendar-entries').children[0].children[0].textContent, 'Northern stores');
  a.click('calendar-day-2026-10-24');
  assert.match(a.el('calendar-entries').children[0].textContent, /No routes/);
});

test('calendar navigation keeps the planner visible and route edits clear weather choices', () => {
  const a = setup(); a.click('view-calendar');
  assert.equal(a.el('plan-view').hidden, false);
  assert.equal(a.el('calendar-view').hidden, false);
  a.calculate(); a.reply(0, 'OK', undefined, [
    {distance:{value:1000},duration:{value:100},start_location:{lat:38,lng:-121},end_location:{lat:39,lng:-121}},
    {distance:{value:1000},duration:{value:100},start_location:{lat:39,lng:-121},end_location:{lat:40,lng:-121}}
  ]);
  assert.equal(a.el('weather-stop').children.length,3);
  assert.equal(a.el('weather-stop').disabled,false);
  a.destination('A changed finish');
  assert.equal(a.el('weather-stop').disabled,true);
  assert.equal(a.el('check-weather').disabled,true);
});

test('calendar rejects unfinished, stale, duplicate and invalid-date schedules', () => {
  const a = setup();
  schedule(a);
  assert.equal(calendarEntries(a).length, 0);
  a.calculate(); a.reply(0);
  schedule(a, '2026-02-30');
  assert.equal(calendarEntries(a).length, 0);
  schedule(a, '2026-10-23', '2026-10-21');
  assert.equal(calendarEntries(a).length, 0);
  schedule(a); schedule(a);
  assert.equal(calendarEntries(a).length, 1);
  assert.match(a.el('calendar-message').textContent, /already scheduled/);
  a.click('calendar-cancel'); a.destination('Changed finish'); schedule(a, '2026-10-24');
  assert.equal(calendarEntries(a).length, 1);
});

test('calendar survives reopening offline and reloads labels and ordered stops without planning', () => {
  const a = setup();
  vm.runInContext('stopLabels[0]="Store 123"', a.context);
  a.calculate(); a.reply(0); schedule(a);
  const b = setup([], { storage: a.stored, navigatorApi: { onLine: false } });
  b.click('view-calendar'); b.click('calendar-next'); b.click('calendar-day-2026-10-21');
  calendarAction(b, 'Load route');
  assert.equal(b.el('start').value, 'Origin');
  assert.equal(b.el('destination').value, 'End');
  assert.equal(vm.runInContext('stopLabels[0]', b.context), 'Store 123');
  assert.equal(b.requests.length, 0);
  assert.equal(b.el('plan-view').hidden, false);
  assert.match(b.el('route-message').textContent, /Keep My Order/);
});

test('scheduled dates open route details and rescheduling closes the dialog; empty dates stay quiet', () => {
  const a = setup(); a.calculate(); a.reply(0); schedule(a);
  a.click('calendar-day-2026-10-21');
  assert.equal(a.el('calendar-dialog').open, true);
  assert.equal(a.el('calendar-entries').children[0].children[2].open, true);
  calendarAction(a, 'Reschedule');
  assert.equal(a.el('calendar-dialog').open, false);
  a.click('calendar-cancel');
  a.click('calendar-day-2026-10-22');
  assert.equal(a.el('calendar-dialog').open, false);
  assert.match(a.el('calendar-message').textContent, /No routes scheduled/);
  a.click('calendar-day-2026-10-21');
  a.click('calendar-dialog-close');
  assert.equal(a.el('calendar-dialog').open, false);
});

test('calendar rescheduling preserves route and entry identity, removal does not touch saves', () => {
  const a = setup(); a.calculate(); a.reply(0); schedule(a);
  const before = calendarEntries(a)[0];
  a.stored.d7SavedRoutes = '{"untouched":true}';
  calendarAction(a, 'Reschedule');
  a.el('calendar-start').value = '2026-11-01'; a.el('calendar-end').value = '2026-11-03';
  a.el('calendar-editor').listeners.submit({ preventDefault() {} });
  const after = calendarEntries(a)[0];
  assert.equal(after.id, before.id); assert.deepEqual(after.route, before.route);
  assert.equal(after.startDate, '2026-11-01'); assert.equal(calendarEntries(a).length, 1);
  calendarAction(a, 'Remove');
  assert.equal(calendarEntries(a).length, 0);
  assert.equal(a.stored.d7SavedRoutes, '{"untouched":true}');
});

test('calendar storage failures preserve existing entries and unsaved editor', () => {
  const a = setup(); a.calculate(); a.reply(0); schedule(a);
  const before = a.stored.d7CalendarV1;
  calendarAction(a, 'Reschedule');
  a.el('calendar-start').value = '2026-10-22'; a.el('calendar-end').value = '2026-10-22';
  vm.runInContext('localStorage.setItem = () => { throw new Error("Storage full"); }', a.context);
  a.el('calendar-editor').listeners.submit({ preventDefault() {} });
  assert.equal(a.stored.d7CalendarV1, before);
  assert.equal(a.el('calendar-editor').hidden, false);
  assert.match(a.el('calendar-message').textContent, /Could not save/);
});

test('calendar does not overwrite malformed storage or concurrent reschedules', () => {
  const a = setup(); a.calculate(); a.reply(0); schedule(a);
  calendarAction(a, 'Reschedule');
  const changed = JSON.parse(a.stored.d7CalendarV1);
  changed.entries[0].name = 'Changed in another tab';
  a.stored.d7CalendarV1 = JSON.stringify(changed);
  a.el('calendar-editor').listeners.submit({ preventDefault() {} });
  assert.match(a.el('calendar-message').textContent, /another tab/);
  assert.equal(calendarEntries(a)[0].name, 'Changed in another tab');
  a.stored.d7CalendarV1 = '{invalid'; a.click('view-calendar');
  assert.match(a.el('calendar-message').textContent, /Could not open/);
  assert.equal(a.stored.d7CalendarV1, '{invalid');
});

test('calendar month navigation handles leap days and December rollover', () => {
  const a = setup(); a.calculate(); a.reply(0); schedule(a, '2028-02-29');
  assert.equal(a.el('calendar-day-2028-02-29').textContent, '29');
  assert.match(a.el('calendar-month').textContent, /2028/);
  schedule(a, '2028-12-31'); a.click('calendar-next');
  assert.match(a.el('calendar-month').textContent, /2029/);
  a.click('calendar-previous');
  assert.equal(a.el('calendar-day-2028-12-31').textContent, '31');
});

test('calendar load cancellation and active trips protect current planner', () => {
  const a = setup([false]); a.calculate(); a.reply(0); schedule(a);
  a.destination('Unsaved draft'); calendarAction(a, 'Load route');
  assert.equal(a.el('destination').value, 'Unsaved draft');
  a.calculate(); a.reply(1); a.click('start-trip');
  calendarAction(a, 'Load route');
  assert.match(a.el('calendar-message').textContent, /active trip/);
  assert.equal(a.el('destination').value, 'Unsaved draft');
});

function bulkStops(a,count) {
  const names=Array.from({length:count},(_,i)=>`Stop ${i+1}`);
  vm.runInContext(`stops.splice(0,stops.length,...${JSON.stringify(names)});stopLabels.splice(0,stopLabels.length,...stops.map((_,i)=>'Store '+(i+1)));stopFirst.splice(0,stopFirst.length,...stops.map(()=>false));renderStops();`,a.context);
  return names;
}
function routeCoordinate(address) {
  const n=Number(String(address).match(/^Stop (\d+)$/)?.[1]);
  if(n)return {lat:30+(n%50)*.4,lng:-120+Math.floor(n/50)*.5};
  return address==='Origin'?{lat:32,lng:-123}:{lat:28,lng:-115};
}
function replyWithCoordinates(a,index,{cost=1,reverse=false}={}) {
  const request=a.requests[index],count=request.options.waypoints.length;
  const order=Array.from({length:count},(_,i)=>reverse && request.options.optimizeWaypoints?count-1-i:i);
  const addresses=[request.options.origin,...order.map(i=>request.options.waypoints[i].location),request.options.destination];
  a.reply(index,'OK',order,addresses.slice(1).map((to,i)=>({
    start_location:routeCoordinate(addresses[i]),end_location:routeCoordinate(to),
    distance:{value:1609.344*cost},duration:{value:60*cost}
  })));
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
  a.reply(0, 'OK', [0], [
    { distance: { value: 13975.9 }, duration: { value: 950.5 } },
    { distance: { value: 13975.9 }, duration: { value: 950.5 } },
  ]);
  assert.match(a.el('route-message').textContent, /17.4 miles .* Est. fuel: \$5.22/);
  a.click('start-trip');
  assert.equal(JSON.parse(a.stored.d7TripProgress).routeSnapshot.fuelCost.toFixed(2), '5.22');
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/AIza[0-9A-Za-z_-]+/g, 'REDACTED_BROWSER_MAPS_KEY');
  assert.match(readFileSync(path.join(__dirname, '../styles.css'), 'utf8'), /#map button \{ min-height: 0; \}/);
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
  a.click('calculate-route');
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
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/AIza[0-9A-Za-z_-]+/g, 'REDACTED_BROWSER_MAPS_KEY');
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
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/AIza[0-9A-Za-z_-]+/g, 'REDACTED_BROWSER_MAPS_KEY');
  assert.match(html, /id="start"/);
  assert.match(html, /0 of 500 stops between start and destination/);

  const a = setup();
  assert.match(a.el('stop-counter').textContent, /1 of 500 stops between start and destination/);
  for (let i = 0; i < 499; i += 1) a.add(`Stop ${i}`);
  assert.match(a.el('stop-counter').textContent, /500 of 500 stops between start and destination/);
  assert.equal(a.el('add-stop').disabled, true);
  assert.equal(a.el('stop-input').disabled, true);
  a.el('stop-input').value = 'Extra';
  a.click('add-stop');
  assert.equal(a.el('route-message').textContent, 'You have reached the 500-stop limit.');
  assert.equal(a.el('stops-container').children.length, 500);
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

test('Optimize Route publishes the complete ordered itinerary', () => {
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
    assert.equal(a.el('navigation-results').hidden, true);
    assert.match(a.el('route-message').textContent, /invalid optimized stop order/);
  }
});

test('all 20 stops are optimized together before navigation is split', () => {
  const a = setup();
  for (let i = 2; i <= 20; i++) a.add(`Stop ${i}`);
  a.calculate();
  assert.equal(a.requests.length, 1);
  assert.equal(a.requests[0].options.waypoints.length, 20);
  assert.equal(a.requests[0].options.optimizeWaypoints, true);
  // Moves stops across both navigation boundaries, rather than optimizing groups.
  const order = Array.from({ length: 20 }, (_, i) => 19 - i);
  a.reply(0, 'OK', order);
  const expected = ['Origin', ...order.map(i => i === 0 ? 'Start' : `Stop ${i + 1}`), 'End'];
  const recovered = [];
  for (const button of a.el('navigation-controls').children) button.listeners.click();
  a.opened.forEach((item, index) => {
    const url = new URL(item.url);
    if (index === 0) recovered.push(url.searchParams.get('origin'));
    else assert.equal(url.searchParams.get('origin'), recovered.at(-1));
    recovered.push(...(url.searchParams.get('waypoints') || '').split('|').filter(Boolean));
    recovered.push(url.searchParams.get('destination'));
  });
  assert.deepEqual(recovered, expected);
  a.click('start-trip');
  const snapshot = JSON.parse(a.stored.d7TripProgress).routeSnapshot;
  assert.deepEqual(snapshot.stops, expected.slice(1, -1));
  assert.equal(snapshot.legs.length, 21);
  assert.equal(snapshot.legs[0].to, 'Stop 20');
  assert.equal(snapshot.legs.at(-1).from, 'Start');
});

test('mobile and iPad navigation respect the three-waypoint browser limit', () => {
  for (const navigatorApi of [
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' },
    { userAgent: 'Mozilla/5.0 (Linux; Android 15)' },
    { userAgent: 'Mozilla/5.0 Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 },
  ]) {
    const a = setup([], { navigatorApi });
    for (let i = 2; i <= 20; i++) a.add(`Stop ${i}`);
    a.calculate(); a.reply(0);
    const points = ['Origin'];
    assert.equal(a.el('navigation-controls').children.length, 6);
    for (const button of a.el('navigation-controls').children) {
      button.listeners.click();
      const url = new URL(a.opened.at(-1).url);
      assert.equal(url.searchParams.get('origin'), points.at(-1));
      const waypoints = (url.searchParams.get('waypoints') || '').split('|').filter(Boolean);
      assert.ok(waypoints.length <= 3);
      points.push(...waypoints, url.searchParams.get('destination'));
    }
    assert.deepEqual(points, ['Origin', 'Start', ...Array.from({length:19},(_,i)=>`Stop ${i+2}`), 'End']);
  }
});

test('incomplete or malformed Maps results never publish navigation or totals', () => {
  for (const result of [null, { routes: [] }, { routes: [{}] },
    { routes: [{ waypoint_order: [0], legs: [] }] },
    { routes: [{ waypoint_order: [0], legs: [{ distance: { value: NaN }, duration: { value: 10 } }, {}] }] }]) {
    const a = setup(); a.calculate();
    assert.doesNotThrow(() => a.requests[0].callback(result, 'OK'));
    assert.equal(a.el('navigation-results').hidden, true);
    assert.match(a.el('route-message').textContent, /incomplete route result/);
    a.click('start-trip');
    assert.equal(a.stored.d7TripProgress, undefined);
  }
});

test('offline planning makes no Maps request while saved routes remain loadable', () => {
  const a = setup([], { navigatorApi: { onLine: false } });
  a.el('route-name').value = 'Offline route'; a.click('save-route');
  a.calculate();
  assert.equal(a.requests.length, 0);
  assert.match(a.el('route-message').textContent, /offline/);
  a.el('saved-route-select').value = 'Offline route'; a.click('load-route');
  assert.equal(a.el('start').value, 'Origin');
  assert.equal(a.el('destination').value, 'End');
  assert.match(a.el('offline-status').textContent, /Connect/);
});

test('Maps authorization failure restores plain-text editing and respects the stop limit', () => {
  const a = setup();
  a.context.window.gm_authFailure();
  for (const id of ['start', 'destination', 'stop-input']) {
    a.el(id).disabled = true;
    a.el(id).style.backgroundImage = 'url(maps-error.png)';
  }
  a.el('stops-container').children[0].children[1].disabled = true;
  a.advance(0);
  for (const id of ['start', 'destination', 'stop-input']) {
    assert.equal(a.el(id).disabled, false);
    assert.equal(a.el(id).style.backgroundImage, 'none');
  }
  assert.equal(a.el('stops-container').children[0].children[1].disabled, false);
  for (let i = 2; i <= 500; i++) a.add(`Stop ${i}`);
  a.context.window.gm_authFailure(); a.advance(0);
  assert.equal(a.el('stop-input').disabled, true);
  assert.equal(a.el('start').disabled, false);
  a.el('route-name').value = 'Maps unavailable'; a.click('save-route');
  assert.ok(a.savedRoutes()['Maps unavailable']);
});

function backupFile(a, value, size) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  a.el('import-routes-file').files = [{ size: size ?? Buffer.byteLength(text), text: async () => text }];
  return a.el('import-routes-file').listeners.change();
}

function backup(routes) { return { format: 'd7-route-backup', version: 1, routes }; }
function savedRoute(start = 'Depot') {
  return { start, stops: ['Customer & <Gate>'], destination: 'Finish #2', vehicleMpg: '12', fuelPrice: '4.25' };
}

test('saved routes export and import round-trip across devices without changing the working route', async () => {
  const a = setup(); a.el('route-name').value = 'Monday'; a.click('save-route');
  a.click('export-routes');
  const exported = JSON.parse(await a.blobs[0].text());
  assert.equal(exported.format, 'd7-route-backup');
  assert.equal(exported.version, 1);
  assert.equal(exported.exportedAt, '2026-09-28T16:00:00.000Z');
  assert.equal(a.downloads[0].download, 'd7-saved-routes-2026-09-28.json');
  assert.equal(a.blobs[0].type, 'application/json');
  const b = setup(); b.calculate(); b.reply(0);
  await backupFile(b, exported);
  assert.deepEqual(b.savedRoutes(), a.savedRoutes());
  assert.equal(b.el('navigation-results').hidden, false);
  assert.equal(b.el('start').value, 'Origin');
  b.el('saved-route-select').value = 'Monday'; b.click('load-route');
  assert.equal(b.el('navigation-results').hidden, true);
  assert.equal(b.el('start').value, 'Origin');
  assert.equal(b.el('destination').value, 'End');
});

test('imports merge new routes and require confirmation before replacing collisions', async () => {
  const a = setup([false, true], { storage: { d7SavedRoutes: JSON.stringify({
    Monday: savedRoute('Original'), Keep: savedRoute('Keep'),
  }) } });
  const incoming = backup({ Monday: savedRoute('Replacement'), New: savedRoute('New') });
  const original = a.stored.d7SavedRoutes;
  await backupFile(a, incoming);
  assert.equal(a.stored.d7SavedRoutes, original);
  assert.match(a.el('backup-message').textContent, /cancelled/);
  await backupFile(a, incoming);
  assert.equal(a.savedRoutes().Monday.start, 'Replacement');
  assert.equal(a.savedRoutes().Keep.start, 'Keep');
  assert.equal(a.savedRoutes().New.start, 'New');
  assert.equal(a.confirmationMessages.length, 2);
  assert.equal(a.el('import-routes-file').value, '');
});

test('invalid and oversized backups never change saved routes', async () => {
  const a = setup([], { storage: { d7SavedRoutes: JSON.stringify({ Keep: savedRoute() }) } });
  const original = a.stored.d7SavedRoutes;
  for (const invalid of [
    'not json', null, { format: 'd7-route-backup', version: 2, routes: {} },
    backup([]), backup({}), backup({ Bad: { ...savedRoute(), stops: [''] } }),
    backup({ Bad: { ...savedRoute(), stops: Array(501).fill('Address') } }),
    backup({ Bad: { ...savedRoute(), destination: '<'.repeat(513) } }),
    backup({ Bad: { ...savedRoute(), fuelPrice: 'Infinity' } }),
    backup({ Bad: { ...savedRoute(), start: {} } }),
  ]) {
    await backupFile(a, invalid);
    assert.equal(a.stored.d7SavedRoutes, original);
    assert.match(a.el('backup-message').textContent, /^Could not import/);
  }
  await backupFile(a, backup({ New: savedRoute() }), 1024 * 1024 + 1);
  assert.equal(a.stored.d7SavedRoutes, original);
  assert.match(a.el('backup-message').textContent, /1 MB/);
});

test('legacy backups migrate the first stop to the start without losing addresses', async () => {
  const a = setup();
  await backupFile(a, backup({ Legacy: { stops: ['Old depot', 'Middle'], destination: 'Finish' } }));
  assert.deepEqual(a.savedRoutes().Legacy, {
    start: 'Old depot', stops: ['Middle'], destination: 'Finish', vehicleMpg: '15', fuelPrice: '4.50',
  });
});

test('unusual route names and markup stay data without prototype pollution', async () => {
  const a = setup();
  a.el('route-name').value = '__proto__'; a.click('save-route');
  assert.equal(Object.hasOwn(a.savedRoutes(), '__proto__'), true);
  const routes = Object.create(null);
  routes.constructor = savedRoute('Constructor depot');
  routes['<img src=x onerror=alert(1)>'] = savedRoute();
  await backupFile(a, backup(routes));
  assert.equal(a.savedRoutes().constructor.start, 'Constructor depot');
  assert.equal(Object.prototype.start, undefined);
  assert.ok(a.el('saved-route-select').children.some(option => option.textContent === '<img src=x onerror=alert(1)>'));
});

test('failed writes and corrupt existing storage keep backups atomic', async () => {
  const a = setup([], { storage: { d7SavedRoutes: JSON.stringify({ Keep: savedRoute() }) } });
  const original = a.stored.d7SavedRoutes;
  a.context.localStorage.setItem = () => { throw new Error('Storage full'); };
  await backupFile(a, backup({ New: savedRoute() }));
  assert.equal(a.stored.d7SavedRoutes, original);
  assert.match(a.el('backup-message').textContent, /Storage full/);
  a.stored.d7SavedRoutes = 'corrupt';
  await backupFile(a, backup({ New: savedRoute() }));
  assert.equal(a.stored.d7SavedRoutes, 'corrupt');
  a.click('export-routes');
  assert.equal(a.downloads.length, 0);
  assert.match(a.el('backup-message').textContent, /Could not export/);
});

test('a delayed older file read cannot overwrite a newer import', async () => {
  const a = setup(); let resolve;
  a.el('import-routes-file').files = [{ size: 1, text: () => new Promise(r => { resolve = r; }) }];
  const pending = a.el('import-routes-file').listeners.change();
  await backupFile(a, backup({ New: savedRoute() }));
  resolve(JSON.stringify(backup({ Old: savedRoute() }))); await pending;
  assert.deepEqual(Object.keys(a.savedRoutes()), ['New']);
});

test('late Finish place details resume a pending plan with normalized input', () => {
  const a = setup(); a.destination('200 Santa Monica Pier Santa Monica CA'); a.calculate();
  const autocomplete = a.autocompletes.find(x => x.input === a.el('destination'));
  autocomplete.place = { formatted_address: '200 Santa Monica Pier, Santa Monica, CA 90401, USA' };
  autocomplete.listeners.place_changed();
  assert.equal(a.requests.length, 2);
  assert.equal(a.requests[1].options.destination, autocomplete.place.formatted_address);
  assert.equal(a.requests[1].options.origin, 'Origin');
  assert.equal(a.requests[1].options.optimizeWaypoints, true);
  a.reply(0); // Old response must never publish.
  assert.equal(a.el('navigation-results').hidden, true);
  a.reply(1);
  assert.equal(a.el('navigation-results').hidden, false);
  assert.equal(a.el('route-stale-warning').hidden, true);
  assert.equal(a.el('route-itinerary').children.at(-1).textContent, 'Finish: ' + autocomplete.place.formatted_address);
});

test('manual edits after Plan cancel automatic continuation from late place details', () => {
  const a = setup(); a.calculate(); a.destination('User changed destination');
  const autocomplete = a.autocompletes.find(x => x.input === a.el('destination'));
  autocomplete.place = { formatted_address: 'Normalized changed destination' };
  autocomplete.listeners.place_changed();
  assert.equal(a.requests.length, 1);
  a.reply(0);
  assert.equal(a.el('navigation-results').hidden, true);
  assert.equal(a.el('route-stale-warning').hidden, false);
});

test('late Start and stop place details also preserve pending planning intent', () => {
  for (const target of ['start', 'stop']) {
    const a = setup();
    const input = target === 'start' ? a.el('start') : a.el('stops-container').children[0].children[1];
    if (target === 'stop') input.listeners.focus();
    a.calculate();
    const autocomplete = a.autocompletes.find(x => x.input === input);
    autocomplete.place = { formatted_address: 'Normalized address' };
    autocomplete.listeners.place_changed();
    assert.equal(a.requests.length, 2);
    assert.equal(target === 'start' ? a.requests[1].options.origin : a.requests[1].options.waypoints[0].location, 'Normalized address');
    a.reply(1); a.reply(0);
    assert.equal(a.el('navigation-results').hidden, false);
  }
});

test('Calculate Route preserves entered stop order without requesting optimization', () => {
  const a = setup(); a.add('Second'); a.click('calculate-route');
  assert.equal(a.requests.length, 1);
  assert.equal(a.requests[0].options.optimizeWaypoints, false);
  assert.deepEqual([...a.requests[0].options.waypoints.map(point => point.location)], ['Start', 'Second']);
  // A provider permutation is irrelevant when calculating the entered order.
  a.reply(0, 'OK', [1, 0]);
  assert.deepEqual(a.el('stops-container').children.map(row => row.children[1].value), ['Start', 'Second']);
  assert.deepEqual(a.el('route-itinerary').children.map(item => item.textContent), [
    'Start: Origin', 'Stop 1: Start', 'Stop 2: Second', 'Finish: End',
  ]);
  assert.match(a.el('route-message').textContent, /^Route calculated:/);
  a.click('start-trip');
  assert.deepEqual(JSON.parse(a.stored.d7TripProgress).routeSnapshot.stops, ['Start', 'Second']);
});

test('late Places details preserve Calculate Route mode and discard its old response', () => {
  for (const target of ['start', 'destination', 'stop']) {
    const a = setup();
    const input = target === 'stop' ? a.el('stops-container').children[0].children[1] : a.el(target);
    if (target === 'stop') input.listeners.focus();
    a.click('calculate-route');
    const autocomplete = a.autocompletes.find(item => item.input === input);
    autocomplete.place = { formatted_address: 'Normalized ' + target };
    autocomplete.listeners.place_changed();
    assert.equal(a.requests.length, 2, `Expected resumed calculation for ${target}`);
    assert.equal(a.requests[0].options.optimizeWaypoints, false);
    assert.equal(a.requests[1].options.optimizeWaypoints, false);
    const nextAddress = target === 'stop' ? a.requests[1].options.waypoints[0].location :
      a.requests[1].options[target === 'start' ? 'origin' : 'destination'];
    assert.equal(nextAddress, 'Normalized ' + target);
    a.reply(0);
    assert.equal(a.el('navigation-results').hidden, true);
    a.reply(1);
    assert.equal(a.el('navigation-results').hidden, false);
    assert.match(a.el('route-message').textContent, /^Route calculated:/);
  }
});

test('Calculate and Optimize both refuse to omit an unadded typed stop', () => {
  for (const action of ['calculate-route', 'plan-route']) {
    const a = setup(); a.el('stop-input').value = 'Unadded address';
    a.click(action);
    assert.equal(a.requests.length, 0, `${action} must not send an incomplete route`);
    assert.match(a.el('route-message').textContent, /Add your typed stop/);
  }
});

test('Plan, Saved routes, and Reports navigation reveals exactly one working view', () => {
  const a = setup();
  function expectView(selected) {
    for (const name of ['plan', 'saved', 'reports']) {
      assert.equal(a.el(name + '-view').hidden, name !== selected, `Unexpected ${name} view visibility`);
      assert.equal(a.el('view-' + name)['aria-current'], name === selected ? 'page' : 'false');
    }
    assert.equal(a.el('journey-controls').hidden, selected !== 'plan');
  }
  expectView('plan');
  a.el('start').value = 'Draft origin';
  a.el('route-name').value = 'Draft name';
  a.click('view-saved'); expectView('saved');
  a.click('view-reports'); expectView('reports');
  a.click('view-plan'); expectView('plan');
  assert.equal(a.el('start').value, 'Draft origin');
  assert.equal(a.el('route-name').value, 'Draft name');
  assert.equal(a.el('stops-container').children[0].children[1].value, 'Start');
});

test('Home and Skip reveal Plan and focus its visible heading from other views', () => {
  for (const link of ['home-link', 'skip-link']) {
    for (const sourceView of ['saved', 'reports']) {
      for (const activeTrip of [false, true]) {
        const a = setup();
        if (activeTrip) beginTrip(a);
        a.click('view-' + sourceView);
        assert.equal(a.el('plan-view').hidden, true);
        let defaultPrevented = false;
        a.el(link).listeners.click({ preventDefault() { defaultPrevented = true; } });
        assert.equal(defaultPrevented, true, `${link} must reveal the destination before focusing it`);
        assert.equal(a.el('plan-view').hidden, false);
        assert.equal(a.el('saved-view').hidden, true);
        assert.equal(a.el('reports-view').hidden, true);
        assert.equal(a.el('journey-controls').hidden, false);
        assert.equal(a.el('planner-fields').hidden, activeTrip);
        assert.equal(a.el('trip-panel').hidden, !activeTrip);
        assert.equal(a.focused(), a.el(activeTrip ? 'trip-heading' : 'route-heading'),
          `${link} must focus a visible heading for the current Plan state`);
      }
    }
  }
});

test('the Fuel shortcut opens Plan from other views and mirrors disclosure state', () => {
  for (const sourceView of ['saved', 'reports']) {
    const a = setup(); const fuel = a.el('fuel-settings');
    assert.equal(fuel.open, true, 'Fuel details starts open as declared in markup');
    assert.equal(a.el('view-fuel')['aria-expanded'], 'true');
    fuel.open = false; fuel.listeners.toggle();
    assert.equal(a.el('view-fuel')['aria-expanded'], 'false');

    a.click('view-' + sourceView); a.click('view-fuel');
    // Native details dispatches toggle when its open property changes.
    fuel.listeners.toggle();
    assert.equal(a.el('plan-view').hidden, false);
    assert.equal(a.el('saved-view').hidden, true);
    assert.equal(a.el('reports-view').hidden, true);
    assert.equal(fuel.hidden, false);
    assert.equal(fuel.open, true);
    assert.equal(a.el('view-fuel')['aria-expanded'], 'true');
    assert.equal(a.focused(), a.el('vehicle-mpg'));

    fuel.open = false; fuel.listeners.toggle();
    assert.equal(a.el('view-fuel')['aria-expanded'], 'false');
  }
});

test('active and restored trips hide planning actions while Fuel access preserves the trip snapshot', () => {
  for (const restored of [false, true]) {
    const original = setup(); beginTrip(original);
    const savedProgress = original.stored.d7TripProgress;
    const a = restored ? setup([], { storage: original.stored, init: false }) : original;
    assert.equal(a.el('plan-view').hidden, false);
    assert.equal(a.el('trip-panel').hidden, false);
    assert.equal(a.el('planner-fields').hidden, true);
    assert.equal(a.el('planner-actions').hidden, true);
    assert.equal(a.el('fuel-settings').open, false);
    a.el('fuel-settings').listeners.toggle();
    assert.equal(a.el('view-fuel')['aria-expanded'], 'false');

    a.click(restored ? 'view-reports' : 'view-saved'); a.click('view-fuel');
    a.el('fuel-settings').listeners.toggle();
    assert.equal(a.el('plan-view').hidden, false);
    assert.equal(a.el('fuel-settings').hidden, false);
    assert.equal(a.el('fuel-settings').open, true);
    assert.equal(a.focused(), a.el('vehicle-mpg'));
    assert.equal(a.el('planner-fields').hidden, true);
    assert.equal(a.el('planner-actions').hidden, true);
    assert.equal(a.el('trip-panel').hidden, false);
    assert.equal(a.el('navigation-results').hidden, true);

    a.el('vehicle-mpg').value = '30'; a.el('fuel-price').value = '5';
    a.el('vehicle-mpg').listeners.input?.(); a.el('fuel-price').listeners.input?.();
    assert.equal(a.stored.d7TripProgress, savedProgress, 'Editing current settings must not alter active-trip evidence');
    a.click('trip-next'); a.click('trip-next'); a.click('finish-trip');
    assert.deepEqual(JSON.parse(a.stored.d7TripReports)[0].routeSnapshot,
      JSON.parse(savedProgress).routeSnapshot);
    assert.equal(a.el('planner-fields').hidden, false);
    assert.equal(a.el('planner-actions').hidden, false);
  }
});

test('fuel edits refresh a current estimate without replanning or changing the selected stop order', () => {
  for (const action of ['plan-route', 'calculate-route']) {
    const a = setup(); a.add('Second'); a.click(action); a.reply(0, 'OK', [1, 0]);
    vm.runInContext('presentRouteReadout()', a.context);
    assert.equal(a.el('stat-fuel').textContent, '$3.00');
    const rows = a.el('stops-container').children.map(row => row.children[1].value);
    const itinerary = a.el('route-itinerary').children.map(item => item.textContent);
    const miles = a.el('stat-miles').textContent;
    const duration = a.el('stat-duration').textContent;
    const resultPrefix = action === 'plan-route' ? /^Route optimized:/ : /^Route calculated:/;

    a.el('vehicle-mpg').value = '20'; a.el('vehicle-mpg').listeners.input();
    assert.equal(a.el('stat-fuel').textContent, '$2.25');
    assert.match(a.el('route-message').textContent, resultPrefix);
    assert.match(a.el('route-message').textContent, /Est\. fuel: \$2\.25$/);
    a.el('fuel-price').value = '6'; a.el('fuel-price').listeners.input();
    assert.equal(a.el('stat-fuel').textContent, '$3.00');
    assert.match(a.el('route-message').textContent, /Est\. fuel: \$3\.00$/);
    assert.equal(a.requests.length, 1);
    assert.deepEqual(a.el('stops-container').children.map(row => row.children[1].value), rows);
    assert.deepEqual(a.el('route-itinerary').children.map(item => item.textContent), itinerary);
    assert.equal(a.el('stat-miles').textContent, miles);
    assert.equal(a.el('stat-duration').textContent, duration);
    assert.equal(a.el('navigation-results').hidden, false);
    a.click('start-trip');
    const snapshot = JSON.parse(a.stored.d7TripProgress).routeSnapshot;
    assert.equal(snapshot.mpg, 20);
    assert.equal(snapshot.fuelPrice, 6);
    assert.equal(snapshot.fuelCost, 3);
  }
});

test('fuel edits preserve saved-route feedback while updating the current valid estimate', () => {
  const a = setup(); a.calculate(); a.reply(0); vm.runInContext('presentRouteReadout()', a.context);
  a.el('route-name').value = 'Saved draft'; a.click('save-route');
  const notice = a.el('route-message').textContent;
  assert.equal(notice, 'Route saved: Saved draft.');
  a.el('vehicle-mpg').value = '20'; a.el('vehicle-mpg').listeners.input();
  assert.equal(a.el('stat-fuel').textContent, '$2.25');
  assert.equal(a.el('route-message').textContent, notice);
  vm.runInContext('presentRouteReadout()', a.context);
  assert.equal(a.el('stat-fuel').textContent, '$2.25');
  assert.equal(a.requests.length, 1);
});

test('invalid and overflowing fuel inputs never publish nonfinite estimates or trip fuel costs', () => {
  for (const [mpg, price] of [
    ['0', '4.50'], ['-1', '4.50'], ['', '4.50'], ['Infinity', '4.50'],
    ['15', '0'], ['15', '-1'], ['15', 'not-a-number'], ['15', 'Infinity'],
    ['5e-324', '1.7976931348623157e308'],
  ]) {
    const a = setup(); a.el('vehicle-mpg').value = mpg; a.el('fuel-price').value = price;
    a.calculate(); a.reply(0); vm.runInContext('presentRouteReadout()', a.context);
    assert.equal(a.el('stat-fuel').textContent, '—', `Invalid estimate for MPG ${mpg}, price ${price}`);
    assert.doesNotMatch(a.el('route-message').textContent, /Est\. fuel|Infinity|NaN/);
    assert.equal(a.el('stat-miles').textContent, '10.0');
    // Check both the response path and subsequent edits of an existing plan.
    a.el('vehicle-mpg').value = '15'; a.el('fuel-price').value = '4.50';
    a.el('vehicle-mpg').listeners.input();
    assert.equal(a.el('stat-fuel').textContent, '$3.00');
    a.el('vehicle-mpg').value = mpg; a.el('fuel-price').value = price;
    a.el('fuel-price').listeners.input();
    assert.equal(a.el('stat-fuel').textContent, '—');
    assert.doesNotMatch(a.el('route-message').textContent, /Est\. fuel|Infinity|NaN/);
    assert.equal(a.requests.length, 1);
    a.click('start-trip');
    // Inspect the live snapshot as well as JSON: JSON would mask Infinity as null.
    assert.equal(vm.runInContext('tripProgress.routeSnapshot.fuelCost', a.context), null);
    assert.equal(JSON.parse(a.stored.d7TripProgress).routeSnapshot.fuelCost, null);
  }
});

test('fuel edits do not recreate estimates without a current completed route', () => {
  for (const state of ['initial', 'stale', 'pending', 'failed']) {
    const a = setup();
    if (state !== 'initial') {
      a.calculate(); a.reply(0); vm.runInContext('presentRouteReadout()', a.context);
      if (state === 'stale') a.destination('Edited destination');
      else {
        a.calculate();
        if (state === 'failed') a.reply(1, 'ZERO_RESULTS');
      }
      vm.runInContext('presentRouteReadout()', a.context);
    }
    const requests = a.requests.length;
    const notice = a.el('route-message').textContent;
    a.el('vehicle-mpg').value = '20'; a.el('fuel-price').value = '6';
    a.el('vehicle-mpg').listeners.input(); a.el('fuel-price').listeners.input();
    assert.equal(a.el('stat-fuel').textContent, '—', `${state} must not recreate a fuel estimate`);
    assert.equal(a.el('stat-miles').textContent, '—');
    assert.equal(a.el('stat-duration').textContent, '—');
    assert.equal(a.el('route-message').textContent, notice);
    assert.equal(a.requests.length, requests);
  }
});

test('active-trip fuel edits preserve the displayed estimate and the recorded snapshot', () => {
  const a = setup(); a.calculate(); a.reply(0); vm.runInContext('presentRouteReadout()', a.context);
  a.click('start-trip');
  const progress = a.stored.d7TripProgress;
  const notice = a.el('route-message').textContent;
  assert.equal(a.el('stat-fuel').textContent, '$3.00');
  a.click('view-fuel');
  a.el('vehicle-mpg').value = '20'; a.el('fuel-price').value = '8';
  a.el('vehicle-mpg').listeners.input(); a.el('fuel-price').listeners.input();
  assert.equal(a.el('stat-fuel').textContent, '$3.00');
  assert.equal(a.el('route-message').textContent, notice);
  assert.equal(a.stored.d7TripProgress, progress);
  assert.equal(vm.runInContext('tripProgress.routeSnapshot.fuelCost', a.context), 3);
  assert.equal(a.requests.length, 1);
});

test('an active trip hides planning navigation and ending it restores the planned controls', () => {
  const a = setup(); a.calculate(); a.reply(0);
  assert.equal(a.el('navigation-results').hidden, false);
  a.click('start-trip');
  assert.equal(a.el('trip-panel').hidden, false);
  assert.equal(a.el('navigation-results').hidden, true);
  assert.equal(a.el('planner-fields').hidden, true);
  assert.equal(a.el('plan-view').hidden, false);
  a.click('end-trip');
  assert.equal(a.el('trip-panel').hidden, true);
  assert.equal(a.el('navigation-results').hidden, false);
  assert.equal(a.el('planner-fields').hidden, false);
  assert.equal(a.el('reports-view').hidden, false);
  assert.equal(a.el('plan-view').hidden, true);
  assert.equal(a.el('journey-controls').hidden, true);
  a.click('view-plan');
  assert.equal(a.el('navigation-results').hidden, false);
  assert.equal(a.el('journey-controls').hidden, false);
});

test('finishing a trip and opening its history report reveal the Reports view', () => {
  const a = setup(); finishTwoStopTrip(a);
  assert.equal(a.el('reports-view').hidden, false);
  assert.equal(a.el('plan-view').hidden, true);
  assert.equal(a.el('saved-view').hidden, true);
  assert.equal(a.el('trip-panel').hidden, true);
  assert.equal(a.el('planner-fields').hidden, false);
  assert.equal(a.el('navigation-results').hidden, false);
  assert.equal(a.el('trip-report').hidden, false);
  a.click('view-plan');
  a.el('trip-reports-list').children[0].children[0].click();
  assert.equal(a.el('reports-view').hidden, false);
  assert.equal(a.el('plan-view').hidden, true);
});

test('restored trip progress remains available in Plan without showing unrelated navigation', () => {
  const a = setup(); beginTrip(a);
  const restored = setup([], { storage: a.stored, init: false });
  assert.equal(restored.el('plan-view').hidden, false);
  assert.equal(restored.el('trip-panel').hidden, false);
  assert.equal(restored.el('planner-fields').hidden, true);
  assert.equal(restored.el('navigation-results').hidden, true);
  restored.click('view-reports'); restored.click('view-plan');
  assert.equal(restored.el('trip-panel').hidden, false);
  assert.equal(restored.el('trip-stop-address').textContent, 'Start');
});

test('saved-route address validation reveals the Plan view before focusing its missing field', () => {
  for (const missing of ['start', 'destination']) {
    const a = setup(); a.el('route-name').value = 'Named route';
    a.el(missing).value = ''; a.click('view-saved'); a.click('save-route');
    assert.equal(a.el('plan-view').hidden, false);
    assert.equal(a.el('saved-view').hidden, true);
    assert.equal(a.el('journey-controls').hidden, false);
    assert.match(a.el('route-message').textContent, /starting address and final destination/);
    assert.equal(a.stored.d7SavedRoutes, undefined);
  }
});

test('map authorization and load failures show a truthful map fallback note', () => {
  for (const fail of ['auth', 'load', 'timeout']) {
    const a = setup([], { init: fail === 'auth' });
    if (fail === 'auth') a.context.window.gm_authFailure();
    else if (fail === 'load') vm.runInContext('handleMapsLoadFailure()', a.context);
    else a.advance(15000);
    assert.equal(a.el('map').hidden, true);
    assert.equal(a.el('map-access-note').hidden, false);
    assert.match(a.el('map-access-note').textContent, /map|Google/i);
    assert.match(a.el('map-access-note').textContent, /unavailable|can.t|cannot|couldn.t|unable|not.*authorized|restricted|needs? (?:an? )?(?:internet|connection)/i);
    assert.equal(a.requests.length, 0);
  }
});

test('offline map fallback explains the connection requirement without displaying made-up metrics', () => {
  const a = setup([], { init: false, navigatorApi: { onLine: false } });
  vm.runInContext('handleMapsLoadFailure()', a.context);
  assert.equal(a.el('map').hidden, true);
  assert.equal(a.el('map-access-note').hidden, false);
  assert.match(a.el('map-access-note').textContent, /offline|internet|connect/i);
  assert.equal(a.requests.length, 0);
  assert.doesNotMatch(a.el('route-message').textContent, /Route (?:optimized|calculated):/);
});

test('a successful or late Maps load reveals the live map and removes its failure note', () => {
  const ready = setup();
  assert.equal(ready.el('map').hidden, false);
  assert.equal(ready.el('map-access-note').hidden, true);
  const slow = setup([], { init: false }); slow.advance(15000);
  assert.equal(slow.el('map').hidden, true);
  assert.equal(slow.el('map-access-note').hidden, false);
  vm.runInContext('initMap()', slow.context);
  assert.equal(slow.el('map').hidden, false);
  assert.equal(slow.el('map-access-note').hidden, true);
});

test('real route coordinates create owned markers that clear on edits and restore native fallback', () => {
  for (const change of ['edit', 'remove']) {
    const a = setup([], { mapTheme: true }); a.add('Second'); a.calculate();
    // Use both actual API LatLng accessors and literal coordinates. Positions
    // describe the returned optimized leg order rather than uncomputed inputs.
    const positions = [
      { lat: () => 38.58, lng: () => -121.49 },
      { lat: 38.62, lng: -121.51 },
      { lat: 38.6, lng: -121.5 },
      { lat: () => 38.65, lng: () => -121.52 },
    ];
    const legs = positions.slice(0, -1).map((start_location, index) => ({
      start_location, end_location: positions[index + 1],
      distance: { value: 1609.344 }, duration: { value: 60 },
    }));
    a.reply(0, 'OK', [1, 0], legs);
    assert.equal(a.markerInstances.length, 4);
    assert.deepEqual(a.markerInstances.map(marker => marker.options.title), ['Start', 'Stop 1', 'Stop 2', 'Finish']);
    assert.deepEqual(a.markerInstances.map(marker => [marker.options.position.lat, marker.options.position.lng]), [
      [38.58, -121.49], [38.62, -121.51], [38.6, -121.5], [38.65, -121.52],
    ]);
    assert.ok(a.markerInstances.every(marker => marker.map === a.mapsInstances[0]));
    assert.equal(a.renderers[0].options.suppressMarkers, true);
    assert.deepEqual(a.el('route-itinerary').children.map(item => item.textContent), [
      'Start: Origin', 'Stop 1: Second', 'Stop 2: Start', 'Finish: End',
    ]);

    if (change === 'edit') a.destination('Changed destination');
    else a.el('stops-container').children[0].children[2].click();
    assert.ok(a.markerInstances.every(marker => marker.map === null), `${change} must detach every owned marker`);
    assert.equal(a.renderers[0].map, null);
    assert.equal(a.el('navigation-results').hidden, true);

    a.calculate(); a.reply(1); // Valid metrics but no coordinate capability.
    assert.equal(a.markerInstances.length, 4, 'No invented marker positions');
    assert.equal(a.renderers[0].options.suppressMarkers, false);
    assert.equal(a.renderers[0].map, a.mapsInstances[0]);
    assert.equal(a.el('navigation-results').hidden, false);
  }
});

test('malformed optimized stop order never creates markers even with valid leg coordinates', () => {
  const a = setup([], { mapTheme: true }); a.add('Second'); a.calculate();
  const points = [
    { lat: 38.58, lng: -121.49 }, { lat: 38.6, lng: -121.5 },
    { lat: 38.62, lng: -121.51 }, { lat: 38.65, lng: -121.52 },
  ];
  const legs = points.slice(0, -1).map((start_location, index) => ({
    start_location, end_location: points[index + 1],
    distance: { value: 1609.344 }, duration: { value: 60 },
  }));
  a.reply(0, 'OK', [0, 0], legs);
  assert.equal(a.markerInstances.length, 0);
  assert.notEqual(a.renderers[0].options.suppressMarkers, true);
  assert.equal(a.renderers[0].result, undefined);
  assert.equal(a.el('navigation-results').hidden, true);
  assert.match(a.el('route-message').textContent, /invalid optimized stop order/);
});

for(const count of [25,26,92,100,125,500])test(`Calculate preserves all ${count} stops across bounded requests and complete map/totals`,()=>{
  const a=setup([],{mapTheme:true});const names=bulkStops(a,count);
  a.click('calculate-route');
  let index=0;
  while(index<a.requests.length){
    assert.ok(a.requests[index].options.waypoints.length<=25);
    if(index)assert.equal(a.requests[index].options.origin,a.requests[index-1].options.destination);
    if(index<Math.ceil((count+1)/26)-1)assert.equal(a.renderers[0].map,null);
    replyWithCoordinates(a,index++);
    assert.ok(index<30);
  }
  assert.equal(index,Math.ceil((count+1)/26));
  assert.equal(a.el('route-itinerary').children.length,count+2);
  assert.equal(a.markerInstances.length,count+2);
  assert.equal(a.renderers.filter(r=>r.map).length,index);
  if(index>1)assert.ok(a.mapsInstances[0].bounds.points.length>=count+1);
  a.click('start-trip');const snapshot=JSON.parse(a.stored.d7TripProgress).routeSnapshot;
  assert.deepEqual(snapshot.stops,names);assert.equal(snapshot.legs.length,count+1);
  assert.ok(Math.abs(snapshot.plannedMiles-(count+1))<1e-8);
  assert.ok(Math.abs(snapshot.plannedMinutes-(count+1))<1e-8);
  for(let i=1;i<snapshot.legs.length;i++)assert.equal(snapshot.legs[i-1].to,snapshot.legs[i].from);
});
test('full-list efficiency ordering of 100 stops is evaluated in two passes without losing labels',()=>{
  const a=setup([],{mapTheme:true});const original=bulkStops(a,100);a.click('plan-route');
  let i=0;while(i<a.requests.length){replyWithCoordinates(a,i++,{reverse:true});assert.ok(i<30);}
  assert.equal(i,8);assert.equal(a.requests.slice(0,4).every(r=>r.options.optimizeWaypoints===false),true);
  const actual=[...a.el('stops-container').children].map(row=>row.children[1].value);
  assert.equal(new Set(actual).size,100);assert.deepEqual([...actual].sort(),[...original].sort());
  assert.notDeepEqual(actual,original);assert.match(a.el('route-order-note').textContent,/heuristic/);
  a.el('route-name').value='Large job';a.click('save-route');
  const saved=a.savedRoutes()['Large job'];
  saved.stops.forEach((address,index)=>assert.equal(saved.stopLabels[index],'Store '+address.split(' ')[1]));
});
test('a longer geographic candidate falls back to entered order only when it meets priorities',()=>{
  const a=setup();const original=bulkStops(a,92);a.click('plan-route');
  let i=0;while(i<a.requests.length){replyWithCoordinates(a,i,{cost:i<4?1:2});i++;}
  assert.deepEqual([...a.el('stops-container').children].map(row=>row.children[1].value),original);
  assert.match(a.el('route-order-note').textContent,/Kept the entered order/);
});
for(const direction of ['north','south'])test(`${direction}-first and must-do-first instructions outrank distance and survive Google's section optimization`,()=>{
  const a=setup();bulkStops(a,100);
  a.el('route-instructions').value=`${direction} first; first stops: 3, 5`;
  a.click('plan-route');let i=0;
  while(i<a.requests.length){replyWithCoordinates(a,i,{cost:i<4?1:2,reverse:true});i++;assert.ok(i<30);}
  const addresses=[...a.el('stops-container').children].map(row=>row.children[1].value);
  assert.deepEqual(new Set(addresses.slice(0,2)),new Set(['Stop 3','Stop 5']));
  const tiers=addresses.slice(2).map(address=>routeCoordinate(address).lat>=40);
  const ordered=direction==='north'?tiers:tiers.map(n=>!n);
  assert.equal(ordered.every((v,index)=>index===0 || !v || ordered[index-1]),true);
  assert.doesNotMatch(a.el('route-order-note').textContent,/Kept the entered order/);
  a.el('route-name').value='Priority job';a.click('save-route');
  const save=a.savedRoutes()['Priority job'];assert.equal(save.routePriority,direction);
  assert.equal(save.stopFirst.filter(Boolean).length,2);
  assert.match(save.routeInstructions,/first stops: 1, 2|first stops: 2, 1/);
});
test('unsupported instructions block planning without issuing requests; Keep My Order does not reorder',()=>{
  const a=setup();const original=bulkStops(a,100);a.el('route-instructions').value='avoid snow wherever it might fall';a.click('plan-route');
  assert.equal(a.requests.length,0);assert.match(a.el('route-message').textContent,/not understood/);
  a.el('route-instructions').value='north first';a.click('calculate-route');
  let i=0;while(i<a.requests.length)replyWithCoordinates(a,i++);
  assert.deepEqual([...a.el('stops-container').children].map(row=>row.children[1].value),original);
});
test('failure in a later section never publishes partial totals, markers, navigation or stop reorder',()=>{
  const a=setup([],{mapTheme:true});const names=bulkStops(a,92);a.click('calculate-route');
  replyWithCoordinates(a,0);a.reply(1,'OVER_QUERY_LIMIT');
  assert.equal(a.renderers[0].map,null);assert.equal(a.markerInstances.length,0);
  assert.equal(a.el('navigation-results').hidden,true);assert.equal(a.el('stat-miles').textContent,'—');
  assert.deepEqual([...a.el('stops-container').children].map(row=>row.children[1].value),names);
  assert.match(a.el('route-message').textContent,/OVER_QUERY_LIMIT/);
});
test('edits and timeouts during later sections ignore late responses and discard all buffered sections',()=>{
  for(const action of ['edit','timeout']){
    const a=setup();bulkStops(a,100);a.click('calculate-route');replyWithCoordinates(a,0);
    if(action==='edit')a.destination('Changed');else a.advance(20000);
    replyWithCoordinates(a,1);
    assert.equal(a.renderers[0].map,null);assert.equal(a.el('navigation-results').hidden,true);
    assert.equal(a.requests.length,2);
  }
});
test('100-stop round trip retains the depot as both endpoints and covers every navigation leg',()=>{
  const a=setup();bulkStops(a,100);a.destination('Origin');a.click('calculate-route');let i=0;
  while(i<a.requests.length)replyWithCoordinates(a,i++);
  a.click('start-trip');const route=JSON.parse(a.stored.d7TripProgress).routeSnapshot;
  assert.equal(route.start,'Origin');assert.equal(route.destination,'Origin');assert.equal(route.legs.length,101);
});
test('92-row spreadsheet import reviews data, resets old job instructions, keeps endpoints and saves labels',async()=>{
  const a=setup();a.el('route-instructions').value='north first';
  const csv='Store #,Address,City,State,ZIP\n'+Array.from({length:92},(_,i)=>`${i+1},${i+1} Oak St,Boston,MA,02108`).join('\n');
  a.el('spreadsheet-file').files=[{name:'job.csv',size:csv.length,text:async()=>csv}];
  await a.el('spreadsheet-file').listeners.change();
  assert.equal(a.el('route-instructions').value,'');assert.equal(a.el('spreadsheet-preview').children.length,92);
  assert.equal(a.el('stops-container').children.length,1,'upload preview must not yet replace draft stops');
  a.el('spreadsheet-mode').value='replace';a.click('apply-spreadsheet');
  assert.equal(a.el('stops-container').children.length,92);assert.equal(a.el('start').value,'Origin');assert.equal(a.el('destination').value,'End');
  a.el('route-name').value='Imported';a.click('save-route');const saved=a.savedRoutes().Imported;
  assert.equal(saved.stops.length,92);assert.equal(saved.stopLabels[91],'92');assert.match(saved.stops[0],/Boston, MA, 02108/);
  a.el('saved-route-select').value='Imported';a.click('load-route');assert.equal(a.el('stops-container').children.length,92);
});
test('spreadsheet preview excludes unusable rows, preserves repeated stops and can append selected rows',async()=>{
  const a=setup();const csv='Name,Address\nGood,12 Oak St\nBad,\nAgain,12 Oak St';
  a.el('spreadsheet-file').files=[{name:'small.csv',size:csv.length,text:async()=>csv}];await a.el('spreadsheet-file').listeners.change();
  assert.equal(a.el('import-row-1').disabled,true);assert.equal(a.el('import-row-1').checked,false);
  a.el('spreadsheet-mode').value='append';a.click('apply-spreadsheet');assert.equal(a.el('stops-container').children.length,3);
  a.el('route-name').value='Append';a.click('save-route');assert.deepEqual(a.savedRoutes().Append.stopLabels,['','Good','Again']);
});
test('malformed import and oversized saved routes preserve the existing draft and records without slicing',async()=>{
  const saved={start:'Depot',stops:Array(501).fill('12 Oak St'),destination:'Finish'};
  const a=setup([],{storage:{d7SavedRoutes:JSON.stringify({Oversized:saved})}});
  a.el('saved-route-select').value='Oversized';a.click('load-route');assert.equal(a.el('start').value,'Origin');assert.equal(a.savedRoutes().Oversized.stops.length,501);
  a.el('spreadsheet-file').files=[{name:'broken.csv',size:12,text:async()=> 'Address\n"bad'}];await a.el('spreadsheet-file').listeners.change();
  assert.equal(a.el('stops-container').children.length,1);assert.match(a.el('spreadsheet-message').textContent,/Could not read/);
});

test('upload, optional instructions and one primary action plan a complete 100-stop job',async()=>{
  const a=setup([],{mapTheme:true});const csv='Store #,Address\n'+Array.from({length:100},(_,i)=>`${i+1},Stop ${i+1}`).join('\n');
  a.el('spreadsheet-file').files=[{name:'job.csv',size:csv.length,text:async()=>csv}];await a.el('spreadsheet-file').listeners.change();
  a.el('spreadsheet-mode').value='replace';a.el('route-instructions').value='first stops: 2, 5';a.el('route-instructions').listeners.input();
  a.click('import-optimize');let i=0;while(i<a.requests.length){replyWithCoordinates(a,i++,{reverse:true});assert.ok(i<30);}
  assert.equal(a.el('route-itinerary').children.length,102);assert.equal(a.markerInstances.length,102);
  const stops=[...a.el('stops-container').children].map(row=>row.children[1].value);
  assert.deepEqual(new Set(stops.slice(0,2)),new Set(['Stop 2','Stop 5']));
  a.click('start-trip');const route=JSON.parse(a.stored.d7TripProgress).routeSnapshot;
  assert.equal(route.stops.length,100);assert.equal(route.legs.length,101);assert.equal(route.stopLabels[0],route.stops[0].split(' ')[1]);
});
test('manual move controls retain labels/instructions and Keep My Order honors the revision',()=>{
  const a=setup();bulkStops(a,3);a.el('route-instructions').value='first stops: 2';
  a.el('stops-container').children[1].children[3].children[1].click();
  assert.equal(a.el('stops-container').children[0].children[1].value,'Stop 2');
  assert.equal(a.el('route-instructions').value,'first stops: 1');
  a.click('calculate-route');replyWithCoordinates(a,0);
  assert.deepEqual([...a.requests[0].options.waypoints].map(w=>w.location),['Stop 2','Stop 1','Stop 3']);
  a.el('route-name').value='Manual';a.click('save-route');assert.deepEqual(a.savedRoutes().Manual.stopLabels,['Store 2','Store 1','Store 3']);
});
test('new jobs do not inherit first-stop flags or directional instructions from an unrelated draft',async()=>{
  const a=setup();a.el('route-instructions').value='north first';vm.runInContext('stopFirst[0]=true;',a.context);
  const csv='Address\n12 Oak St\n30 Main St';a.el('spreadsheet-file').files=[{name:'fresh.csv',size:csv.length,text:async()=>csv}];
  await a.el('spreadsheet-file').listeners.change();a.el('spreadsheet-mode').value='replace';a.click('apply-spreadsheet');
  assert.equal(a.el('route-instructions').value,'');assert.equal(a.el('route-priority').value,'efficiency');
  assert.equal(vm.runInContext('stopFirst.some(Boolean)',a.context),false);
});
test('100-stop backup round trips labels and route-specific instructions without changing existing saves',async()=>{
  const a=setup();bulkStops(a,100);a.el('route-instructions').value='north first; first stops: 2';a.el('route-instructions').listeners.input();
  a.el('route-name').value='Job';a.click('save-route');a.click('export-routes');
  const exported=JSON.parse(await a.blobs.at(-1).text());const b=setup([],{storage:{d7SavedRoutes:JSON.stringify({Keep:savedRoute()})}});
  await backupFile(b,exported);assert.ok(b.savedRoutes().Keep);assert.equal(b.savedRoutes().Job.stops.length,100);
  b.el('saved-route-select').value='Job';b.click('load-route');assert.equal(b.el('route-instructions').value,'north first; first stops: 2');
  assert.equal(b.el('stops-container').children[1].children[1].ariaLabel,'Stop 2: Store 2');
});
test('repeated provider callbacks cannot duplicate a section or issue extra requests',()=>{
  const a=setup();bulkStops(a,92);a.click('calculate-route');replyWithCoordinates(a,0);replyWithCoordinates(a,0);
  assert.equal(a.requests.length,2);let i=1;while(i<a.requests.length)replyWithCoordinates(a,i++);
  assert.equal(a.el('route-itinerary').children.length,94);
});

test('provider route-length limits split internally while retaining every stop and shared boundary',()=>{
  const a=setup();const names=bulkStops(a,26);a.click('calculate-route');a.reply(0,'MAX_ROUTE_LENGTH_EXCEEDED');
  assert.equal(a.requests.length,2);assert.ok(a.requests[1].options.waypoints.length<25);
  let i=1;while(i<a.requests.length){replyWithCoordinates(a,i++);assert.ok(i<10);}
  assert.equal(a.el('route-itinerary').children.length,28);a.click('start-trip');
  const route=JSON.parse(a.stored.d7TripProgress).routeSnapshot;assert.deepEqual(route.stops,names);assert.equal(route.legs.length,27);
  for(let j=1;j<route.legs.length;j++)assert.equal(route.legs[j-1].to,route.legs[j].from);
});

test('repeat import of the same selection retains manual revisions instead of replacing or appending again',async()=>{
  const a=setup();const csv='Store #,Address\nA,12 Oak St\nB,30 Main St';
  a.el('spreadsheet-file').files=[{name:'job.csv',size:csv.length,text:async()=>csv}];await a.el('spreadsheet-file').listeners.change();
  a.el('spreadsheet-mode').value='replace';a.click('apply-spreadsheet');
  a.el('stops-container').children[1].children[3].children[1].click();
  a.click('apply-spreadsheet');assert.equal(a.el('stops-container').children.length,2);
  assert.equal(a.el('stops-container').children[0].children[1].value,'30 Main St');
  assert.match(a.el('spreadsheet-message').textContent,/already loaded/);
});
