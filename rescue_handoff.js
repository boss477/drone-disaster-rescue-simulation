/* Explicit, bounded report metadata handoff. No verified victim coordinates. */
(() => {
  const text=(value,max=240)=>typeof value==='string'?value.slice(0,max):'';
  function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
  function clean(input){
    if(!input || typeof input!=='object')return null;
    const report=input.incident || input;
    const pos=report.location || input;
    const lat=Number(pos.lat),lon=Number(pos.lon);
    if(pos.lat==null || pos.lon==null || !Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
    const out={version:1,title:text(report.title || input.name) || 'Operator-selected area',id:text(report.id),
      kind:text(report.kind,32),feed:text(report.feed || input.source,100),reported_at:text(report.reported_at,64),
      retrieved_at:text(report.retrieved_at,64),location:{lat,lon},
      sources:(Array.isArray(report.sources)?report.sources:[]).slice(0,4).map(s=>({url:safeURL(s.url),id:text(s.id,80)})).filter(s=>s.url)};
    if(input.weather && typeof input.weather==='object'){
      const w=input.weather;
      out.weather={temperature:Number.isFinite(w.temperature)?w.temperature:null,wind:Number.isFinite(w.wind)?w.wind:null,
        rain:Number.isFinite(w.rain)?w.rain:null,time:text(w.time,64),retrieved_at:text(w.retrieved_at,64),source:'Open-Meteo'};
    }
    if(input.review && typeof input.review==='object'){
      const r=input.review;
      out.review={category:text(r.disaster?.category || r.category,80),confidence:Number.isFinite(r.disaster?.confidence)?r.disaster.confidence:Number.isFinite(r.confidence)?r.confidence:null,
        people_count:Number.isSafeInteger(r.people_count)&&r.people_count>=0?r.people_count:null,timestamp:text(r.timestamp,64),geolocation:'unverified'};
    }
    return out;
  }
  function fromURL(search=location.search){
    const raw=new URLSearchParams(search).get('context');
    if(!raw || raw.length>10000)return null;
    try{return clean(JSON.parse(raw));}catch{return null;}
  }
  function sceneURL(input){const data=clean(input);return 'fictional_rescue.html'+(data?'?'+new URLSearchParams({context:JSON.stringify(data)}):'');}
  function godsEyeURL(input){
    const data=clean(input),url=new URL('http://127.0.0.1:4173');
    if(data){url.search=new URLSearchParams({context:JSON.stringify(data)});url.hash=new URLSearchParams({lat:data.location.lat,lon:data.location.lon,alt:8000,pitch:-45,map:'esri-imagery'});}
    return url.href;
  }
  window.RescueHandoff={clean,fromURL,sceneURL,godsEyeURL};
})();
