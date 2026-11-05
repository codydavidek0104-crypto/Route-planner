const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../route-planning.js');
const p=x=>({lat:0,lng:x});
const legs=points=>points.slice(1).map((end_location,i)=>({start_location:points[i],end_location,distance:{value:P.distance(points[i],end_location)},duration:{value:100}}));

test('duplicate colocated visits cannot hide the distance-weighted depot reversal',()=>{
  const a=P.backtracking([p(0),p(1),p(1),p(0)]),b=P.backtracking([p(0),p(.1),p(.1),p(0)]);
  assert.equal(a.turns,1);assert.equal(b.turns,1);assert.ok(a.meters>b.meters*9.9);
  assert.deepEqual(P.backtracking([p(0),null,p(1)]),{turns:null,meters:null});
});

test('route screening collapses adjacent duplicate visits and equivalent reversed depot loops',()=>{
  const stops=['A','A','B'];
  assert.equal(P.routeKey([0,1,2],stops,'Depot','Depot'),P.routeKey([1,0,2],stops,'Depot','Depot'));
  assert.equal(P.routeKey([0,2],stops,'Depot','Depot',true),P.routeKey([2,0],stops,'Depot','Depot',true));
  assert.notEqual(P.routeKey([0,2],stops,'Origin','Finish'),P.routeKey([2,0],stops,'Origin','Finish'));
});

test('multiple local seeds generate complete compliant candidates and freeze cutoff tiers',()=>{
  const points=[{lat:28,lng:-81},{lat:40,lng:-105},{lat:25,lng:-80},{lat:42,lng:-100},{lat:30,lng:-84},p(0)];
  const m=P.createModel(legs(points),[0,1,2,3],4,[false,false,false,true],'north',40);
  const before=[...m.tiers];
  for(const objective of ['fuel','time','backtracking'])for(const c of m.generate(objective)) {
    assert.deepEqual([...c.indices].sort(),[0,1,2,3]);
    assert.equal(c.indices[0],3);
    const tiers=c.indices.map(id=>m.tiers[id]);assert.ok(tiers.every((t,i)=>!i || tiers[i-1]<=t));
    assert.ok(Number.isFinite(c.score));
  }
  const shifted=legs(points.map(v=>({...v,lat:v.lat-.001})));
  m.learn(shifted,[0,1,2,3]);assert.deepEqual(m.tiers,before);
});

test('directed time screening uses learned road durations rather than only geometric distance',()=>{
  const points=[[.95,1.84],[.76,2.97],[2.87,.47],[.82,1.89],[2.10,2.79],[2.82,.43],[2.27,3.16]].map(([lat,lng])=>({lat,lng}));
  const samples=legs(points);samples.forEach((leg,i)=>leg.duration.value=[4635,4470,141,3422,9813,4183][i]);
  const model=P.createModel(samples,[0,1,2,3,4],5,Array(5).fill(false),'efficiency',40);
  const fuel=model.generate('fuel')[0],time=model.generate('time')[0];
  assert.notDeepEqual(time.indices,fuel.indices);
  assert.ok(time.predictedDuration<model.metrics(fuel.indices,'time').predictedDuration);
});
