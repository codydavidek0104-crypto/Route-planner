import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle,validateClauses,ConversionLimits} from '../worker/index.mjs';
const origin='http://127.0.0.1:4188';
const env={ALLOWED_ORIGIN:origin,ENABLED:'true',OPENAI_API_KEY:'test-only',LIMITS:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:200})})}};
const request=(data,options={})=>new Request(origin+'/api/instructions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...options.headers},body:JSON.stringify(data)});
const model=(clauses,status='ok')=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({status,clauses})}]}]}));
test('Worker sends only instruction text, never route metadata, and returns only clauses',async()=>{
  let sent;
  const r=await handle(request({text:'Please visit northern stores first'}),env,async(url,options)=>{
    sent=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/responses');return model(['north first']);
  });
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{clauses:['north first']});
  assert.equal(sent.input,'Please visit northern stores first');assert.equal(sent.store,false);
  assert.equal(sent.text.format.strict,true);assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('Worker rejects unsupported weather and sensitive text before contacting provider',async()=>{
  for(const text of ['north first before snow','start in Florida, then work back south','visit 123 Main Street first','email john@example.com']){
    const r=await handle(request({text}),env,()=>{throw new Error('must not call');});assert.equal(r.status,422);
  }
});
test('extra fields, overlong text, wrong origins and methods fail closed',async()=>{
  for(const data of [{text:'north first',addresses:['private']},{text:'x'.repeat(513)},{text:''},null])
    assert.equal((await handle(request(data),env)).status,400);
  assert.equal((await handle(request({text:'hello'},{headers:{Origin:'https://other.test'}}),env)).status,403);
  assert.equal((await handle(new Request(origin+'/api/instructions',{headers:{Origin:origin}}),env)).status,405);
  const huge=new Request(origin+'/api/instructions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:' '.repeat(4097)});
  assert.equal((await handle(huge,env)).status,400);
});
test('missing key and limits, throttles and provider errors expose no secrets or raw errors',async()=>{
  assert.equal((await handle(request({text:'north first'}),{...env,OPENAI_API_KEY:''})).status,503);
  assert.equal((await handle(request({text:'north first'}),{...env,LIMITS:null})).status,503);
  const limited={...env,LIMITS:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:429})})}};
  assert.equal((await handle(request({text:'north first'}),limited)).status,429);
  for(const send of [async()=>new Response('secret error',{status:500}),async()=>{throw new Error('secret');}]){
    const r=await handle(request({text:'north first'}),env,send);assert.deepEqual(await r.json(),{error:'unavailable'});
  }
});
test('unsupported, malformed, conflicting and invented model rules never reach planner',async()=>{
  for(const clauses of [['north first','south first'],['first stops: 2'],['north cutoff: 42'],['north first; return home'],[],['north first','north first']]){
    const r=await handle(request({text:'Do northern stores first'}),env,async()=>model(clauses));assert.notEqual(r.status,200);
  }
  assert.equal((await handle(request({text:'go around'}),env,async()=>model([],'unsupported'))).status,422);
  assert.deepEqual(validateClauses(['first stops: 2, 5','north cutoff: 42','north first'],'Do stops 2 and 5 first, then north of 42'),['first stops: 2, 5','north cutoff: 42','north first']);
});
test('persistent global limiter caps per-client requests and daily total',async()=>{
  let record;
  const storage={transaction:fn=>fn({get:async()=>record,put:async(k,v)=>{record=v;}})};
  const limits=new ConversionLimits({storage});
  for(let i=0;i<10;i++)assert.equal((await limits.fetch(new Request('https://limit',{method:'POST',body:'client'}))).status,200);
  assert.equal((await limits.fetch(new Request('https://limit',{method:'POST',body:'client'}))).status,429);
  record.total=500;
  assert.equal((await limits.fetch(new Request('https://limit',{method:'POST',body:'other'}))).status,429);
});
