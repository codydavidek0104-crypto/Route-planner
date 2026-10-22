const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const now = Date.parse('2026-10-22T15:00:00Z');
function setup() {
  const elements = new Map(), requests = [], events = {}, trafficLayers = [], timers = new Map();
  let timerId = 0;
  function element(tag='div') {
    return { tag, value:'', children:[], listeners:{}, textContent:'', disabled:false, hidden:false,
      set innerHTML(value) { this.children=[]; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name,fn) { this.listeners[name]=fn; },
      setAttribute(name,value) { this[name]=value; }, focus(){},scrollIntoView(){} };
  }
  const el = id => { if(!elements.has(id))elements.set(id,element()); return elements.get(id); };
  const map = { fitBounds(bounds) { this.bounds=bounds; } };
  const api = {
    TrafficLayer: class { constructor(){trafficLayers.push(this);} setMap(map){this.map=map;} },
    LatLngBounds: class { constructor(){this.points=[];} extend(point){this.points.push(point);} }
  };
  const navigator = { onLine:true };
  const context = vm.createContext({ URL, AbortController, navigator,
    Date:class extends Date { constructor(...args){super(...(args.length?args:[now]));}static now(){return now;} },
    document:{getElementById:el,createElement:element},
    window:{addEventListener(name,fn){events[name]=fn;}},showView(){},
    setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    fetch(url,options) { return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})); }
  });
  vm.runInContext(readFileSync(path.join(__dirname,'../route-tools.js'),'utf8'),context);
  const tools=vm.runInContext('D7RouteTools',context);
  tools.ready(map,api);
  function route() {
    tools.setRoute(['Sacramento','Roseville','Auburn'],[
      {start_location:{lat:38.5816,lng:-121.4944},end_location:{lat:38.7521,lng:-121.288}},
      {start_location:{lat:38.7521,lng:-121.288},end_location:{lat:38.8966,lng:-121.0769}}
    ],['Store 1']);
  }
  function reply(index,data,status=200) { requests[index].resolve({ok:status===200,status,json:async()=>data}); }
  return { el,tools,route,requests,reply,events,navigator,map,trafficLayers,timers,click:id=>el(id).listeners.click() };
}
const flush = async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function forecast() { return {properties:{updateTime:'2026-10-22T14:30:00Z',periods:[{
  name:'This afternoon',startTime:'2026-10-22T12:00:00-07:00',endTime:'2026-10-22T18:00:00-07:00',
  temperature:71,temperatureUnit:'F',shortForecast:'Sunny',windSpeed:'5 mph',windDirection:'N',probabilityOfPrecipitation:{value:0}
}]}}; }
const pointData = {properties:{forecast:'https://api.weather.gov/gridpoints/STO/87,72/forecast'}};

test('forecast is on demand, uses selected stop coordinates and reuses recent data',async()=>{
  const a=setup();a.route();assert.equal(a.requests.length,0);
  a.el('weather-stop').value='1';
  let task=a.click('check-weather');
  assert.equal(a.requests[0].url,'https://api.weather.gov/points/38.7521,-121.2880');
  a.reply(0,pointData);await flush();a.reply(1,forecast());await task;
  assert.equal(a.el('weather-results').children[0].textContent,'Stop 1: Store 1 — Roseville');
  const list=a.el('weather-results').children[2];
  assert.match(list.children[0].children[0].textContent,/71°F/);
  assert.match(list.children[0].children[2].textContent,/Precipitation 0%/);
  await a.click('check-weather');assert.equal(a.requests.length,2);
  assert.equal(a.el('check-weather').disabled,false);
});

test('late weather cannot reappear after route edits or selection changes',async()=>{
  const a=setup();a.route();const task=a.click('check-weather');
  a.reply(0,pointData);await flush();a.tools.clear();a.reply(1,forecast());await task;
  assert.equal(a.el('weather-results').children.length,0);
  assert.equal(a.el('check-weather').disabled,true);
  a.route();const next=a.click('check-weather');
  a.el('weather-stop').value='2';a.el('weather-stop').listeners.change();
  a.reply(2,pointData);await next;
  assert.equal(a.requests.length,3);
  assert.equal(a.el('weather-results').children.length,0);
});

test('provider links are restricted to NWS forecast endpoints',async()=>{
  for(const url of ['https://evil.example/forecast','https://api.weather.gov.evil.example/gridpoints/STO/1,2/forecast','https://api.weather.gov/alerts','http://api.weather.gov/gridpoints/STO/1,2/forecast']) {
    const a=setup();a.route();const task=a.click('check-weather');
    a.reply(0,{properties:{forecast:url}});await task;
    assert.equal(a.requests.length,1);assert.match(a.el('weather-message').textContent,/Could not load/);
  }
});

test('unavailable, stale and malformed forecasts report errors and allow retry',async()=>{
  for(const status of [404,429,503]) {
    const a=setup();a.route();const task=a.click('check-weather');a.reply(0,{},status);await task;
    assert.equal(a.el('weather-results').children.length,0);assert.equal(a.el('check-weather').disabled,false);
    assert.match(a.el('weather-message').textContent,/not available|busy|could not respond/);
  }
  for(const change of [data=>data.properties.updateTime='2020-01-01',data=>data.properties.periods[0].temperature='hot',data=>data.properties.periods=[]]) {
    const a=setup();a.route();const task=a.click('check-weather');a.reply(0,pointData);await flush();
    const data=forecast();change(data);a.reply(1,data);await task;
    assert.equal(a.el('weather-results').children.length,0);assert.match(a.el('weather-message').textContent,/Could not load/);
  }
});

test('weather timeout aborts its own request and does not disable retry',async()=>{
  const a=setup();a.route();const task=a.click('check-weather');
  [...a.timers.values()][0]();assert.equal(a.requests[0].options.signal.aborted,true);
  const error=new Error('Aborted');error.name='AbortError';a.requests[0].reject(error);await task;
  assert.match(a.el('weather-message').textContent,/timed out/);assert.equal(a.el('check-weather').disabled,false);
});

test('traffic toggles and full-route fit use the current map without weather requests',()=>{
  const a=setup();a.route();a.click('toggle-traffic');assert.equal(a.trafficLayers[0].map,a.map);
  assert.equal(a.el('toggle-traffic')['aria-pressed'],'true');a.click('toggle-traffic');
  assert.equal(a.trafficLayers[0].map,null);a.click('fit-route');assert.equal(a.map.bounds.points.length,3);
  assert.equal(a.requests.length,0);a.tools.clear();assert.equal(a.el('fit-route').disabled,true);
});

test('offline and Maps failure disable unavailable controls without discarding route weather locations',async()=>{
  const a=setup();a.route();a.click('toggle-traffic');a.navigator.onLine=false;a.events.offline();
  assert.equal(a.trafficLayers[0].map,null);assert.equal(a.el('check-weather').disabled,true);
  await a.click('check-weather');assert.equal(a.requests.length,0);
  a.navigator.onLine=true;a.events.online();assert.equal(a.el('check-weather').disabled,false);
  a.tools.unavailable();assert.equal(a.el('fit-route').disabled,true);assert.equal(a.el('toggle-traffic').disabled,true);
});

test('missing coordinates are never replaced by invented weather locations',async()=>{
  const a=setup();a.tools.setRoute(['Start','Finish'],[{}],[]);
  assert.equal(a.el('weather-stop').disabled,true);await a.click('check-weather');assert.equal(a.requests.length,0);
});
