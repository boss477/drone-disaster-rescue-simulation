// Small original quadcopter model; no external model downloads or textures.
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {writeFileSync} from 'node:fs';
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();});}
};
const scene=new THREE.Scene(),animations=[];
const orange=new THREE.MeshStandardMaterial({color:'#f07738',roughness:.5});
const black=new THREE.MeshStandardMaterial({color:'#172b35',roughness:.6});
const silver=new THREE.MeshStandardMaterial({color:'#cbd6d6',metalness:.6,roughness:.35});
const green=new THREE.MeshStandardMaterial({color:'#7ef5c2',emissive:'#42c59b',emissiveIntensity:.8});
function box(w,h,d,x,y,z,material,parent=scene){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);parent.add(m);return m;}
box(1,.34,1.25,0,0,0,orange);box(.75,.15,.75,0,.25,0,black);
box(.3,.3,.4,0,-.3,-.65,black);box(.18,.14,.03,0,-.3,-.87,silver);
for(const x of [-1,1])for(const z of [-1,1]){
  const arm=box(1.5,.1,.12,x*.65,0,z*.65,silver);arm.rotation.y=-x*z*Math.PI/4;
  const motor=new THREE.Mesh(new THREE.CylinderGeometry(.15,.18,.25,12),black);motor.position.set(x*1.2,.12,z*1.2);scene.add(motor);
  const rotor=new THREE.Group();rotor.name='Rotor'+scene.children.length;rotor.position.set(x*1.2,.27,z*1.2);scene.add(rotor);
  box(1.1,.025,.09,0,0,0,black,rotor);box(.09,.025,1.1,0,0,0,black,rotor);
  const values=[];for(let i=0;i<5;i++){const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*Math.PI/2);values.push(...q.toArray());}
  animations.push(new THREE.AnimationClip(rotor.name,1,[new THREE.QuaternionKeyframeTrack(rotor.name+'.quaternion',[0,.25,.5,.75,1],values)]));
  box(.09,.09,.09,x*1.2,-.06,z*1.2,green);
}
for(const s of [-1,1]){box(.07,.55,.07,s*.45,-.4,.4,silver);box(.07,.55,.07,s*.45,-.4,-.4,silver);box(.08,.07,1.4,s*.45,-.68,0,black);}
const data=await new GLTFExporter().parseAsync(scene,{binary:true,animations});
writeFileSync(new URL('../vendor/rescue-quadcopter.glb',import.meta.url),Buffer.from(data));
console.log('Built original rescue quadcopter GLB ('+data.byteLength+' bytes).');
