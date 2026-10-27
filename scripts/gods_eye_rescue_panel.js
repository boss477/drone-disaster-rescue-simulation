import {application} from '/src/main.js';
import * as Cesium from 'cesium';
const rescueOrigin=__RESCUE_ORIGIN__;
let report=window.RescueHandoff.fromURL();
const root=document.createElement('div');root.id='droneRescueBridge';
// Shadow DOM keeps this small integration independent of upstream HUD styles.
const shadow=root.attachShadow({mode:'open'});
shadow.innerHTML='<style>:host{position:fixed;z-index:5000;left:16px;bottom:65px;width:270px;color:#e9f6f1;font:12px Segoe UI,sans-serif}details{border:1px solid #76c3a966;border-radius:12px;background:#122c32ee;padding:14px;box-shadow:0 6px 30px #0005}summary{cursor:pointer;font-weight:700;color:#94efd1}p{line-height:1.5;color:#c0d7d0}button,a{display:block;margin-top:10px;background:#a0e8c8;color:#123d33;padding:10px;border:0;border-radius:7px;text-decoration:none;font:inherit;cursor:pointer}small{color:#c0d7d0}a.secondary{background:#284a4c;color:#e9f6f1}</style><details open><summary>DRONE RESCUE · TRAINING</summary><p id="context"></p><small>Real globe context → fictional Harbour Ward. All people and deliveries are simulated.</small><a id="train">Open fictional rescue district →</a><button id="centre">Use current map centre</button><a class="secondary" id="reports">Live disaster reports + AI review</a></details>';
document.body.append(root);
const placement=document.createElement('style');placement.textContent=':host{bottom:150px;max-height:calc(100vh - 210px);overflow:auto}';shadow.append(placement);
const el=id=>shadow.getElementById(id);
function show(){
  el('context').textContent=report?`${report.title} · ${report.location.lat.toFixed(4)}, ${report.location.lon.toFixed(4)} · ${report.feed || 'operator placement'}`:'Choose a report in the rescue dashboard, or use the map centre for a fictional exercise.';
  el('train').href=new URL(RescueHandoff.sceneURL(report),rescueOrigin).href;
}
el('reports').href=rescueOrigin+'/earth_rescue.html?incidents=1';show();
el('centre').onclick=async()=>{
  try{
    await application.start();
    const {viewer}=application.getComponents().scene;
    const pixel=new Cesium.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2);
    const ray=viewer.camera.getPickRay(pixel);
    const hit=(ray && viewer.scene.globe.pick(ray,viewer.scene)) || viewer.camera.pickEllipsoid(pixel,viewer.scene.globe.ellipsoid);
    if(!hit){el('context').textContent='Point the camera at the ground, then try again.';return;}
    const c=Cesium.Cartographic.fromCartesian(hit);
    report=RescueHandoff.clean({title:'Operator-selected globe area',feed:'God’s Eye View · operator placement',
      retrieved_at:new Date().toISOString(),location:{lat:Cesium.Math.toDegrees(c.latitude),lon:Cesium.Math.toDegrees(c.longitude)}});
    show();
  }catch{el('context').textContent='The globe is still starting or unavailable. Open the rescue dashboard below.';}
};
