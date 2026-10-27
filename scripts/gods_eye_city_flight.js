import * as Cesium from 'cesium';
import {holdContinuousRender,releaseContinuousRender} from '/src/renderGovernor.js';
import {greatCircleRoute} from '/__rescue/city-route.mjs';

export function installCityFlight({application,el,nyc}){
  let viewer=null,drone=null,path=null,running=false,paused=false,following=false,planning=false,generation=0;
  let route=[],distance=0,length=0,ground=0,cruise=0,sampled=0,lastTime=performance.now(),lastLabel=0,modelReady=false;
  let position=new Cesium.Cartesian3(),orientation=new Cesium.Quaternion(),centre=null;
  let mode='loop',destination=null,destinationMarker=null,arrived=false,timeScale=1,cumulative=[];
  let picking=false,pickHandler=null,pickRestore=null,oldCursor='';
  const owner='rescue-city-flight',segments=64,radius=90;
  const needsGlobal=c=>Math.abs(Cesium.Math.toDegrees(c.latitude)-40.7)>.35||Math.abs(Cesium.Math.toDegrees(c.longitude)+74)>.4;
  function unpinInitialArea(){const url=new URL(location.href);url.searchParams.delete('flightLat');url.searchParams.delete('flightLon');history.replaceState(history.state,'',url);}
  function freeCamera(){following=false;el('cityFollow').textContent='Follow drone';if(viewer&&!viewer.isDestroyed())viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}
  function reset(){
    stopPicking();
    generation++;running=false;paused=false;planning=false;releaseContinuousRender(owner);freeCamera();
    if(viewer&&!viewer.isDestroyed()){if(drone)viewer.entities.remove(drone);if(path)viewer.entities.remove(path);if(destinationMarker)viewer.entities.remove(destinationMarker);viewer.scene.requestRender();}
    drone=null;path=null;destinationMarker=null;route=[];distance=0;modelReady=false;mode='loop';destination=null;arrived=false;timeScale=1;cumulative=[];
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
  function place(){
    if(!route.length)return;
    const travelled=mode==='loop'?distance%length:Math.min(distance,length);
    let i=0;while(i<route.length-2&&cumulative[i+1]<travelled)i++;
    const fraction=Math.max(0,Math.min(1,(travelled-cumulative[i])/(cumulative[i+1]-cumulative[i]||1)));
    position=Cesium.Cartesian3.lerp(route[i],route[i+1],fraction,new Cesium.Cartesian3());
    const inverse=Cesium.Matrix4.inverseTransformation(Cesium.Transforms.eastNorthUpToFixedFrame(position),new Cesium.Matrix4());
    const delta=Cesium.Cartesian3.subtract(route[i+1],route[i],new Cesium.Cartesian3());
    const local=Cesium.Matrix4.multiplyByPointAsVector(inverse,delta,new Cesium.Cartesian3()),heading=Math.atan2(local.x,local.y);
    orientation=Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(heading,0,0));
    if(following)viewer.camera.lookAt(position,new Cesium.HeadingPitchRange(heading+Math.PI,-.32,65));
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
      const origin=Cesium.Cartesian3.fromRadians(target.longitude,target.latitude,ground);
      const frame=Cesium.Transforms.eastNorthUpToFixedFrame(origin),samples=[];
      for(let i=0;i<=segments;i++){
        const angle=i/segments*Math.PI*2,local=new Cesium.Cartesian3((Math.cos(angle)-1)*radius,Math.sin(angle)*radius,0);
        samples.push(Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(frame,local,new Cesium.Cartesian3())));
      }
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
      route=samples.map(c=>Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,cruise));
      measureRoute();distance=0;
      path=viewer.entities.add({name:'Simulated drone route',polyline:{positions:route,arcType:Cesium.ArcType.NONE,width:3,material:Cesium.Color.CYAN.withAlpha(.65)}});
      position=Cesium.Cartesian3.clone(route[0]);
      drone=viewer.entities.add({name:'Rescue quadcopter · simulation',
        position:new Cesium.CallbackPositionProperty((time,result)=>Cesium.Cartesian3.clone(position,result),false),
        orientation:new Cesium.CallbackProperty((time,result)=>Cesium.Quaternion.clone(orientation,result),false),
        model:{uri:'/__rescue/backend/vendor/rescue-quadcopter.glb',scale:2,minimumPixelSize:72,maximumScale:18,runAnimations:true,
          silhouetteColor:Cesium.Color.fromCssColorString('#75f4ce'),silhouetteSize:1},
        label:{text:'RESCUE DRONE · SIM',font:'bold 12px sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,
          outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-42),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,600)}});
      following=true;running=true;paused=false;lastTime=performance.now();viewer.camera.cancelFlight();holdContinuousRender(owner);
      el('cityFollow').textContent='Free camera';el('cityPause').disabled=false;place();
      el('cityFlightStatus').textContent=sampled?'Flying above sampled rooftop heights · simulation.':'Flying at a terrain-based altitude · building-height sampling unavailable.';
      viewer.scene.requestRender();
    }catch(error){if(version===generation)el('cityFlightStatus').textContent=error.message;}
    finally{releaseContinuousRender(preflight);if(version===generation){planning=false;el('cityFlight').disabled=false;}}
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
  async function navigate(target){
    unpinInitialArea();
    if(!drone){await start(false,target);return;}
    const version=++generation;planning=true;paused=true;arrived=false;releaseContinuousRender(owner);
    el('cityPause').disabled=true;el('cityFlight').disabled=true;el('cityFlightStatus').textContent='Planning flight to the selected destination…';
    const preflight=owner+'-destination-'+version;holdContinuousRender(preflight);
    try{
      await nyc.ensureBuildings({global:needsGlobal(target)});if(version!==generation)return;
      const from=Cesium.Cartographic.fromCartesian(position),trip=greatCircleRoute(from,target,128);
      if(trip.surfaceDistance<2){el('cityFlightStatus').textContent='The drone is already at that point. Choose a point farther away.';return;}
      const samples=trip.points.map(c=>new Cesium.Cartographic(c.longitude,c.latitude,0));
      const localTrip=trip.surfaceDistance<=5000,queries=localTrip?samples:[samples[0],samples.at(-1)];
      const deadlines=[];
      const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>deadlines.push(setTimeout(()=>reject(Error('height timeout')),7000)))]).catch(()=>[]);
      let roofs=[],terrain=[];
      try{[roofs,terrain]=await Promise.all([
        viewer.scene.sampleHeightSupported?bounded(viewer.scene.sampleHeightMostDetailed(queries.map(c=>Cesium.Cartographic.clone(c)),[drone,path,destinationMarker].filter(Boolean))):[],
        bounded(Cesium.sampleTerrain(viewer.terrainProvider,12,queries.map(c=>Cesium.Cartographic.clone(c))))
      ]);}finally{deadlines.forEach(clearTimeout);}
      if(version!==generation)return;
      const roofHeights=roofs.map(c=>c?.height).filter(Number.isFinite),terrainHeights=terrain.map(c=>c?.height).filter(Number.isFinite);
      sampled=roofHeights.length;
      const endRoof=roofs.at(-1)?.height,endTerrain=terrain.at(-1)?.height;
      const endHeight=Math.max(0,Number.isFinite(target.height)?target.height:0,Number.isFinite(endRoof)?endRoof:-1000,Number.isFinite(endTerrain)?endTerrain:-1000)+(Number.isFinite(endRoof)?25:120);
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
    }catch(error){if(version===generation)el('cityFlightStatus').textContent='Cannot plan this route: '+error.message;}
    finally{releaseContinuousRender(preflight);if(version===generation){planning=false;el('cityFlight').disabled=false;el('cityPause').disabled=!running;}}
  }
  el('cityDestination').onclick=async()=>{
    if(picking){stopPicking(true);return;}
    if(planning){el('cityFlightStatus').textContent='Wait for route planning, or press Reset before choosing another destination.';return;}
    await application.start();viewer=application.getComponents().scene.viewer;
    pickRestore={paused,following};if(running){paused=true;releaseContinuousRender(owner);el('cityPause').textContent='Resume';}
    freeCamera();picking=true;oldCursor=viewer.canvas.style.cursor;viewer.canvas.style.cursor='crosshair';el('cityFlightControls').hidden=false;
    el('cityDestination').textContent='Cancel destination selection';el('cityFlightStatus').textContent=drone?'Pan or zoom, then click anywhere on the ground to send the drone there.':'Click anywhere on the globe to place and fly the drone there.';
    const hint=document.createElement('div');hint.id='cityDestinationHint';hint.textContent='CLICK A DESTINATION ON THE MAP · Esc to cancel';
    hint.style.cssText='position:fixed;top:85px;left:50%;transform:translateX(-50%);z-index:8000;background:#173b3bf2;border:1px solid #8ee6c4;border-radius:10px;padding:12px 18px;color:#d9ffee;font:12px Segoe UI,sans-serif;pointer-events:none';document.body.append(hint);
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
    if(!running)return;paused=!paused;el('cityPause').textContent=paused?'Resume':'Pause';lastTime=performance.now();
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
    const remove=viewer.scene.preUpdate.addEventListener(()=>{
      const now=performance.now(),dt=Math.max(0,Math.min(.1,(now-lastTime)/1000));lastTime=now;
      if(!running||paused||document.hidden)return;
      distance+=dt*Number(el('citySpeed').value)*timeScale;if(mode==='destination')distance=Math.min(length,distance);place();
      // The visualizer's model primitive confirms the GLB has actually loaded.
      if(!modelReady){for(let i=0;i<viewer.scene.primitives.length;i++){const p=viewer.scene.primitives.get(i);if(p.id===drone&&p.ready)modelReady=true;}}
      if(mode==='destination'&&distance>=length){arrived=true;running=false;paused=false;releaseContinuousRender(owner);el('cityPause').disabled=true;el('cityFlightStatus').textContent='Arrived at your selected destination · simulated hover. Choose another destination to continue.';viewer.scene.requestRender();}
      else if(now-lastLabel>500){el('cityFlightStatus').textContent=mode==='destination'?`Flying to your destination · ${Math.max(0,length-distance).toFixed(0)} m remaining`+(timeScale>1?` · DEMO time ×${timeScale.toFixed(1)}`:''):`Simulated flight · ${el('citySpeed').value} m/s · loop ${Math.floor(distance/length)+1} · ${(cruise-ground).toFixed(0)} m above local ground estimate`+(sampled?' · sampled roof heights':' · terrain-only height');lastLabel=now;}
    });
    addEventListener('pagehide',()=>{reset();remove();viewer.canvas.removeEventListener('pointerdown',releaseForInput,true);viewer.canvas.removeEventListener('wheel',releaseForInput,true);removeEventListener('rescue:map-navigation',releaseForInput);},{once:true});
  });
  document.addEventListener('visibilitychange',()=>{lastTime=performance.now();if(document.hidden)releaseContinuousRender(owner);else if(running&&!paused)holdContinuousRender(owner);});
  const api={getState:()=>({running,paused,following,planning,modelReady,distance,routeLength:length,cruiseHeight:cruise,groundHeight:ground,mode,picking,arrived,timeScale,
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
