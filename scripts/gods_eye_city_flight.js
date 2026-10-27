import * as Cesium from 'cesium';
import {holdContinuousRender,releaseContinuousRender} from '/src/renderGovernor.js';

export function installCityFlight({application,el,nyc}){
  let viewer=null,drone=null,path=null,running=false,paused=false,following=false,planning=false,generation=0;
  let route=[],distance=0,length=0,ground=0,cruise=0,sampled=0,lastTime=performance.now(),lastLabel=0,modelReady=false;
  let position=new Cesium.Cartesian3(),orientation=new Cesium.Quaternion(),centre=null;
  const owner='rescue-city-flight',segments=64,radius=90;
  function freeCamera(){following=false;el('cityFollow').textContent='Follow drone';if(viewer&&!viewer.isDestroyed())viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}
  function reset(){
    generation++;running=false;paused=false;planning=false;releaseContinuousRender(owner);freeCamera();
    if(viewer&&!viewer.isDestroyed()){if(drone)viewer.entities.remove(drone);if(path)viewer.entities.remove(path);viewer.scene.requestRender();}
    drone=null;path=null;route=[];distance=0;modelReady=false;
    el('cityPause').disabled=true;el('cityPause').textContent='Pause';el('cityFlight').disabled=false;
    el('cityFlightStatus').textContent='Ready. Frame a neighbourhood, then choose Fly drone through this area.';
  }
  function pickCentre(useQuery=false){
    const q=new URLSearchParams(location.search);
    if(useQuery&&q.has('flightLat')&&q.has('flightLon')){
      const lat=Number(q.get('flightLat')),lon=Number(q.get('flightLon'));
      if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<89&&Math.abs(lon)<=180)return Cesium.Cartographic.fromDegrees(lon,lat);
    }
    if(viewer.camera.positionCartographic.height>20000)throw Error('Zoom into the neighbourhood first, then start the drone.');
    const pixel=new Cesium.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2),ray=viewer.camera.getPickRay(pixel);
    const point=(ray&&viewer.scene.globe.pick(ray,viewer.scene))||viewer.camera.pickEllipsoid(pixel,viewer.scene.globe.ellipsoid);
    if(!point)throw Error('Point the camera at the ground, then start the drone.');
    return Cesium.Cartographic.fromCartesian(point);
  }
  function place(){
    if(!route.length)return;
    const u=(distance/length)%1,index=u*segments,i=Math.floor(index),fraction=index-i;
    position=Cesium.Cartesian3.lerp(route[i],route[i+1],fraction,new Cesium.Cartesian3());
    const theta=u*Math.PI*2,heading=Math.atan2(-Math.sin(theta),Math.cos(theta));
    orientation=Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(heading,0,0));
    if(following)viewer.camera.lookAt(position,new Cesium.HeadingPitchRange(heading+Math.PI,-.32,65));
  }
  async function start(useQuery=false){
    if(planning)return;
    await application.start();viewer=application.getComponents().scene.viewer;
    const target=pickCentre(useQuery);reset();centre=target;const version=generation;
    planning=true;el('cityFlightControls').hidden=false;el('cityFlight').disabled=true;
    el('cityFlightStatus').textContent='Preparing the drone route and sampling building heights…';
    const preflight=owner+'-prepare-'+version;holdContinuousRender(preflight);
    try{
      const buildings=await nyc.ensureBuildings();
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
        const angle=i/segments*Math.PI*2,local=new Cesium.Cartesian3(Math.cos(angle)*radius,Math.sin(angle)*radius,0);
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
      cruise=Math.max(ground,...terrain,...heights)+(sampled?25:120);
      route=samples.map(c=>Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,cruise));
      length=route.slice(1).reduce((sum,p,i)=>sum+Cesium.Cartesian3.distance(route[i],p),0);distance=0;
      path=viewer.entities.add({name:'Simulated drone route',polyline:{positions:route,width:3,material:Cesium.Color.CYAN.withAlpha(.65)}});
      position=Cesium.Cartesian3.clone(route[0]);
      drone=viewer.entities.add({name:'Rescue quadcopter · simulation',
        position:new Cesium.CallbackPositionProperty((time,result)=>Cesium.Cartesian3.clone(position,result),false),
        orientation:new Cesium.CallbackProperty((time,result)=>Cesium.Quaternion.clone(orientation,result),false),
        model:{uri:'/__rescue/backend/vendor/rescue-quadcopter.glb',scale:2,minimumPixelSize:72,maximumScale:18,runAnimations:true,
          silhouetteColor:Cesium.Color.fromCssColorString('#75f4ce'),silhouetteSize:1},
        label:{text:'RESCUE DRONE · SIM',font:'bold 12px sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,
          outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-42),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,600)}});
      following=true;running=true;paused=false;lastTime=performance.now();holdContinuousRender(owner);
      el('cityFollow').textContent='Free camera';el('cityPause').disabled=false;place();
      el('cityFlightStatus').textContent=sampled?'Flying above sampled rooftop heights · simulation.':'Flying at a terrain-based altitude · building-height sampling unavailable.';
      viewer.scene.requestRender();
    }catch(error){if(version===generation)el('cityFlightStatus').textContent=error.message;}
    finally{releaseContinuousRender(preflight);if(version===generation){planning=false;el('cityFlight').disabled=false;}}
  }
  el('cityFlight').onclick=()=>start().catch(error=>{el('cityFlightControls').hidden=false;el('cityFlightStatus').textContent=error.message;});
  el('cityReset').onclick=reset;
  el('cityPause').onclick=()=>{
    if(!running)return;paused=!paused;el('cityPause').textContent=paused?'Resume':'Pause';lastTime=performance.now();
    if(paused)releaseContinuousRender(owner);else holdContinuousRender(owner);
    el('cityFlightStatus').textContent=paused?'Flight paused.':'Flight resumed · simulation.';
  };
  el('cityFollow').onclick=()=>{if(!drone)return;if(following)freeCamera();else{following=true;el('cityFollow').textContent='Free camera';place();}viewer.scene.requestRender();};
  application.start().then(()=>{
    viewer=application.getComponents().scene.viewer;
    const remove=viewer.scene.preUpdate.addEventListener(()=>{
      const now=performance.now(),dt=Math.max(0,Math.min(.1,(now-lastTime)/1000));lastTime=now;
      if(!running||paused||document.hidden)return;
      distance+=dt*Number(el('citySpeed').value);place();
      // The visualizer's model primitive confirms the GLB has actually loaded.
      if(!modelReady){for(let i=0;i<viewer.scene.primitives.length;i++){const p=viewer.scene.primitives.get(i);if(p.id===drone&&p.ready)modelReady=true;}}
      if(now-lastLabel>500){el('cityFlightStatus').textContent=`Simulated flight · ${el('citySpeed').value} m/s · loop ${Math.floor(distance/length)+1} · ${(cruise-ground).toFixed(0)} m above local ground estimate`+(sampled?' · sampled roof heights':' · terrain-only height');lastLabel=now;}
    });
    addEventListener('pagehide',()=>{reset();remove();},{once:true});
  });
  document.addEventListener('visibilitychange',()=>{lastTime=performance.now();if(document.hidden)releaseContinuousRender(owner);else if(running&&!paused)holdContinuousRender(owner);});
  const api={getState:()=>({running,paused,following,planning,modelReady,distance,routeLength:length,cruiseHeight:cruise,groundHeight:ground,
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
