/* Local candidate screening only. Road totals still come from Directions. */
(function(root) {
  "use strict";
  const radians = Math.PI / 180;
  const wrap = value => ((value + 540) % 360) - 180;
  const address = value => String(value).trim().replace(/\s+/g, " ").toLowerCase();
  function coordinate(location) {
    if (!location) return null;
    const lat = typeof location.lat === "function" ? location.lat() : location.lat;
    const lng = typeof location.lng === "function" ? location.lng() : location.lng;
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180 ? {lat,lng} : null;
  }
  function distance(a,b) {
    const v = Math.sin((a.lat-b.lat)*radians/2)**2 + Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin(wrap(a.lng-b.lng)*radians/2)**2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))));
  }
  function reversal(a,b,c) {
    const scale=Math.cos(b.lat*radians);
    const x=[wrap(b.lng-a.lng)*scale,b.lat-a.lat], y=[wrap(c.lng-b.lng)*scale,c.lat-b.lat];
    const length=Math.hypot(...x)*Math.hypot(...y);
    const cosine=length ? Math.max(-1,Math.min(1,(x[0]*y[0]+x[1]*y[1])/length)) : 1;
    return cosine < -1e-9 ? Math.min(distance(a,b),distance(b,c)) * -cosine : 0;
  }
  function backtracking(points) {
    if(points.some(p=>!p))return {turns:null,meters:null};
    // Consecutive colocated visits remain separate visits, but must not hide
    // the heading change between the incoming and outgoing nonzero legs.
    const distinct=[];
    for(const p of points)if(!distinct.length || distance(p,distinct.at(-1))>1)distinct.push(p);
    let turns=0,meters=0;
    for(let i=1;i<distinct.length-1;i++) {
      const excess=reversal(distinct[i-1],distinct[i],distinct[i+1]);
      if(excess>0){turns++;meters+=excess;}
    }
    return {turns,meters};
  }
  function routeKey(indices,stops,origin,finish,reverseEquivalent=false) {
    const path=[origin,...indices.map(i=>stops[i]),finish].map(address).filter((p,i,all)=>!i || p!==all[i-1]);
    const forward=JSON.stringify(path);
    // Only use this equivalence for screening. Do not assume equal road costs
    // for two already-measured, oppositely directed routes.
    return reverseEquivalent && address(origin)===address(finish) ? [forward,JSON.stringify([...path].reverse())].sort()[0] : forward;
  }
  function createModel(legs,indices,count,firstFlags,priority,cutoff) {
    const points=Array(count+2);
    points[0]=coordinate(legs[0]?.start_location);
    indices.forEach((id,i)=>{points[id+1]=coordinate(legs[i]?.end_location);});
    points[count+1]=coordinate(legs.at(-1)?.end_location);
    if(Array.from(points).some(p=>!p))return null;
    const size=points.length, matrix=new Float64Array(size*size);
    for(let a=0;a<size;a++)for(let b=a+1;b<size;b++)matrix[a*size+b]=matrix[b*size+a]=distance(points[a],points[b]);
    const geo=(a,b)=>matrix[a*size+b];
    // Classify once from the locating pass; never change job constraints when
    // another candidate returns a slightly different geocoded coordinate.
    const tiers=firstFlags.map((first,i)=>first?0:priority==="north"?(points[i+1].lat>=cutoff?1:2):priority==="south"?(points[i+1].lat<cutoff?1:2):1);
    const times=new Map();
    let secondsPerMeter=1/20;
    function learn(routeLegs,order) {
      const ids=[0,...order.map(i=>i+1),count+1];
      let seconds=0,meters=0;
      routeLegs.forEach((leg,i)=>{
        if(leg.duration && Number.isFinite(leg.duration.value))times.set(ids[i]*size+ids[i+1],leg.duration.value);
        seconds+=leg.duration?.value || 0; meters+=geo(ids[i],ids[i+1]);
      });
      if(meters>0 && seconds>0)secondsPerMeter=seconds/meters;
    }
    learn(legs,indices);
    const time=(a,b)=>times.get(a*size+b) ?? geo(a,b)*secondsPerMeter;
    function metrics(order,objective) {
      const ids=[0,...order.map(i=>i+1),count+1];
      let meters=0,seconds=0;
      for(let i=1;i<ids.length;i++){meters+=geo(ids[i-1],ids[i]);seconds+=time(ids[i-1],ids[i]);}
      const detour=backtracking(ids.map(i=>points[i]));
      return {distance:meters,predictedDuration:seconds,reversalMeters:detour.meters,
        score:objective==="time"?seconds:objective==="backtracking"?meters+detour.meters:meters};
    }
    function generate(objective,primary=false) {
      const pool=[],seen=new Set(),groups=[...new Set(tiers)].sort((a,b)=>a-b);
      const edge=objective==="time"?time:geo;
      const add=ids=>{
        const order=ids.slice(1,-1).map(i=>i-1),key=order.join(",");
        if(!seen.has(key)){seen.add(key);pool.push({indices:order,...metrics(order,objective)});}
      };
      for(let seed=0;seed<(primary?1:6);seed++) {
        const ids=[0];
        for(const tier of groups) {
          const remaining=new Set(tiers.flatMap((t,i)=>t===tier?[i+1]:[]));
          let first=true;
          while(remaining.size) {
            const prev=ids.at(-1),before=ids.at(-2);
            const ranked=[...remaining].map(id=>({id,cost:edge(prev,id)+(objective==="backtracking" && before!==undefined?reversal(points[before],points[prev],points[id]):0)}))
              .sort((a,b)=>a.cost-b.cost || a.id-b.id);
            const next=ranked[first?Math.min(seed,ranked.length-1):0].id;
            first=false;remaining.delete(next);ids.push(next);
          }
        }
        ids.push(count+1);add(ids);
        if(objective==="time") {
          // Directed relocation uses learned road times where available, with
          // a geographic speed estimate for unmeasured edges. No matrix API.
          for(let pass=0;pass<4;pass++) {
            let changed=false;
            for(let i=1;i<ids.length-1;i++)for(let j=1;j<ids.length-1;j++) {
              if(j===i || j===i-1 || tiers[ids[i]-1]!==tiers[ids[j]-1])continue;
              const [a,x,b]=ids.slice(i-1,i+2),c=ids[j],d=ids[j+1];
              const delta=edge(a,b)+edge(c,x)+edge(x,d)-edge(a,x)-edge(x,b)-edge(c,d);
              if(delta < -1e-6){ids.splice(i,1);ids.splice(j<i?j+1:j,0,x);changed=true;break;}
            }
            if(!changed)break;
          }
        } else {
          for(let pass=0;pass<(primary?4:8);pass++) {
            let changed=false;
            for(let i=1;i<ids.length-2;i++)for(let j=i+1;j<ids.length-1;j++) {
              if(tiers[ids[i]-1]!==tiers[ids[j]-1])break;
              if(geo(ids[i-1],ids[j])+geo(ids[i],ids[j+1])+1e-6 < geo(ids[i-1],ids[i])+geo(ids[j],ids[j+1])) {
                ids.splice(i,j-i+1,...ids.slice(i,j+1).reverse());changed=true;
              }
            }
            if(!changed)break;
          }
        }
        add(ids);
      }
      return pool.sort((a,b)=>a.score-b.score || a.distance-b.distance);
    }
    return {tiers,generate,metrics,learn,primary:()=>generate("fuel",true)[0]};
  }
  const api={coordinate,distance,backtracking,routeKey,createModel};
  if(typeof module!=="undefined" && module.exports)module.exports=api;
  root.D7Planning=api;
})(globalThis);
