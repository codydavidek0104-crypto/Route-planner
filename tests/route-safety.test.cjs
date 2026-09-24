const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the actual page script with controlled Maps responses and a minimal DOM.
function setup(confirmations = []) {
  const elements = new Map();
  function element() {
    return {
      value: '', textContent: '', hidden: true, children: [], listeners: {},
      set innerHTML(value) { this.children = []; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      focus() {},
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
  const stored = {};
  const confirmationMessages = [];
  const context = vm.createContext({
    document: { getElementById: el, createElement: element },
    localStorage: {
      getItem: key => stored[key] || null,
      setItem: (key, value) => { stored[key] = value; },
    },
    window: {
      confirm: message => {
        confirmationMessages.push(message);
        return confirmations.length ? confirmations.shift() : true;
      },
    },
    google: { maps: {
      Map: class {},
      DirectionsService: class { route(options, callback) { requests.push({ options, callback }); } },
      DirectionsRenderer: class {
        constructor() { renderers.push(this); }
        setMap(map) { this.map = map; }
        setDirections(result) { this.result = result; }
      },
      TravelMode: { DRIVING: 'DRIVING' },
    } },
  });
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext('initMap()', context);
  const click = id => el(id).listeners.click();
  const add = address => { el('stop-input').value = address; click('add-stop'); };
  const destination = address => { el('destination').value = address; el('destination').listeners.input(); };
  const reply = (index, status = 'OK', order = []) => requests[index].callback({ routes: [{
    waypoint_order: order,
    legs: [{ distance: { value: 16093.44 }, duration: { value: 5100 } }],
  }] }, status);
  const calculate = () => click('calculate-route');
  const stale = () => {
    assert.equal(el('route-stale-warning').hidden, false);
    assert.equal(renderers[0].map, null);
    assert.doesNotMatch(el('route-message').textContent, /miles|Est\. fuel/);
  };
  add('Start'); destination('End');
  const savedRoutes = () => JSON.parse(stored.d7SavedRoutes || '{}');
  return {
    el, click, add, destination, requests, renderers, reply, calculate, stale,
    savedRoutes, confirmationMessages,
  };
}

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
  const a = setup(); a.add('A'); a.add('B'); a.click('optimize-route');
  assert.equal(a.requests[0].options.optimizeWaypoints, true);
  a.reply(0, 'OK', [1, 0]);
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
