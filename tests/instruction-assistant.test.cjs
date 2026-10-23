const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const D7Import=require('../stop-import.js');
function setup(fetcher){
  const elements=new Map(),details={open:false};let invalidations=0,calls=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,content:'./api/instructions',listeners:{},
    addEventListener(n,f){this.listeners[n]=f;},focus(){},scrollIntoView(){},closest(){return details;},dispatchEvent(e){this.listeners[e.type]?.(e);}});return elements.get(id);};
  const context=vm.createContext({document:{getElementById:el},D7Import,stops:['one','two'],stopLabels:['A','B'],startInput:{value:'private start'},destinationInput:{value:'private end'},
    invalidateRoute(){invalidations++;},navigator:{onLine:true},location:{href:'http://127.0.0.1:4188/',origin:'http://127.0.0.1:4188'},URL,AbortController,setTimeout,clearTimeout,
    Event:class{constructor(type){this.type=type;}},fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return fetcher(url,options);}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../instruction-assistant.js'),'utf8'),context);
  return {el,context,calls,details,type(t){el('plain-instructions').value=t;el('plain-instructions').listeners.input();},click(id){return el(id).listeners.click();},before:()=>vm.runInContext('D7InstructionAssistant.beforePlan()',context)};
}
test('exact phrases remain local and confirmation is required before applying',async()=>{
  const a=setup(()=>{throw new Error('no network');});a.type('north first');await a.click('convert-instructions');
  assert.equal(a.calls.length,0);assert.equal(a.el('instruction-review').hidden,false);assert.equal(a.el('route-instructions').value,'');assert.equal(a.before(),false);
  a.el('converted-instructions').value='south first';a.click('confirm-instructions');assert.equal(a.el('route-instructions').value,'south first');assert.equal(a.before(),true);
});
test('natural language sends only its text and invalid stop edits cannot be confirmed',async()=>{
  const a=setup(async()=>({ok:true,json:async()=>({clauses:['north first']})}));a.type('Northern stores before southern ones');await a.click('convert-instructions');
  assert.deepEqual(a.calls,[{text:'Northern stores before southern ones'}]);a.el('converted-instructions').value='first stops: 3';a.click('confirm-instructions');assert.equal(a.before(),false);assert.equal(a.el('route-instructions').value,'');
});
test('stale responses, changed routes and cancellations preserve original rules',async()=>{
  let resolve;const a=setup(()=>new Promise(r=>{resolve=r;}));a.el('route-instructions').value='south first';a.type('Northern stores please');const pending=a.click('convert-instructions');a.type('something else');resolve({ok:true,json:async()=>({clauses:['north first']})});await pending;assert.equal(a.el('instruction-review').hidden,true);
  a.type('north first');await a.click('convert-instructions');vm.runInContext('stops.reverse()',a.context);a.click('confirm-instructions');assert.equal(a.el('route-instructions').value,'south first');
  a.click('cancel-instructions');assert.equal(a.before(),true);
});
test('unconfigured backend and malformed rules show errors, never approve a plan',async()=>{
  for(const response of [{ok:false,json:async()=>({error:'not_configured'})},{ok:true,json:async()=>({clauses:['return home']})}]){
    const a=setup(async()=>response);a.type('Northern stores please');await a.click('convert-instructions');assert.equal(a.el('instruction-review').hidden,true);assert.equal(a.before(),false);
  }
});
