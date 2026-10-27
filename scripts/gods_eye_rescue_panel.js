import {application} from '/src/main.js';
import * as Cesium from 'cesium';
import {installNewYork} from '/__rescue/nyc.js';
const rescueOrigin=__RESCUE_ORIGIN__,backend='/__rescue/backend';
let report=RescueHandoff.fromURL(),viewer=null,markers=null,visible=[],review=null,imageBlob=null,stream=null;
let busy=false,refreshBusy=false,selectionVersion=0,frame=null,previousRenderLoop=true;
const feeds={eonet:{events:[],error:false},usgs:{events:[],error:false}};
const root=document.createElement('div');root.id='droneRescueBridge';
const shadow=root.attachShadow({mode:'open'});
shadow.innerHTML=`<style>
 :host{position:fixed;z-index:5000;left:16px;bottom:150px;width:330px;max-width:calc(100vw - 32px);color:#e9f6f1;font:12px Segoe UI,sans-serif}
 details{border:1px solid #76c3a966;border-radius:12px;background:#122c32f5;padding:15px;box-shadow:0 6px 30px #0005;max-height:calc(100vh - 210px);overflow:auto}summary{cursor:pointer;font-weight:700;color:#94efd1;letter-spacing:.6px}
 p{line-height:1.5;color:#c0d7d0;margin:9px 0}button{display:block;margin-top:9px;background:#a0e8c8;color:#123d33;padding:10px;border:0;border-radius:7px;font:inherit;cursor:pointer;text-align:left}small{color:#b0c9c2;font-size:10px;line-height:1.5}a{color:#99e7c8}button:disabled{opacity:.4;cursor:default}.secondary{background:#284a4c!important;color:#e9f6f1!important}
 .tabs,.row{display:flex;gap:6px;align-items:center}.tabs{margin:12px 0}.tabs button{flex:1;margin:0;padding:8px;text-align:center}.tabs button[aria-selected=false]{background:#284a4c;color:#d6ebe3}
 select,input{box-sizing:border-box;background:#18383e;color:#e9f6f1;border:1px solid #66988a66;border-radius:6px;padding:7px;font:inherit;width:100%}label{display:block;font-size:10px;color:#c3dad2;margin:8px 0}#events{max-height:180px;overflow:auto;margin-top:8px}#events button{width:100%;background:#24474a;color:#e9f6f1;border-left:3px solid #e4b367;font-size:11px;margin-top:5px;padding:8px}#events button small{display:block;margin-top:4px}
 [hidden]{display:none!important}canvas,video{width:100%;margin-top:10px;border-radius:6px}#weather{border-top:1px solid #ffffff22;padding-top:9px}#result{font-size:11px;line-height:1.5;white-space:pre-line}#train{display:inline-block;margin:12px 0;font-size:10px}#context{font-weight:600}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #ffdb8a;outline-offset:2px}
 </style><details open><summary>DRONE RESCUE · OPERATIONS</summary><p id="context"></p><small>Public reports provide context. Harbour Ward, its people, hazards and deliveries are fictional.</small>
 <button id="nyc" class="secondary">New York · 3D buildings →</button><div id="nycControls" hidden><label>Building dataset<select id="nycSource"><option value="nyc">Curated NYC · try first</option><option value="osm">OSM building shapes</option></select></label><label>Curated asset ID from your ion account<input id="nycAsset" type="number" min="1" step="1" value="75343"></label><label>City view<select id="nycView"><option value="downtown">Lower Manhattan</option><option value="midtown">Midtown Manhattan</option><option value="city">Citywide overview</option></select></label><button id="nycHide" class="secondary">Hide buildings</button><p id="nycStatus" role="status"></p><small id="nycNotice"></small><p><a href="https://ion.cesium.com/assetdepot/75343" target="_blank" rel="noopener">Enable curated NYC in Cesium ion ↗</a></p><small>Real building geometry; geometry detail and age vary. These layers do not contain photorealistic facade textures.</small></div>
 <button id="launch">Enter 3D rescue mission →</button><a id="train">Open district as a separate page ↗</a><small style="display:block">Collapse this panel to reach God’s Eye View’s native controls underneath.</small>
 <div class="tabs" role="tablist" aria-label="Rescue tools"><button role="tab" id="reportsTab" aria-selected="true">Reports</button><button role="tab" id="aiTab" aria-selected="false">Image AI</button><button role="tab" id="contextTab" aria-selected="false">Context</button></div>
 <section id="reportsPane"><div class="row"><label>Report age<select id="age"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="all">All dates</option></select></label><label>Category<select id="kind"><option value="all">All hazards</option><option value="fire">Fire</option><option value="flood">Flood</option><option value="storm">Storm</option><option value="earthquake">Earthquake</option><option value="volcano">Volcano</option><option value="landslide">Landslide</option><option value="other">Other</option></select></label></div><input id="search" placeholder="Filter report names" aria-label="Filter rescue reports"><div class="row"><button id="refresh" class="secondary">Refresh feeds</button><button id="global" class="secondary">Whole Earth</button></div><p id="feedStatus" role="status">Loading public reports…</p><small id="count"></small><div id="events"></div><small>NASA EONET open records + USGS M2.5+ past-day earthquakes. Reports can be delayed; no marker does not establish safety.</small></section>
 <section id="aiPane" hidden><p>Review one photo with pretrained CLIP and YOLO. Results are estimates; image geolocation is unverified.</p><input id="image" type="file" accept="image/*" aria-label="Choose rescue image"><div class="row"><button id="analyse" disabled>Analyse image</button><button id="camera" class="secondary">Camera</button><button id="stopCamera" class="secondary" hidden>Stop</button></div><video id="cameraView" autoplay muted playsinline hidden></video><canvas id="preview" hidden></canvas><p id="visionStatus" role="status">Choose an image or capture a camera frame.</p><div id="result"></div><button id="useReview" disabled>Attach AI review to exercise</button><small>First use may download weights; subsequent reviews reuse the cache. Scene recipients remain fictional.</small></section>
 <section id="contextPane" hidden><p id="provenance"></p><a id="source" target="_blank" rel="noopener" hidden>Original report ↗</a><p id="weather"></p><button id="centre" class="secondary">Use current map centre</button><p id="reviewStatus"></p><a id="reports">Legacy dashboard + SITL tools ↗</a><p><small>God’s Eye View’s native layers, weather, cameras, styles and provider settings remain available in its own controls.</small></p></section></details>`;
document.body.append(root);
const el=id=>shadow.getElementById(id);
const nyc=installNewYork({application,el});
el('reports').href=rescueOrigin+'/earth_rescue.html?incidents=1';
const colors={fire:'#ff9b55',flood:'#55c7f0',storm:'#c49aff',earthquake:'#ffd67b',volcano:'#f76a65',landslide:'#c4ae89',other:'#a0d1c5'};
function tab(name){for(const t of ['reports','ai','context']){el(t+'Pane').hidden=t!==name;el(t+'Tab').setAttribute('aria-selected',String(t===name));}}
for(const t of ['reports','ai','context'])el(t+'Tab').onclick=()=>tab(t);
function show(){
  el('context').textContent=report?`${report.title} · ${report.location.lat.toFixed(4)}, ${report.location.lon.toFixed(4)}`:'Choose a report, or use the map centre for a fictional exercise.';
  el('train').href=new URL(RescueHandoff.sceneURL(report),rescueOrigin).href;
  el('provenance').textContent=report?`${report.feed || 'operator placement'} · reported ${report.reported_at || 'unknown'} · retrieved ${report.retrieved_at || 'unknown'}. Reported point/centroid; safe drop location unverified.`:'No real incident selected.';
  el('source').hidden=!report?.sources[0];if(report?.sources[0])el('source').href=report.sources[0].url;
  const w=report?.weather;
  el('weather').textContent=w?`Open-Meteo snapshot: ${w.temperature ?? '?'} °C · wind ${w.wind ?? '?'} km/h · rain ${w.rain ?? '?'} mm · ${w.time} · retrieved ${w.retrieved_at}. Does not control the flight.`:'No weather snapshot attached.';
  el('reviewStatus').textContent=report?.review?`AI estimate: ${report.review.category || 'unavailable'} · possible people ${report.review.people_count ?? 'unavailable'} · ${report.review.timestamp}. Geolocation unverified.`:'No image review attached.';
}
function normaliseNASA(event,time){
  const geo=[...(event.geometry || [])].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];if(!geo?.coordinates)return null;
  const points=[];
  function walk(v,depth=0){if(!Array.isArray(v)||depth>5)return;if(typeof v[0]==='number'){if(Number.isFinite(v[0])&&Number.isFinite(v[1])&&Math.abs(v[0])<=180&&Math.abs(v[1])<=90)points.push(v);}else v.forEach(p=>walk(p,depth+1));}
  walk(geo.coordinates);if(!points.length)return null;
  const location={lat:points.reduce((s,p)=>s+p[1],0)/points.length,lon:Math.atan2(points.reduce((s,p)=>s+Math.sin(p[0]*Math.PI/180),0),points.reduce((s,p)=>s+Math.cos(p[0]*Math.PI/180),0))*180/Math.PI};
  const names=(event.categories || []).map(c=>c.title).join(' ').toLowerCase();
  const kind=/wildfire/.test(names)?'fire':/flood/.test(names)?'flood':/storm/.test(names)?'storm':/volcan/.test(names)?'volcano':/landslide/.test(names)?'landslide':'other';
  return RescueHandoff.clean({id:event.id,title:event.title,kind,feed:'NASA EONET',reported_at:geo.date,retrieved_at:time,location,sources:event.sources});
}
const allReports=()=>[...feeds.eonet.events,...feeds.usgs.events];
function renderReports(){
  const age=el('age').value,kind=el('kind').value,query=el('search').value.trim().toLowerCase();
  visible=allReports().filter(r=>(age==='all'||Date.parse(r.reported_at)>=Date.now()-Number(age)*86400000)&&(kind==='all'||r.kind===kind)&&r.title.toLowerCase().includes(query)).sort((a,b)=>Date.parse(b.reported_at)-Date.parse(a.reported_at));
  el('count').textContent=`${visible.length} matching reports / ${allReports().length} records · first 80 listed, first 600 mapped`;
  el('events').replaceChildren();
  for(const r of visible.slice(0,80)){
    const b=document.createElement('button');b.dataset.reportId=r.id;b.style.borderColor=colors[r.kind];b.textContent=r.title;
    const meta=document.createElement('small');meta.textContent=`${r.feed} · ${r.kind} · ${new Date(r.reported_at).toLocaleString()}`;b.append(meta);b.onclick=()=>selectReport(r);el('events').append(b);
  }
  if(markers){markers.entities.removeAll();for(const r of visible.slice(0,600)){
    const e=markers.entities.add({id:'rescue-'+r.id,position:Cesium.Cartesian3.fromDegrees(r.location.lon,r.location.lat,0),point:{pixelSize:11,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,color:Cesium.Color.fromCssColorString(colors[r.kind] || colors.other),outlineColor:Cesium.Color.BLACK,outlineWidth:1},name:r.title});e.rescueReportId=r.id;
  }viewer.scene.requestRender();}
}
async function refresh(){
  if(refreshBusy)return;refreshBusy=true;el('refresh').disabled=true;el('feedStatus').textContent='Refreshing NASA EONET and USGS…';
  const time=new Date().toISOString(),urls=['https://eonet.gsfc.nasa.gov/api/v3/events?status=open','https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'];
  const results=await Promise.allSettled(urls.map(async (url,i)=>{const r=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok)throw Error(r.status);const data=await r.json();if(!Array.isArray(i===0?data?.events:data?.features))throw Error('Invalid feed response');return data;}));
  for(let i=0;i<results.length;i++){
    const result=results[i],feed=feeds[i===0?'eonet':'usgs'];feed.error=result.status==='rejected';if(feed.error)continue;
    if(i===0)feed.events=(result.value.events || []).map(e=>normaliseNASA(e,time)).filter(Boolean);
    else feed.events=(result.value.features || []).filter(f=>f.properties?.type==='earthquake'&&f.geometry?.type==='Point'&&Array.isArray(f.geometry.coordinates)&&Number.isFinite(f.properties.time)&&Math.abs(f.properties.time)<8.64e15).map(f=>RescueHandoff.clean({id:'usgs-'+f.id,title:f.properties.title,kind:'earthquake',feed:'USGS',reported_at:new Date(f.properties.time).toISOString(),retrieved_at:time,location:{lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]},sources:[{id:'USGS',url:f.properties.url}]})).filter(Boolean);
  }
  const failures=Object.entries(feeds).filter(([,f])=>f.error).map(([key])=>key==='eonet'?'NASA EONET':'USGS');
  el('feedStatus').textContent=`Checked ${new Date(time).toLocaleTimeString()} · `+(failures.length?`${failures.join(' + ')} unavailable; retained reports may be stale.`:'NASA EONET + USGS connected.');
  refreshBusy=false;el('refresh').disabled=false;renderReports();
}
async function selectReport(input,fly=true){
  report=RescueHandoff.clean(input);const version=++selectionVersion;if(!report)return;show();
  if(viewer&&fly){
    const c=Cesium.Cartographic.fromDegrees(report.location.lon,report.location.lat),height=viewer.scene.globe.getHeight(c)||0;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(report.location.lon,report.location.lat,height),1000),
      {offset:new Cesium.HeadingPitchRange(0,-Math.PI/3,14000),duration:1.5});
  }
  el('weather').textContent='Loading Open-Meteo weather snapshot…';
  try{
    const q=new URLSearchParams({latitude:report.location.lat,longitude:report.location.lon,current:'temperature_2m,wind_speed_10m,rain,showers',timezone:'auto'});
    const response=await fetch('https://api.open-meteo.com/v1/forecast?'+q,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();
    const data=await response.json();if(version!==selectionVersion)return;
    report.weather={temperature:data.current.temperature_2m,wind:data.current.wind_speed_10m,rain:Number(data.current.rain || 0)+Number(data.current.showers || 0),time:data.current.time+' '+(data.timezone_abbreviation || ''),retrieved_at:new Date().toISOString(),source:'Open-Meteo'};show();
  }catch{if(version===selectionVersion)el('weather').textContent='Weather unavailable. Fictional training still works.';}
}
el('refresh').onclick=refresh;el('age').onchange=renderReports;el('kind').onchange=renderReports;el('search').oninput=renderReports;
el('global').onclick=()=>viewer?.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(20,15,22000000),orientation:{pitch:-Math.PI/2,heading:0,roll:0},duration:1.5});
el('centre').onclick=async()=>{
  await application.start();const pixel=new Cesium.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2),ray=viewer.camera.getPickRay(pixel);
  const hit=(ray&&viewer.scene.globe.pick(ray,viewer.scene))||viewer.camera.pickEllipsoid(pixel,viewer.scene.globe.ellipsoid);
  if(!hit){el('context').textContent='Point the camera at the ground, then try again.';return;}
  const c=Cesium.Cartographic.fromCartesian(hit);
  selectReport({title:'Operator-selected globe area',feed:'God’s Eye View · operator placement',retrieved_at:new Date().toISOString(),location:{lat:Cesium.Math.toDegrees(c.latitude),lon:Cesium.Math.toDegrees(c.longitude)}},false);
};
function closeTraining(){document.getElementById('rescueTrainingOverlay')?.remove();frame=null;if(viewer){viewer.useDefaultRenderLoop=previousRenderLoop;viewer.scene.requestRender();}}
el('launch').onclick=()=>{
  if(frame)return;
  stopCamera();
  const overlay=document.createElement('section');overlay.id='rescueTrainingOverlay';overlay.setAttribute('aria-label','Fictional rescue training');
  overlay.style.cssText='position:fixed;inset:0;z-index:12000;background:#122b31;display:flex;flex-direction:column';
  const toolbar=document.createElement('div');toolbar.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:9px 18px;font:12px Segoe UI,sans-serif;color:#e9f6f1';
  const title=document.createElement('span');title.textContent='God’s Eye View / Harbour Ward · FICTIONAL TRAINING';
  const close=document.createElement('button');close.id='closeRescueTraining';close.textContent='Return to globe ✕';close.onclick=closeTraining;close.style.cssText='background:#a0e8c8;border:0;border-radius:6px;padding:9px;cursor:pointer';toolbar.append(title,close);
  frame=document.createElement('iframe');frame.title='Harbour Ward fictional rescue';frame.id='rescueTrainingFrame';frame.src=backend+'/'+RescueHandoff.sceneURL(report);frame.style.cssText='border:0;flex:1;width:100%;min-height:0';overlay.append(toolbar,frame);document.body.append(overlay);
  if(viewer){previousRenderLoop=viewer.useDefaultRenderLoop;viewer.useDefaultRenderLoop=false;}close.focus();
};
addEventListener('keydown',e=>{if(e.key==='Escape'&&frame)closeTraining();});
async function preview(blob){
  const bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'}),c=el('preview'),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  c.width=Math.round(bitmap.width*scale);c.height=Math.round(bitmap.height*scale);c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();
  imageBlob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.9));c.hidden=false;review=null;el('result').textContent='';el('useReview').disabled=true;el('analyse').disabled=false;el('visionStatus').textContent='Ready to analyse disaster type and possible people.';
}
el('image').onchange=async event=>{if(busy||!event.target.files[0])return;try{await preview(event.target.files[0]);}catch(error){el('visionStatus').textContent='Cannot load image: '+error.message;}};
el('analyse').onclick=async()=>{
  if(!imageBlob||busy)return;busy=true;el('analyse').disabled=true;el('image').disabled=true;el('camera').disabled=true;el('useReview').disabled=true;
  try{
    const c=el('preview'),ctx=c.getContext('2d'),bitmap=await createImageBitmap(imageBlob);ctx.drawImage(bitmap,0,0,c.width,c.height);bitmap.close();el('visionStatus').textContent='Starting CLIP + YOLO. First use may download weights; later runs reuse the cache.';
    const response=await fetch(backend+'/api/vision',{method:'POST',body:imageBlob});if(!response.ok)throw Error(response.status===409?'Another review is running; wait and retry.':'Vision backend unavailable ('+response.status+').');
    const start=Date.now();
    while(Date.now()-start<15*60*1000){
      const poll=await fetch(backend+'/api/vision',{cache:'no-store'});if(!poll.ok)throw Error('Cannot read vision progress.');const job=await poll.json();
      if(job.status==='complete'){
        review=job.result;const lines=[];
        if(review.disaster){lines.push('AI disaster estimate: '+review.disaster.category);for(const [name,score]of Object.entries(review.disaster.scores || {}))lines.push(`${name}: ${(score*100).toFixed(1)}%`);}
        if('people_count'in review)lines.push('Possible people: '+review.people_count);for(const [name,error]of Object.entries(review.errors || {}))lines.push(name+' unavailable: '+error);el('result').textContent=lines.join('\n');
        ctx.strokeStyle='#64ffad';ctx.fillStyle='#64ffad';ctx.lineWidth=2;ctx.font='16px sans-serif';
        for(const b of review.boxes || []){const [x1,y1,x2,y2]=b.xyxy,sx=c.width/review.width,sy=c.height/review.height;ctx.strokeRect(x1*sx,y1*sy,(x2-x1)*sx,(y2-y1)*sy);ctx.fillText('possible person',x1*sx,Math.max(16,y1*sy-4));}
        el('visionStatus').textContent=`AI review: ${review.elapsed_seconds}s · ${review.timestamp}. Scores are not calibrated probabilities.`;el('useReview').disabled=!review.disaster&&!('people_count'in review);return;
      }
      el('visionStatus').textContent=job.message || 'Analysing…';await new Promise(resolve=>setTimeout(resolve,1000));
    }throw Error('Review timed out; check the model download and retry.');
  }catch(error){el('visionStatus').textContent=error.message;}
  finally{busy=false;el('analyse').disabled=!imageBlob;el('image').disabled=false;el('camera').disabled=false;}
};
el('useReview').onclick=()=>{if(!report){el('visionStatus').textContent='Select a report or map centre first. Image geolocation is unverified.';return;}report=RescueHandoff.clean({...report,review});show();el('visionStatus').textContent='AI estimate attached. People in Harbour Ward remain fictional.';};
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;el('cameraView').srcObject=null;el('cameraView').hidden=true;el('stopCamera').hidden=true;el('camera').textContent='Camera';}
el('camera').onclick=async()=>{
  try{if(!stream){stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});el('cameraView').srcObject=stream;el('cameraView').hidden=false;el('stopCamera').hidden=false;el('camera').textContent='Capture';}
    else{const v=el('cameraView');if(!v.videoWidth)return;const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);await preview(await new Promise(resolve=>c.toBlob(resolve,'image/jpeg')));}}
  catch(error){el('visionStatus').textContent='Camera unavailable: '+error.message;}
};
el('stopCamera').onclick=stopCamera;addEventListener('pagehide',stopCamera);
show();refresh();const timer=setInterval(refresh,5*60*1000);
application.start().then(()=>{
  viewer=application.getComponents().scene.viewer;markers=new Cesium.CustomDataSource('Rescue public reports');viewer.dataSources.add(markers);renderReports();
  const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click=>{const picked=viewer.scene.pick(click.position),id=picked?.id?.rescueReportId;if(id){const r=allReports().find(r=>r.id===id);if(r)selectReport(r);}},Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if(report)selectReport(report,false);addEventListener('pagehide',()=>{handler.destroy();clearInterval(timer);},{once:true});
}).catch(error=>{el('feedStatus').textContent='Globe startup failed: '+error.message;});
window.RescueOperations={getState:()=>({report,visible:visible.map(r=>({id:r.id,kind:r.kind})),records:allReports().length,refreshBusy,training:!!frame}),
  markerScreens:()=>!viewer?[]:visible.slice(0,600).map(r=>{const c=Cesium.Cartographic.fromDegrees(r.location.lon,r.location.lat),h=viewer.scene.globe.getHeight(c)||0;
    const p=Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene,Cesium.Cartesian3.fromDegrees(r.location.lon,r.location.lat,h));return {id:r.id,x:p?.x,y:p?.y};}),
  selectReport:id=>{const r=allReports().find(r=>r.id===id);if(r)selectReport(r);},closeTraining};
