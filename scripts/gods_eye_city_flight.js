import * as Cesium from 'cesium';
import {holdContinuousRender,releaseContinuousRender} from '/src/renderGovernor.js';
import {greatCircleRoute} from '/__rescue/city-route.mjs';

export function installCityFlight({application,el,nyc}){
  let viewer=null,drone=null,path=null,running=false,paused=false,following=false,planning=false,generation=0;
  let route=[],distance=0,length=0,ground=0,cruise=0,sampled=0,lastTime=performance.now(),lastLabel=0,modelReady=false;
  let position=new Cesium.Cartesian3(),orientation=new Cesium.Quaternion(),centre=null;
  let mode='hover',destination=null,destinationMarker=null,arrived=false,timeScale=1,cumulative=[];
  let picking=false,pickHandler=null,pickRestore=null,oldCursor='';
  let directClicks=true,rescueSelecting=false;
  let rescue={stage:'idle',onboard:0,delivered:0,elapsed:0,base:null,target:null},parcel=null;
  let cameraTilt=55,cameraOrbit=0,cameraOffset=0,lastCameraProbe=0,cameraDistance=220;
  const rescueActive=()=>['loading','outbound','unloading','returning'].includes(rescue.stage);
  const owner='rescue-city-flight';
  const toolbar=document.createElement('div');toolbar.id='cityDirectFlight';
  toolbar.style.cssText='position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:7000;max-width:calc(100vw - 24px);width:540px;background:#123132f5;border:1px solid #80e2ba;border-radius:12px;padding:12px 16px;color:#e5fff1;font:12px Segoe UI,sans-serif;box-shadow:0 5px 24px #0006';
  toolbar.innerHTML='<b>DRONE FLIGHT + RESCUE · v3 · SIMULATION</b><label style="float:right;cursor:pointer"><input id="cityDirectToggle" type="checkbox" checked> Map clicks fly</label><p id="cityQuickStatus" style="margin:8px 0">Loading drone controls…</p><div style="display:flex;gap:6px;flex-wrap:wrap"><button id="cityQuickPlace">Place in this view</button><button id="cityFlyForward">Fly forward 120 m</button><button id="cityRescue">Start rescue</button><button id="cityAbortRescue">Abort rescue</button><button id="cityQuickPause">Pause</button><button id="cityQuickFollow">Follow drone</button><button id="cityQuickReset">Reset</button></div><p id="cityRescueInventory" style="margin:8px 0 0">Simulated supplies · onboard 0 · delivered 0</p>';
  for(const b of toolbar.querySelectorAll('button'))b.style.cssText='background:#a7e7c7;color:#153e33;border:0;border-radius:6px;padding:8px 10px;cursor:pointer;font:inherit';
  document.body.append(toolbar);
  toolbar.querySelector('b').textContent='DRONE FLIGHT + RESCUE · v4 · TILTED 3D';
  const cameraControls=document.createElement('div');cameraControls.style.cssText='display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap';
  cameraControls.innerHTML='<label>3D tilt <input id="cityCameraTilt" type="range" min="30" max="80" value="55" style="width:110px;vertical-align:middle"> <span id="cityCameraTiltValue">55°</span></label><button id="cityCameraOrbit">Rotate view ↻</button>';
  toolbar.append(cameraControls);document.getElementById('cityCameraOrbit').style.cssText=toolbar.querySelector('button').style.cssText;
  const applyCamera=()=>{lastCameraProbe=0;if(!drone)return;following=true;viewer.camera.cancelFlight();el('cityFollow').textContent='Free camera';place();viewer.scene.requestRender();};
  document.getElementById('cityCameraTilt').oninput=event=>{cameraTilt=Number(event.target.value);document.getElementById('cityCameraTiltValue').textContent=cameraTilt+'°';applyCamera();};
  document.getElementById('cityCameraOrbit').onclick=()=>{cameraOrbit+=Math.PI/4;cameraOffset=0;applyCamera();};
  const buttonStyle=document.createElement('style');buttonStyle.textContent='#cityDirectFlight button:disabled{opacity:.4;cursor:not-allowed!important}';toolbar.append(buttonStyle);
  const selectRescue=document.createElement('button');selectRescue.id='cityRescueDrop';selectRescue.textContent='Choose rescue drop';selectRescue.style.cssText=toolbar.querySelector('button').style.cssText;document.getElementById('cityRescue').after(selectRescue);
  selectRescue.onclick=()=>{rescueSelecting=!rescueSelecting;selectRescue.textContent=rescueSelecting?'Cancel drop selection':'Choose rescue drop';if(viewer)viewer.canvas.style.cursor=rescueSelecting?'crosshair':'';el('cityFlightStatus').textContent=rescueSelecting?'Click a drop zone on the map. The drone will load supplies, deliver, and return to base.':'Drop selection cancelled.';};
  const syncToolbar=()=>{document.getElementById('cityQuickStatus').textContent=el('cityFlightStatus').textContent;for(const [button,source]of [['cityQuickPlace','cityFlight'],['cityQuickPause','cityPause'],['cityQuickFollow','cityFollow'],['cityQuickReset','cityReset']]){const b=document.getElementById(button);b.disabled=el(source).disabled;if(button!=='cityQuickPlace')b.textContent=el(source).textContent;}};
  for(const [button,source]of [['cityQuickPlace','cityFlight'],['cityQuickPause','cityPause'],['cityQuickFollow','cityFollow'],['cityQuickReset','cityReset']])document.getElementById(button).onclick=()=>{el(source).click();syncToolbar();};
  document.getElementById('cityDirectToggle').onchange=event=>{directClicks=event.target.checked;el('cityFlightStatus').textContent=directClicks?'Click the map directly to send the drone there.':'Map click-to-fly is off. Use Choose destination when you want to send the drone.';};
  const toolbarObserver=new MutationObserver(syncToolbar);toolbarObserver.observe(el('cityFlightControls'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled']});syncToolbar();
  const needsGlobal=c=>Math.abs(Cesium.Math.toDegrees(c.latitude)-40.7)>.35||Math.abs(Cesium.Math.toDegrees(c.longitude)+74)>.4;
  function updateRescue(){
    document.getElementById('cityRescueInventory').textContent=`SIMULATED RESCUE · ${rescue.stage} · onboard ${rescue.onboard}/3 · delivered ${rescue.delivered}`;
    document.getElementById('cityRescue').disabled=!drone||planning||running||rescueActive();
    document.getElementById('cityFlyForward').disabled=!drone||planning||rescueActive();
    document.getElementById('cityAbortRescue').disabled=!rescueActive();
    selectRescue.disabled=!drone||planning||running||rescueActive();
  }
  function abortRescue(){
    if(!rescueActive())return;
    rescue.stage='aborted';running=false;paused=false;releaseContinuousRender(owner);el('cityPause').disabled=true;
    el('cityFlightStatus').textContent='Rescue aborted. Drone hovering; no further packages released.';updateRescue();
  }
  function forwardTarget(){
    const frame=Cesium.Transforms.eastNorthUpToFixedFrame(position),heading=viewer.camera.heading;
    const point=Cesium.Matrix4.multiplyByPoint(frame,new Cesium.Cartesian3(Math.sin(heading)*120,Math.cos(heading)*120,0),new Cesium.Cartesian3());
    const target=Cesium.Cartographic.fromCartesian(point);target.height=ground;return target;
  }
  function parcelPosition(){
    if(rescue.stage==='unloading'){
      const end=Cesium.Cartesian3.fromRadians(rescue.target.longitude,rescue.target.latitude,Math.max(0,rescue.target.height||0)+2);
      return Cesium.Cartesian3.lerp(position,end,Math.min(1,rescue.elapsed/3),new Cesium.Cartesian3());
    }
    if(rescue.onboard>0){const c=Cesium.Cartographic.fromCartesian(position);return Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,c.height-3);}
    return Cesium.Cartesian3.fromRadians(rescue.target.longitude,rescue.target.latitude,Math.max(0,rescue.target.height||0)+2);
  }
  document.getElementById('cityFlyForward').onclick=()=>navigate(forwardTarget());
  function beginRescue(chosenTarget=null){
    if(!drone||planning||running||rescueActive())return;
    const target=chosenTarget||forwardTarget();
    const base=Cesium.Cartographic.fromCartesian(position);
    if(new Cesium.EllipsoidGeodesic(base,target).surfaceDistance<5){el('cityFlightStatus').textContent='Choose a rescue drop at least 5 metres away.';return;}
    rescue={stage:'loading',onboard:0,delivered:0,elapsed:0,base:Cesium.Cartographic.fromCartesian(position),target};
    if(parcel)viewer.entities.remove(parcel);
    parcel=viewer.entities.add({name:'Simulated aid packages',position:new Cesium.CallbackPositionProperty(()=>parcelPosition(),false),box:{dimensions:new Cesium.Cartesian3(2,2,2),material:Cesium.Color.GOLD},show:false});
    paused=false;el('cityPause').disabled=false;el('cityPause').textContent='Pause';lastTime=performance.now();holdContinuousRender(owner);
    el('cityFlightStatus').textContent='Loading 3 simulated aid packages at base…';updateRescue();
  }
  document.getElementById('cityRescue').onclick=()=>beginRescue();
  document.getElementById('cityAbortRescue').onclick=()=>{generation++;planning=false;el('cityFlight').disabled=false;abortRescue();};
  updateRescue();
  function unpinInitialArea(){const url=new URL(location.href);url.searchParams.delete('flightLat');url.searchParams.delete('flightLon');history.replaceState(history.state,'',url);}
  function freeCamera(){following=false;el('cityFollow').textContent='Follow drone';if(viewer&&!viewer.isDestroyed())viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}
  function reset(){
    stopPicking();
    rescueSelecting=false;selectRescue.textContent='Choose rescue drop';
    generation++;running=false;paused=false;planning=false;releaseContinuousRender(owner);freeCamera();
    if(viewer&&!viewer.isDestroyed()){if(drone)viewer.entities.remove(drone);if(path)viewer.entities.remove(path);if(destinationMarker)viewer.entities.remove(destinationMarker);viewer.scene.requestRender();}
    if(parcel&&viewer&&!viewer.isDestroyed())viewer.entities.remove(parcel);parcel=null;rescue={stage:'idle',onboard:0,delivered:0,elapsed:0,base:null,target:null};
    drone=null;path=null;destinationMarker=null;route=[];distance=0;modelReady=false;mode='hover';destination=null;arrived=false;timeScale=1;cumulative=[];updateRescue();
    el('cityPause').disabled=true;el('cityPause').textContent='Pause';el('cityFlight').disabled=false;
    el('cityFlightStatus').textContent='Ready. Place a drone in this view, or choose a location on the map.';
  }
  function pickCentre(useQuery=false){
    const q=new URLSearchParams(location.search);
    if(useQuery&&q.has('flightLat')&&q.has('flightLon')){
      const lat=Number(q.get('flightLat')),lon=Number(q.get('flightLon'));
      if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<89&&Math.abs(lon)<=180)return Cesium.Cartographic.fromDegrees(lon,lat);
    }
    const pixel=new Cesium.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2),ray=viewer.camera.getPickRay(pixel);
    const point=(ray&&viewer.scene.globe.pick(ray,viewer.scene))||viewer.camera.pickEllipsoid(pixel,viewer.scene.globe.ellipsoid);
    if(!point)throw Error('Point the camera at the ground, then start the drone.');
    return Cesium.Cartographic.fromCartesian(point);
  }
  function followCamera(heading){
    const aim=(offset,range)=>viewer.camera.lookAt(position,new Cesium.HeadingPitchRange(heading+cameraOrbit+offset,-Cesium.Math.toRadians(cameraTilt),range));
    // Keep the requested tilt. If a tower blocks the chase view, try another
    // side of the aircraft, then a closer camera, instead of forcing top-down.
    if(performance.now()-lastCameraProbe>1200){
      lastCameraProbe=performance.now();let clear=false;
      for(const range of [220,90,35]){
        for(let i=0;i<8;i++){
          const offset=cameraOffset+i*Math.PI/4;aim(offset,range);
          const delta=Cesium.Cartesian3.subtract(viewer.camera.positionWC,position,new Cesium.Cartesian3());
          const ray=new Cesium.Ray(position,Cesium.Cartesian3.normalize(delta,new Cesium.Cartesian3()));
          let hit;try{hit=viewer.scene.pickFromRay(ray,viewer.entities.values,.1);}catch{/* unavailable depth */}
          if(!hit?.position||Cesium.Cartesian3.distance(position,hit.position)>range-3){cameraOffset=offset;cameraDistance=range;clear=true;break;}
        }
        if(clear)break;
      }
    }
    aim(cameraOffset,cameraDistance);
  }
  function place(){
    if(!route.length)return;
    if(mode==='hover'){position=Cesium.Cartesian3.clone(route[0]);orientation=Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(0,0,0));if(following)followCamera(Math.PI);return;}
    const travelled=Math.min(distance,length);
    let i=0;while(i<route.length-2&&cumulative[i+1]<travelled)i++;
    const fraction=Math.max(0,Math.min(1,(travelled-cumulative[i])/(cumulative[i+1]-cumulative[i]||1)));
    position=Cesium.Cartesian3.lerp(route[i],route[i+1],fraction,new Cesium.Cartesian3());
    const inverse=Cesium.Matrix4.inverseTransformation(Cesium.Transforms.eastNorthUpToFixedFrame(position),new Cesium.Matrix4());
    const delta=Cesium.Cartesian3.subtract(route[i+1],route[i],new Cesium.Cartesian3());
    const local=Cesium.Matrix4.multiplyByPointAsVector(inverse,delta,new Cesium.Cartesian3()),heading=Math.atan2(local.x,local.y);
    orientation=Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(heading,0,0));
    if(following)followCamera(heading+Math.PI);
  }
  function measureRoute(){cumulative=[0];for(let i=1;i<route.length;i++)cumulative.push(cumulative[i-1]+Cesium.Cartesian3.distance(route[i-1],route[i]));length=cumulative.at(-1);}
  async function start(useQuery=false,targetOverride=null){
    if(planning)return;
    await application.start();viewer=application.getComponents().scene.viewer;
    if(!useQuery)unpinInitialArea();
    const target=targetOverride || pickCentre(useQuery);reset();centre=target;const version=generation;
    planning=true;el('cityFlightControls').hidden=false;el('cityFlight').disabled=true;
    el('cityFlightStatus').textContent='Preparing the drone route and sampling building heights…';
    const preflight=owner+'-prepare-'+version;holdContinuousRender(preflight);
    try{
      const buildings=await nyc.ensureBuildings({global:needsGlobal(target)});
      if(version!==generation)return;
      if(!buildings.visible)throw Error('Enable the 3D building layer, wait for it to load, then retry.');
      // Frame the actual route area before querying heights. This also loads
      // local terrain/imagery when an explicit starting point was off-screen.
      el('cityFlightStatus').textContent='Loading the local streets and terrain…';
      await new Promise(resolve=>viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromRadians(target.longitude,target.latitude,target.height || 0),100),
        {offset:new Cesium.HeadingPitchRange(.3,-.6,450),duration:1,complete:resolve,cancel:resolve}));
      const terrainDeadline=performance.now()+12000;
      await new Promise(resolve=>setTimeout(resolve,250));
      while(version===generation&&!viewer.scene.globe.tilesLoaded&&performance.now()<terrainDeadline)await new Promise(resolve=>setTimeout(resolve,250));
      if(version!==generation)return;
      el('cityFlightStatus').textContent='Sampling the rooftop route…';
      ground=viewer.scene.globe.getHeight(target);
      // Off-screen coarse terrain can return a distant tile's ocean-height
      // estimate. Prefer the picked surface (or explicit-point datum) in that case.
      if(!Number.isFinite(ground)||Math.abs(ground-target.height)>500)ground=target.height || 0;
      const samples=[Cesium.Cartographic.clone(target)];
      let roofs=[];
      if(viewer.scene.sampleHeightSupported){
        let timer;
        try{roofs=await Promise.race([viewer.scene.sampleHeightMostDetailed(samples.map(c=>Cesium.Cartographic.clone(c))),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('height timeout')),18000);})]);}
        catch{roofs=samples.map(c=>{const copy=Cesium.Cartographic.clone(c);copy.height=viewer.scene.sampleHeight(copy);return copy;});}
        finally{clearTimeout(timer);}
      }
      if(version!==generation)return;
      const heights=roofs.map(c=>c?.height).filter(Number.isFinite);sampled=heights.length;
      const terrain=samples.map(c=>viewer.scene.globe.getHeight(c)).filter(h=>Number.isFinite(h)&&Math.abs(h-ground)<500);
      cruise=Math.max(ground,target.height || 0,...terrain,...heights)+(sampled?25:120);
      route=[Cesium.Cartesian3.fromRadians(target.longitude,target.latitude,cruise)];
      cumulative=[0];length=0;distance=0;mode='hover';
      position=Cesium.Cartesian3.clone(route[0]);
      drone=viewer.entities.add({name:'Rescue quadcopter · simulation',
        position:new Cesium.CallbackPositionProperty((time,result)=>Cesium.Cartesian3.clone(position,result),false),
        orientation:new Cesium.CallbackProperty((time,result)=>Cesium.Quaternion.clone(orientation,result),false),
        model:{uri:'/__rescue/backend/vendor/rescue-quadcopter.glb',scale:2,minimumPixelSize:72,maximumScale:18,runAnimations:true,
          silhouetteColor:Cesium.Color.fromCssColorString('#75f4ce'),silhouetteSize:1},
        label:{text:'RESCUE DRONE · SIM',font:'bold 12px sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,
          outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-42),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,600)}});
      following=true;running=false;paused=false;lastTime=performance.now();viewer.camera.cancelFlight();holdContinuousRender(owner);
      el('cityPause').disabled=true;place();freeCamera();
      el('cityFlightStatus').textContent='Ready: press Fly forward or Start rescue, or click a destination on the map.';
      viewer.scene.requestRender();
    }catch(error){if(version===generation)el('cityFlightStatus').textContent=error.message;}
    finally{releaseContinuousRender(preflight);if(version===generation){planning=false;el('cityFlight').disabled=false;updateRescue();}}
  }
  function stopPicking(restore=false){
    if(pickHandler){pickHandler.destroy();pickHandler=null;}
    document.getElementById('cityDestinationHint')?.remove();
    if(viewer&&!viewer.isDestroyed())viewer.canvas.style.cursor=oldCursor;
    el('cityDestination').textContent='Choose destination on map →';
    const prior=pickRestore;pickRestore=null;picking=false;
    if(restore&&prior&&drone){paused=prior.paused;following=prior.following;lastTime=performance.now();
      el('cityPause').textContent=paused?'Resume':'Pause';el('cityFollow').textContent=following?'Free camera':'Follow drone';
      if(running&&!paused)holdContinuousRender(owner);if(following)viewer.camera.cancelFlight();place();}
  }
  function pickGround(pixel){
    let point;
    if(viewer.scene.pickPositionSupported){try{point=viewer.scene.pickPosition(pixel);}catch{/* sky or unloaded depth */}}
    if(point&&Cesium.Cartographic.fromCartesian(point).height>12000)point=null;
    if(!point){const ray=viewer.camera.getPickRay(pixel);point=(ray&&viewer.scene.globe.pick(ray,viewer.scene))||viewer.camera.pickEllipsoid(pixel,viewer.scene.globe.ellipsoid);}
    return point?Cesium.Cartographic.fromCartesian(point):null;
  }
  async function navigate(target,mission=false){
    if(!mission&&rescueActive())abortRescue();
    unpinInitialArea();
    if(!drone){await start(false,target);return;}
    const version=++generation;planning=true;paused=true;arrived=false;releaseContinuousRender(owner);
    el('cityPause').disabled=true;el('cityFlight').disabled=true;el('cityFlightStatus').textContent='Planning flight to the selected destination…';
    const preflight=owner+'-destination-'+version;holdContinuousRender(preflight);
    try{
      if(destinationMarker)viewer.entities.remove(destinationMarker);
      destinationMarker=viewer.entities.add({name:'Planning selected destination',position:Cesium.Cartesian3.fromRadians(target.longitude,target.latitude,Math.max(0,target.height || 0)+10),point:{pixelSize:14,color:Cesium.Color.GOLD,outlineWidth:2,outlineColor:Cesium.Color.BLACK}});
      await nyc.ensureBuildings({global:needsGlobal(target)});if(version!==generation)return;
      const from=Cesium.Cartographic.fromCartesian(position),trip=greatCircleRoute(from,target,128);
      if(trip.surfaceDistance<2){paused=false;el('cityFlightStatus').textContent='The drone is already at that point. Choose a point farther away.';if(mission)abortRescue();return;}
      const samples=trip.points.map(c=>new Cesium.Cartographic(c.longitude,c.latitude,0));
      const localTrip=trip.surfaceDistance<=5000,queries=localTrip?samples:[samples[0],samples.at(-1)];
      const deadlines=[];
      const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>deadlines.push(setTimeout(()=>reject(Error('height timeout')),7000)))]).catch(()=>[]);
      let roofs=[],terrain=[];
      try{[roofs,terrain]=await Promise.all([
        viewer.scene.sampleHeightSupported?bounded(viewer.scene.sampleHeightMostDetailed(queries.map(c=>Cesium.Cartographic.clone(c)),[drone,path,destinationMarker,parcel].filter(Boolean))):[],
        bounded(Cesium.sampleTerrain(viewer.terrainProvider,12,queries.map(c=>Cesium.Cartographic.clone(c))))
      ]);}finally{deadlines.forEach(clearTimeout);}
      if(version!==generation)return;
      // A batch most-detailed query may time out while city tiles are still
      // streaming. Do not discard roof geometry already visible in the scene.
      if(viewer.scene.sampleHeightSupported)roofs=queries.map((c,i)=>{
        const copy=Cesium.Cartographic.clone(c);let height=roofs[i]?.height;
        if(!Number.isFinite(height)){try{height=viewer.scene.sampleHeight(c,[drone,path,destinationMarker,parcel].filter(Boolean));}catch{/* unavailable tile */}}
        copy.height=height;return copy;
      });
      const roofHeights=roofs.map(c=>c?.height).filter(Number.isFinite),terrainHeights=terrain.map(c=>c?.height).filter(Number.isFinite);
      sampled=roofHeights.length;
      const endRoof=roofs.at(-1)?.height,endTerrain=terrain.at(-1)?.height;
      const endHeight=mission&&rescue.stage==='returning'?rescue.base.height:Math.max(0,Number.isFinite(target.height)?target.height:0,Number.isFinite(endRoof)?endRoof:-1000,Number.isFinite(endTerrain)?endTerrain:-1000)+(Number.isFinite(endRoof)?25:120);
      if(mission&&rescue.stage==='outbound')rescue.target.height=Math.max(0,target.height||0,Number.isFinite(endRoof)?endRoof:0,Number.isFinite(endTerrain)?endTerrain:0);
      cruise=localTrip?Math.max(from.height,endHeight,...roofHeights.map(h=>h+25),...terrainHeights.map(h=>h+40)):Math.max(12000,from.height,endHeight);
      route=samples.map((c,i)=>Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,i===0?from.height:i===samples.length-1?endHeight:cruise));
      measureRoute();distance=0;mode='destination';destination=Cesium.Cartographic.clone(target);
      timeScale=length>5000?Math.max(1,length/(Number(el('citySpeed').value)*90)):1;
      if(path)viewer.entities.remove(path);if(destinationMarker)viewer.entities.remove(destinationMarker);
      path=viewer.entities.add({name:'Selected destination · simulated route',polyline:{positions:route,arcType:Cesium.ArcType.NONE,width:3,material:Cesium.Color.CYAN.withAlpha(.8)}});
      destinationMarker=viewer.entities.add({name:'Selected drone destination · simulated',position:route.at(-1),
        point:{pixelSize:14,color:Cesium.Color.GOLD,outlineColor:Cesium.Color.BLACK,outlineWidth:2},
        label:{text:'DRONE DESTINATION · SIM',font:'12px sans-serif',pixelOffset:new Cesium.Cartesian2(0,-24),fillColor:Cesium.Color.GOLD,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE}});
      running=true;paused=false;following=true;lastTime=performance.now();viewer.camera.cancelFlight();holdContinuousRender(owner);
      el('cityPause').disabled=false;el('cityPause').textContent='Pause';el('cityFollow').textContent='Free camera';place();viewer.scene.requestRender();
    }catch(error){if(version===generation){if(mission)abortRescue();el('cityFlightStatus').textContent='Cannot plan this route: '+error.message;}}
    finally{releaseContinuousRender(preflight);if(version===generation){planning=false;el('cityFlight').disabled=false;el('cityPause').disabled=!running&&!rescueActive();updateRescue();}}
  }
  el('cityDestination').onclick=async()=>{
    if(picking){stopPicking(true);return;}
    if(planning){el('cityFlightStatus').textContent='Wait for route planning, or press Reset before choosing another destination.';return;}
    await application.start();viewer=application.getComponents().scene.viewer;
    pickRestore={paused,following};if(running){paused=true;releaseContinuousRender(owner);el('cityPause').textContent='Resume';}
    freeCamera();picking=true;oldCursor=viewer.canvas.style.cursor;viewer.canvas.style.cursor='crosshair';el('cityFlightControls').hidden=false;
    el('cityDestination').textContent='Cancel destination selection';el('cityFlightStatus').textContent=drone?'Pan or zoom, then click anywhere on the ground to send the drone there.':'Click anywhere on the globe to place and fly the drone there.';
    const hint=document.createElement('div');hint.id='cityDestinationHint';hint.textContent='CLICK A DESTINATION ON THE MAP · Esc to cancel';
    hint.style.cssText='position:fixed;top:225px;left:50%;transform:translateX(-50%);z-index:8000;background:#173b3bf2;border:1px solid #8ee6c4;border-radius:10px;padding:12px 18px;color:#d9ffee;font:12px Segoe UI,sans-serif;pointer-events:none';document.body.append(hint);
    pickHandler=new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    pickHandler.setInputAction(click=>{
      if(!picking)return;const target=pickGround(click.position);
      if(!target){el('cityFlightStatus').textContent='Click the Earth or a building, not the sky.';return;}
      stopPicking();navigate(target).catch(error=>{el('cityFlightStatus').textContent=error.message;});
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
  };
  addEventListener('keydown',event=>{if(event.key==='Escape'&&picking){stopPicking(true);el('cityFlightStatus').textContent='Destination selection cancelled.';}});
  el('cityFlight').onclick=()=>start().catch(error=>{el('cityFlightControls').hidden=false;el('cityFlightStatus').textContent=error.message;});
  el('cityReset').onclick=reset;
  el('cityPause').onclick=()=>{
    if(!running&&!rescueActive())return;paused=!paused;el('cityPause').textContent=paused?'Resume':'Pause';lastTime=performance.now();
    if(paused)releaseContinuousRender(owner);else holdContinuousRender(owner);
    el('cityFlightStatus').textContent=paused?'Flight paused.':'Flight resumed · simulation.';
  };
  el('cityFollow').onclick=()=>{if(!drone)return;if(following)freeCamera();else{following=true;viewer.camera.cancelFlight();el('cityFollow').textContent='Free camera';place();}viewer.scene.requestRender();};
  application.start().then(()=>{
    viewer=application.getComponents().scene.viewer;
    // Following must not trap the operator in the old area while they pan,
    // zoom, use a report marker or choose another map preset.
    const releaseForInput=()=>{if(following&&!picking&&!planning)freeCamera();};
    viewer.canvas.addEventListener('pointerdown',releaseForInput,{capture:true,passive:true});
    viewer.canvas.addEventListener('wheel',releaseForInput,{capture:true,passive:true});
    addEventListener('rescue:map-navigation',releaseForInput);
    const directHandler=new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    directHandler.setInputAction(click=>{
      if((!directClicks&&!rescueSelecting)||picking)return;
      const picked=viewer.scene.pick(click.position);
      if(picked?.id===drone||picked?.id===destinationMarker||picked?.id?.rescueReportId)return;
      const target=pickGround(click.position);if(!target)return;
      if(rescueSelecting){rescueSelecting=false;selectRescue.textContent='Choose rescue drop';viewer.canvas.style.cursor='';beginRescue(target);return;}
      if(planning&&!drone){el('cityFlightStatus').textContent='Placing the drone… wait until it appears, then click your destination.';return;}
      el('cityFlightControls').hidden=false;navigate(target).catch(error=>{el('cityFlightStatus').textContent=error.message;});
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    const remove=viewer.scene.preUpdate.addEventListener(()=>{
      const now=performance.now(),dt=Math.max(0,Math.min(.1,(now-lastTime)/1000));lastTime=now;
      // The visualizer's model primitive confirms the GLB has actually loaded.
      if(drone&&!modelReady){for(let i=0;i<viewer.scene.primitives.length;i++){const p=viewer.scene.primitives.get(i);if(p.id===drone&&p.ready){modelReady=true;if(!running)releaseContinuousRender(owner);}}}
      if(!paused&&!document.hidden&&['loading','unloading'].includes(rescue.stage)){
        rescue.elapsed+=dt;
        if(rescue.stage==='loading'&&rescue.elapsed>=2){rescue.onboard=3;rescue.stage='outbound';parcel.show=true;updateRescue();navigate(rescue.target,true);}
        else if(rescue.stage==='unloading'&&rescue.elapsed>=3){rescue.onboard=0;rescue.delivered=3;rescue.stage='returning';updateRescue();navigate(rescue.base,true);}
        viewer.scene.requestRender();
      }
      if(!running||paused||document.hidden)return;
      distance+=dt*Number(el('citySpeed').value)*timeScale;distance=Math.min(length,distance);place();
      if(mode==='destination'&&distance>=length){arrived=true;running=false;paused=false;releaseContinuousRender(owner);el('cityPause').disabled=true;
        if(rescue.stage==='outbound'){rescue.stage='unloading';rescue.elapsed=0;holdContinuousRender(owner);el('cityPause').disabled=false;el('cityFlightStatus').textContent='Unloading 3 simulated packages at the drop zone…';}
        else if(rescue.stage==='returning'){rescue.stage='complete';el('cityFlightStatus').textContent='Rescue complete: 3 simulated packages delivered. Returned to base; ready to reload.';}
        else el('cityFlightStatus').textContent='Arrived at your selected destination · simulated hover. Choose another destination to continue.';
        updateRescue();viewer.scene.requestRender();}
      else if(now-lastLabel>500){el('cityFlightStatus').textContent=`Flying to your destination · ${Math.max(0,length-distance).toFixed(0)} m remaining`+(timeScale>1?` · DEMO time ×${timeScale.toFixed(1)}`:'');lastLabel=now;}
    });
    addEventListener('pagehide',()=>{reset();remove();directHandler.destroy();toolbarObserver.disconnect();toolbar.remove();viewer.canvas.removeEventListener('pointerdown',releaseForInput,true);viewer.canvas.removeEventListener('wheel',releaseForInput,true);removeEventListener('rescue:map-navigation',releaseForInput);},{once:true});
  });
  document.addEventListener('visibilitychange',()=>{lastTime=performance.now();if(document.hidden)releaseContinuousRender(owner);else if((running||rescueActive())&&!paused)holdContinuousRender(owner);});
  const api={getState:()=>({running,paused,following,planning,modelReady,distance,routeLength:length,cruiseHeight:cruise,groundHeight:ground,mode,picking,arrived,timeScale,directClicks,routeVisible:!!path,
    cameraTilt,cameraDistance,
    rescue:{stage:rescue.stage,onboard:rescue.onboard,delivered:rescue.delivered,elapsed:rescue.elapsed,base:rescue.base?{longitude:rescue.base.longitude,latitude:rescue.base.latitude}:null},
    destination:destination?{lat:Cesium.Math.toDegrees(destination.latitude),lon:Cesium.Math.toDegrees(destination.longitude)}:null,
    sampledHeights:sampled,position:Cesium.Cartesian3.clone(position),centre:centre?{lat:Cesium.Math.toDegrees(centre.latitude),lon:Cesium.Math.toDegrees(centre.longitude)}:null,simulation_only:true,hardware_commands:false})};
  window.RescueCityFlight=api;
  if(new URLSearchParams(location.search).get('drone')==='1'){
    const timer=setInterval(()=>{
      if(!viewer||nyc.getState().loading)return;
      if(getComputedStyle(document.getElementById('loading-screen')).visibility!=='hidden')return;
      clearInterval(timer);start(true).catch(error=>{el('cityFlightControls').hidden=false;el('cityFlightStatus').textContent=error.message;});
    },300);addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  }
  return api;
}
