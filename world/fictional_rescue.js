import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All geometry and textures are authored here. This is an invented training set.
const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b5ced1');
scene.fog = new THREE.Fog('#b5ced1', 230, 650);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
} catch (error) {
  $('renderStatus').textContent = '3D unavailable: enable browser hardware acceleration and reload.';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
$('scene').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(46,innerWidth/innerHeight,.25,1200);
const controls = new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.maxPolarAngle=Math.PI/2-.035;
controls.minDistance=8; controls.maxDistance=430; controls.target.set(0,12,0);
scene.add(new THREE.HemisphereLight(0xd8efff,0x6a7350,2.4));
const sun = new THREE.DirectionalLight(0xffdfaf,3.5);
sun.position.set(-70,130,70); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-140,right:140,top:140,bottom:-140,near:1,far:350});
sun.shadow.normalBias=.06; sun.shadow.bias=-.0002; scene.add(sun);

let seed=41;
function rand(){ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
function mat(color,extra={}) {return new THREE.MeshStandardMaterial({color,roughness:.8,...extra});}
const concrete=mat('#c2bbae'), dark=mat('#26353a'), metal=mat('#45545a',{metalness:.65,roughness:.4});
const trim=mat('#dfd8bd'), glass=mat('#28414b',{metalness:.4,roughness:.25});
const warmGlass=mat('#b59c61',{emissive:'#d59e4d',emissiveIntensity:.25});
const white=mat('#e2ded1'), roadMark=mat('#e0d8ab'), red=mat('#a65844');
const unitBox=new THREE.BoxGeometry(1,1,1);
function box(w,h,d,x,y,z,material,parent=scene){
  const mesh=new THREE.Mesh(unitBox,material);mesh.scale.set(w,h,d);mesh.position.set(x,y,z);
  mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function cylinder(rt,rb,h,x,y,z,material,parent=scene,segments=10){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,segments),material);
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function texture(kind){
  const c=document.createElement('canvas'); c.width=c.height=256;
  const ctx=c.getContext('2d');
  ctx.fillStyle=kind==='brick'?'#947767':kind==='roof'?'#8e9189':'#4a5051';ctx.fillRect(0,0,256,256);
  for(let i=0;i<12000;i++){
    const value=Math.floor(rand()*100);ctx.fillStyle=`rgba(${value},${value},${value},.15)`;
    ctx.fillRect(rand()*256,rand()*256,1+rand()*2,1+rand()*2);
  }
  if(kind==='brick'){
    ctx.strokeStyle='#594e4738';ctx.lineWidth=2;
    for(let y=0;y<256;y+=16){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(256,y);ctx.stroke();
      for(let x=(y/16%2)*24;x<256;x+=48){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+16);ctx.stroke();}}
  }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='asphalt'?12:3,kind==='asphalt'?12:3);
  t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t;
}
const brickMap=texture('brick'), roofMap=texture('roof'), asphaltMap=texture('asphalt');
const asphalt=mat('#c0c4c3',{map:asphaltMap}), roofMat=mat('#c7c7bd',{map:roofMap});
box(650,2,650,0,-1.1,0,mat('#6a7c61'));
box(244,.5,222,0,.05,0,concrete);
box(244,.15,20,0,.4,8,asphalt);box(20,.15,222,-4,.4,0,asphalt);
box(244,.15,16,0,.4,-86,asphalt);box(244,.15,16,0,.4,92,asphalt);
box(16,.15,222,-106,.4,0,asphalt);box(16,.15,222,106,.4,0,asphalt);
for(let x=-115;x<120;x+=11){if(Math.abs(x+4)>14) box(5,.03,.25,x,.5,8,roadMark);}
for(let z=-97;z<104;z+=11){if(Math.abs(z-8)>14) box(.25,.03,5,-4,.5,z,roadMark);}
for(let i=0;i<7;i++){
  box(1.2,.03,7,-11+i*2,.52,25,white);
  box(7,.03,1.2,13,.52,1+i*2,white);
}
// Raised pavements, visible curbs, and paving seams.
for(const [x,z,w,d] of [[-55,-38,75,70],[53,-38,76,70],[-55,55,75,57],[53,55,76,57]]){
  box(w,.7,d,x,.65,z,trim);
  for(let a=-w/2+4;a<w/2;a+=5) box(.035,.015,d,x+a,1.01,z,concrete);
}

function building(x,z,w,d,floors,color,name){
  const group=new THREE.Group();group.position.set(x,1,z);scene.add(group);
  const h=floors*3.7;
  box(w,h,d,0,h/2,0,mat(color,{map:brickMap}),group);
  box(w+.5,.5,d+.5,0,.25,0,dark,group);
  for(let f=1;f<=floors;f++) box(w+.35,.16,d+.35,0,f*3.7-.18,0,trim,group);
  const cols=Math.floor((w-2)/3.3), sideCols=Math.floor((d-2)/3.3);
  for(let f=0;f<floors;f++){
    const y=2+f*3.7;
    for(let side of [-1,1]){
      for(let col=0;col<cols;col++){
        const wx=(col-(cols-1)/2)*3.3;
        box(1.8,2.25,.2,wx,y,side*(d/2+.04),trim,group);
        box(1.5,1.95,.22,wx,y,side*(d/2+.16),rand()>.85?warmGlass:glass,group);
        box(.07,1.95,.23,wx,y,side*(d/2+.19),trim,group);
        box(2.1,.15,.55,wx,y-1.12,side*(d/2+.2),trim,group);
        if(f>0 && col%3===0){
          box(2.5,.16,1.2,wx,y-1.15,side*(d/2+.65),concrete,group);
          box(2.5,.12,.08,wx,y-.35,side*(d/2+1.2),metal,group);
          for(let p=-1;p<=1;p++)box(.06,.8,.06,wx+p,y-.75,side*(d/2+1.2),metal,group);
        }
      }
      for(let col=0;col<sideCols;col++){
        const wz=(col-(sideCols-1)/2)*3.3;
        box(.2,2.25,1.8,side*(w/2+.04),y,wz,trim,group);
        box(.22,1.95,1.5,side*(w/2+.16),y,wz,glass,group);
      }
    }
  }
  box(w+.8,.3,d+.8,0,h+.05,0,roofMat,group);
  for(const side of [-1,1]){
    box(w,.7,.3,0,h+.5,side*d/2,concrete,group);
    box(.3,.7,d,side*w/2,h+.5,0,concrete,group);
  }
  box(4,1.7,3,w*.25,h+1.05,-d*.2,metal,group);
  box(3,.15,2,w*.25,h+1.95,-d*.2,trim,group);
  for(let i=0;i<4;i++)box(2.5,.04,.08,w*.25,h+2.05,-d*.2-.6+i*.4,dark,group);
  cylinder(1.4,1.4,2,-w*.27,h+1.4,-d*.2,mat('#668b8d'),group);
  box(2.8,3,.3,0,1.5,d/2+.2,dark,group);
  box(5,.2,2,0,3.2,d/2+.9,red,group);
  sign(name,w-2,1.2,0,4,d/2+.3,group);
  return {group,top:h+1.25,x,z};
}
function sign(text,w,h,x,y,z,parent=scene){
  const c=document.createElement('canvas');c.width=512;c.height=96;
  const ctx=c.getContext('2d');ctx.fillStyle='#183e41';ctx.fillRect(0,0,512,96);
  ctx.strokeStyle='#dfd2a0';ctx.lineWidth=5;ctx.strokeRect(5,5,502,86);
  ctx.fillStyle='#fff0cf';ctx.font='bold 44px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,49,480);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));
  mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}
building(-71,-54,25,27,5,'#a59a83','HARBOUR APARTMENTS');
building(-35,-54,24,26,7,'#c1bba0','WARD 07');
building(30,-52,23,32,4,'#cba58e','RIVERSIDE CLINIC');
building(65,-54,29,29,6,'#989f91','THE COURTYARD');
building(-72,51,26,24,4,'#bd987e','MARKET HOUSE');
building(-35,53,22,25,3,'#b1b5a5','OLD QUAY');
const refuge=building(49,51,36,28,3,'#d0b59b','COMMUNITY REFUGE');
building(82,57,17,24,5,'#97a8a5','EAST WING');

const bark=mat('#6a5141'), leaves=[mat('#66834d'),mat('#536f45')];
function tree(x,z,size=1){
  cylinder(.3,.5,4*size,x,2*size,z,bark);
  for(let i=0;i<3;i++){
    const m=new THREE.Mesh(new THREE.IcosahedronGeometry((2.6-i*.35)*size,1),leaves[i%2]);
    m.position.set(x+(i-1)*size,5*size+i*size,z);m.castShadow=true;scene.add(m);
  }
  box(5,.3,5,x,.7,z,concrete);
}
for(const [x,z] of [[-86,-15],[-59,-15],[-28,-15],[22,-15],[78,-15],[-85,31],[-60,31],[-24,31],[25,31],[83,32],[-85,-78],[-25,-78],[89,-79]])tree(x,z,.9+rand()*.3);
for(let i=0;i<45;i++){const angle=rand()*Math.PI*2,r=155+rand()*70;tree(Math.cos(angle)*r,Math.sin(angle)*r,1+rand());}
for(let i=0;i<12;i++){
  const hill=new THREE.Mesh(new THREE.SphereGeometry(55+rand()*55,20,12),mat(i%2?'#6f886b':'#81977a'));
  const a=i/12*Math.PI*2;hill.position.set(Math.cos(a)*340,-35,Math.sin(a)*340);hill.scale.y=.8+rand();scene.add(hill);
}
function lamp(x,z){
  cylinder(.1,.17,8,x,4,z,metal);box(2,.12,.16,x+.8,8,z,metal);
  box(1,.16,.5,x+1.4,7.9,z,mat('#ead4a2',{emissive:'#ffcc73',emissiveIntensity:.6}));
}
for(const x of [-90,-46,24,87]){lamp(x,-4);lamp(x,22);}
function car(x,z,color,rotate=0){
  const g=new THREE.Group();g.position.set(x,.7,z);g.rotation.y=rotate;scene.add(g);
  const paint=mat(color,{metalness:.35,roughness:.35});box(2,1,4.2,0,.6,0,paint,g);
  box(1.8,.9,2.1,0,1.5,-.2,glass,g);box(1.9,.12,2.2,0,2,-.2,paint,g);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const wheel=cylinder(.42,.42,.25,sx, .3,sz*1.3,dark,g,12);wheel.rotation.z=Math.PI/2;
  }
  for(const x of [-.65,.65])box(.45,.25,.05,x,.85,2.13,white,g);
}
car(-91,-2,'#b7a363',Math.PI/2);car(-48,-1,'#97b5b7',Math.PI/2);car(9,-65,'#d3c4a9');car(86,23,'#a4513b',Math.PI/2);
// Canal boundary and a deliberately shallow flooded part of the district.
box(260,2,12,0,-.2,121,mat('#54746c'));
for(let x=-125;x<130;x+=5){box(.15,1.2,.15,x,1.2,112,metal);box(5,.12,.12,x+2.5,1.75,112,metal);}
const waterGeometry=new THREE.PlaneGeometry(198,91,55,26);waterGeometry.rotateX(-Math.PI/2);
const water=new THREE.Mesh(waterGeometry,mat('#529092',{transparent:true,opacity:.63,metalness:.38,roughness:.23,depthWrite:false}));
water.position.set(16,1.18,66);water.receiveShadow=true;scene.add(water);
const waterBase=waterGeometry.attributes.position.array.slice();
for(let i=0;i<22;i++){
  const m=box(.1,.04,3+rand()*7,-80+rand()*192,1.24,24+rand()*83,mat('#b7dfd5',{transparent:true,opacity:.3}));
  m.rotation.y=rand()*.3;
}
// Rescue depot on dry ground, with a loading canopy and marked helipad.
const base=new THREE.Vector3(-66,1.35,-29);
box(24,.4,18,base.x,1.05,base.z,mat('#636e69'));
const pad=new THREE.Mesh(new THREE.RingGeometry(5,5.3,48),mat('#e8d49e'));pad.rotation.x=-Math.PI/2;pad.position.set(base.x,1.27,base.z);scene.add(pad);
box(.5,.025,5,base.x-1.4,1.29,base.z,roadMark);box(.5,.025,5,base.x+1.4,1.29,base.z,roadMark);box(3.3,.025,.5,base.x,1.29,base.z,roadMark);
sign('AID DEPOT',13,2,base.x,4,base.z-8);
for(let i=0;i<4;i++){box(.18,4,.18,base.x+(i%2?1:-1)*7,3.1,base.z-7+(i<2?0:4),metal);}
box(16,.22,6,base.x,5.3,base.z-5,mat('#b76e4f'));
const carton=mat('#c39654');
for(let i=0;i<8;i++)box(1.1,.8,.9,base.x-6+(i%4)*1.4,1.6+Math.floor(i/4)*.85,base.z-5,carton);

const roofY=refuge.top+.1;
const target=new THREE.Vector3(49,roofY,54);
const dropRing=new THREE.Mesh(new THREE.RingGeometry(2.8,3.05,48),new THREE.MeshBasicMaterial({color:'#70f6bd',side:THREE.DoubleSide}));
dropRing.rotation.x=-Math.PI/2;dropRing.position.copy(target);dropRing.position.y+=.05;scene.add(dropRing);
sign('ROOFTOP AID ZONE',15,1.8,49,roofY+1.3,65.3);
function person(x,y,z,color){
  const g=new THREE.Group();g.position.set(x,y,z);scene.add(g);
  cylinder(.27,.32,.8,0,1,0,mat(color),g);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.23,10,8),mat('#c79a78'));head.position.y=1.65;g.add(head);
  for(const s of [-1,1]){box(.18,.75,.2,s*.16,.35,0,dark,g);const arm=box(.14,.7,.16,s*.4,1.25,0,mat(color),g);arm.rotation.z=s*.5;}
  return g;
}
// Batch fixed geometry by material; windows remain real geometry without thousands of draw calls.
scene.updateMatrixWorld(true);
const batches=new Map(),fixed=[];
scene.traverse(object=>{
  if(!object.isMesh || object===water || object===dropRing)return;
  const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld);
  if(!batches.has(object.material))batches.set(object.material,[]);
  batches.get(object.material).push(geometry);fixed.push(object);
});
for(const object of fixed)object.removeFromParent();
for(const [material,geometries] of batches){
  const mesh=new THREE.Mesh(mergeGeometries(geometries),material);
  mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  geometries.forEach(g=>g.dispose());
}
const people=[person(43,roofY,57,'#c78248'),person(42,roofY,52,'#6eaab0'),person(44,roofY,48,'#d0b96f')];
person(base.x-6,1.3,base.z+5,'#ca965a');

const drone=new THREE.Group();scene.add(drone);const rotors=[];
box(1.7,.6,2,0,0,0,white,drone);box(1.15,.22,1.25,0,.4,0,dark,drone);
box(.45,.4,.5,0,-.45,-1.05,metal,drone);box(.25,.23,.08,0,-.45,-1.33,glass,drone);
for(const x of [-1,1])for(const z of [-1,1]){
  const arm=box(3,.16,.2,x*1.25,0,z*1.25,metal,drone);arm.rotation.y=-x*z*Math.PI/4;
  cylinder(.3,.35,.35,x*2.3,.15,z*2.3,dark,drone);
  const rotor=new THREE.Group();rotor.position.set(x*2.3,.4,z*2.3);drone.add(rotor);
  box(2.2,.025,.12,0,0,0,metal,rotor);box(.12,.025,2.2,0,0,0,metal,rotor);rotors.push(rotor);
  const led=mat(x<0?'#ee5e40':'#68edb7',{emissive:x<0?'#ee5e40':'#68edb7',emissiveIntensity:1});box(.15,.15,.15,x*2.3,-.1,z*2.3,led,drone);
}
for(const s of [-1,1]){box(.12,.95,.12,s*.9,-.7,.6,metal,drone);box(.12,.95,.12,s*.9,-.7,-.6,metal,drone);box(.15,.12,2.7,s*.9,-1.2,0,metal,drone);}
function pack(parent){
  const g=new THREE.Group();parent.add(g);box(.7,.6,.65,0,0,0,carton,g);
  box(.72,.08,.67,0,.1,0,white,g);box(.15,.025,.42,0,.315,0,red,g);box(.42,.025,.15,0,.316,0,red,g);return g;
}
const cargo=[pack(drone),pack(drone),pack(drone)];cargo.forEach((p,i)=>p.position.set((i-1)*.76,-.65,0));
const deliveredPacks=[pack(scene),pack(scene),pack(scene)];
const phases=[['Loading aid packs',4],['Taking off',5],['Flying to the refuge',16],['Approaching rooftop',6],['Delivering aid',15],['Climbing clear',5],['Returning to depot',16],['Landing',6]];
const total=phases.reduce((sum,p)=>sum+p[1],0);
let elapsed=0,running=false,started=false,view='overview',lastTime=performance.now(),visualTime=0;
let delivered=0,onboard=0,phaseIndex=-1;
const home=base.clone().add(new THREE.Vector3(0,1.3,0));
const cruise=35, roofHover=target.y+7;
const smooth=t=>t*t*(3-2*t);
function mix(a,b,t){return a.clone().lerp(b,smooth(t));}
function missionState(t){
  let offset=0,index=phases.length-1;
  for(let i=0;i<phases.length;i++){if(t<offset+phases[i][1]){index=i;break;}offset+=phases[i][1];}
  if(t>=total){index=7;offset=total-phases[7][1];}
  return {index,u:Math.min(1,Math.max(0,(t-offset)/phases[index][1]))};
}
function updateMission(){
  const {index,u}=missionState(elapsed); phaseIndex=index;
  const highHome=new THREE.Vector3(home.x,cruise,home.z),highTarget=new THREE.Vector3(target.x,cruise,target.z),hover=new THREE.Vector3(target.x,roofHover,target.z);
  let pos=home.clone();
  if(index===1)pos=mix(home,highHome,u);
  if(index===2){pos=mix(highHome,highTarget,u);pos.x+=Math.sin(Math.PI*u)*7;}
  if(index===3)pos=mix(highTarget,hover,u);
  if(index===4)pos=hover.clone();
  if(index===5)pos=mix(hover,highTarget,u);
  if(index===6)pos=mix(highTarget,highHome,u);
  if(index===7)pos=mix(highHome,home,u);
  drone.position.copy(pos);
  if(started && elapsed<total && index>0 && index<7)drone.position.y+=Math.sin(visualTime*2)*.06;
  drone.rotation.y=index>=6?-.94:2.2;
  drone.rotation.z=(index===2||index===6)?Math.sin(u*Math.PI)*.06:0;
  const loading=index===0?Math.min(3,Math.floor(u*3.8)):3;
  const dropTime=index===4?u*15:index>4?15:0;
  delivered=Math.min(3,Math.max(0,Math.floor((dropTime-2)/4)+1));
  if(index<4)delivered=0;
  onboard=loading-Math.min(3,Math.ceil(dropTime/4));
  if(index<4)onboard=loading;
  onboard=Math.max(0,onboard);
  for(let i=0;i<3;i++){
    const start=i*4,fall=(dropTime-start)/2;
    cargo[i].visible=i<loading && (index<4 || dropTime<=start);
    const p=deliveredPacks[i];p.visible=index>=4&&dropTime>start;
    p.position.set(target.x+(i-1)*1.3,THREE.MathUtils.lerp(roofHover-1,roofY+.35,smooth(Math.min(1,Math.max(0,fall)))),target.z);
  }
  $('phase').textContent=elapsed>=total?'Mission complete':started?phases[index][0]:'Ready at the depot';
  $('brief').textContent=elapsed>=total?'All three aid packs delivered. Drone safely back at the depot.':index===4?'Lowering aid packs one at a time to three simulated recipients.':'Deliver three aid packs to the marked rooftop, then return home.';
  $('onboard').textContent=onboard;$('delivered').textContent=delivered;$('helped').textContent=`${delivered} / 3`;
  $('altitude').textContent=`${Math.max(0,pos.y-home.y).toFixed(0)} m above depot`;
  const progress=Math.round(elapsed/total*100);$('progress').textContent=`${progress}% complete`;$('bar').value=progress;
  $('pause').disabled=!started||elapsed>=total;$('start').disabled=started&&elapsed<total;
  if(elapsed>=total){running=false;$('start').textContent='Run again';$('pause').textContent='Pause';}
}
function reset(){elapsed=0;running=false;started=false;$('start').textContent='Start mission';$('pause').textContent='Pause';updateMission();}
$('start').addEventListener('click',()=>{if(elapsed>=total)reset();started=true;running=true;updateMission();});
$('pause').addEventListener('click',()=>{running=!running;$('pause').textContent=running?'Pause':'Resume';});
$('reset').addEventListener('click',reset);
function setView(next){
  view=next;
  const presets={overview:[[160,116,172],[0,10,8]],street:[[28,9,14],[-32,12,-46]],roof:[[85,38,97],[46,roofY+2,53]],follow:[[home.x+20,home.y+13,home.z+23],[home.x,home.y,home.z]]};
  const [p,t]=presets[next];camera.position.fromArray(p);controls.target.fromArray(t);controls.update();
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===next)));
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
setView('overview');reset();
// Read-only browser inspection hook: no flight, serial or hardware API calls.
window.FictionalRescue={getState:()=>({elapsed,total,running,started,phase:elapsed>=total?'Mission complete':phases[phaseIndex]?.[0],delivered,onboard,view,position:drone.position.toArray(),calls:renderer.info.render.calls}),setView};
let frames=0,frameWindow=performance.now();
function frame(now){
  requestAnimationFrame(frame);const dt=Math.min(.1,(now-lastTime)/1000);lastTime=now;
  if(running){elapsed=Math.min(total,elapsed+dt*Number($('speed').value));visualTime+=dt;}
  if(!started)visualTime+=dt;
  updateMission();
  if(running&&phaseIndex>0&&elapsed<total)rotors.forEach((r,i)=>r.rotation.y+=(i%2?1:-1)*dt*65);
  for(let i=0;i<people.length;i++)people[i].rotation.z=Math.sin(visualTime*1.5+i)*.025;
  const attr=waterGeometry.attributes.position;
  for(let i=0;i<attr.count;i++)attr.array[i*3+1]=waterBase[i*3+1]+Math.sin(waterBase[i*3]*.25+visualTime)*.045+Math.cos(waterBase[i*3+2]*.35+visualTime*.7)*.025;
  attr.needsUpdate=true;
  dropRing.material.opacity=.65+Math.sin(visualTime*2)*.25;dropRing.material.transparent=true;
  if(view==='follow'){
    const offset=new THREE.Vector3(19,11,23);camera.position.lerp(drone.position.clone().add(offset),1-Math.exp(-dt*3));controls.target.lerp(drone.position,1-Math.exp(-dt*4));
  }
  controls.update();renderer.render(scene,camera);frames++;
  if(now-frameWindow>1500){$('renderStatus').textContent=`Local 3D · ${Math.round(frames*1000/(now-frameWindow))} fps`;frames=0;frameWindow=now;}
}
requestAnimationFrame(frame);
