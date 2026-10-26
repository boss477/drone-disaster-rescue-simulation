// World presentation uses NASA-AMMOS 3DTilesRendererJS. Existing mission decisions
// and AI review remain in earth_rescue.js; no flight commands originate here.
import * as THREE from 'three';
import { TilesRenderer, GlobeControls, WGS84_ELLIPSOID } from '3d-tiles-renderer/three';
import { GeneratedSurfacePlugin, XYZTilesOverlay, CesiumIonAuthPlugin,
  ImageOverlayPlugin, GLTFExtensionsPlugin } from '3d-tiles-renderer/three/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const element = id => document.getElementById(id);
const worldElement = element('nasaWorld');
const status = element('nasaWorldStatus');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#081b29');
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1e8);
const root = new THREE.Group();
root.matrixAutoUpdate = false;
scene.add(root);
const actors = new THREE.Group();
scene.add(actors);
const frame = new THREE.Matrix4();
const inverse = new THREE.Matrix4();
const point = new THREE.Vector3();
let renderer, controls;
let origin = { lat: 12.2958, lon: 76.6394 };
let lastMission = null;
let worldLayers = [];
let customLayer = null;
let terrainLayer = null;
let active = false;
let modelLoads = 0;
let failures = 0;
let lastFrameAt = 0;
let lastCreditCheck = 0;
let ready = false;
let detailedWorld = false;
let groundKnown = false;
let groundHeight = 0;
let viewKind = 'local';
let navigationTouched = false;
let terrainSampler = null;
let groundSampleGeneration = 0;
let groundSampling = false;
const meshes = new Map();
const draco = new DRACOLoader().setDecoderPath('/vendor/draco/');

function local(ecef, target = new THREE.Vector3()) {
  return target.set(ecef.x, ecef.y, ecef.z).applyMatrix4(inverse);
}

function anchor(area) {
  const sameArea = Math.abs(origin.lat-area.lat)<1e-7 && Math.abs(origin.lon-area.lon)<1e-7;
  if (!sameArea) { groundKnown=!detailedWorld; groundHeight=0; groundSampleGeneration++; }
  origin = { lat: area.lat, lon: area.lon };
  WGS84_ELLIPSOID.getEastNorthUpFrame(THREE.MathUtils.degToRad(area.lat),
    THREE.MathUtils.degToRad(area.lon), 0, frame);
  frame.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  inverse.copy(frame).invert();
  root.matrix.copy(inverse);
  root.updateMatrixWorld(true);
  actors.position.y = groundHeight-missionBaseHeight();
  element('exploreLat').value=area.lat.toFixed(6);
  element('exploreLon').value=area.lon.toFixed(6);
  if (!sameArea && detailedWorld && ready) sampleGround();
}

function missionBaseHeight() {
  return typeof mission !== 'undefined' ? mission?.terrain?.heights?.[0] || 0 : 0;
}

function applyGroundHeight(height) {
  const firstGround=!groundKnown;
  groundKnown=true;
  groundHeight=height;
  const next=height-missionBaseHeight();
  const delta=next-actors.position.y;
  actors.position.y=next;
  if (viewKind==='local' && !navigationTouched) {
    if (firstGround) missionView();
    else camera.position.y+=delta;
  } else if (viewKind==='preset' && !navigationTouched && firstGround) {
    camera.lookAt(new THREE.Vector3(0,height,0));
  }
}

async function sampleGround() {
  const generation=++groundSampleGeneration;
  const area={...origin};
  groundSampling=true;
  let timer;
  try {
    // Sample one location from the terrain source, not an unfinished coarse
    // render mesh: its chord error can put a real city below sea level.
    Cesium.Ion.defaultAccessToken=element('cesiumToken').value.trim();
    if (!terrainSampler) terrainSampler=Cesium.createWorldTerrainAsync();
    const work=(async()=>{
      const provider=await terrainSampler;
      return Cesium.sampleTerrainMostDetailed(provider,[Cesium.Cartographic.fromDegrees(area.lon,area.lat)]);
    })();
    const [sample]=await Promise.race([work,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('terrain height timeout')),30000);
    })]);
    if (generation!==groundSampleGeneration || !detailedWorld) return;
    if (!Number.isFinite(sample.height) || sample.height < -1000 || sample.height > 12000) throw new Error('terrain height unavailable');
    applyGroundHeight(sample.height);
  } catch (error) {
    if (generation===groundSampleGeneration) {
      terrainSampler=null;
      status.textContent='3D tiles are streaming; precise ground height is unavailable. Mission view will stay high. Reload 3D to retry.';
    }
  } finally {
    clearTimeout(timer);
    if (generation===groundSampleGeneration) groundSampling=false;
  }
}

function resize() {
  if (!renderer) return;
  const width = worldElement.clientWidth || innerWidth;
  const height = worldElement.clientHeight || innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  for (const tiles of [...worldLayers, customLayer].filter(Boolean)) tiles.setResolutionFromRenderer(camera, renderer);
}

function disposeLayer(tiles) {
  if (!tiles) return;
  root.remove(tiles.group);
  tiles.dispose();
}

function configure(tiles, custom = false) {
  tiles.loadedModels = 0;
  tiles.failedLoads = 0;
  tiles.errorTarget = 16;
  tiles.downloadQueue.maxJobs = 4;
  tiles.lruCache.minBytesSize = 32 * 1024 * 1024;
  tiles.lruCache.maxBytesSize = 128 * 1024 * 1024;
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder, autoDispose: false }));
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.addEventListener('load-model', () => {
    modelLoads++;
    tiles.loadedModels++;
    if (custom) element('nasaTileStatus').textContent = '3D Tiles content loaded by NASA renderer. Survey provenance depends on your dataset.';
  });
  tiles.addEventListener('load-error', () => {
    failures++;
    tiles.failedLoads++;
    if (custom) element('nasaTileStatus').textContent = 'Tileset failed to load. Check its URL, CORS access, coordinates and required credentials.';
    else status.textContent = 'Some online tiles are unavailable. The local rescue scene remains usable.';
  });
  root.add(tiles.group);
  return tiles;
}

function osmOverlay() {
  return new XYZTilesOverlay({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', levels: 19 });
}

function loadWorld(detailed = false) {
  if (!ready) return;
  worldLayers.forEach(disposeLayer);
  worldLayers = [];
  terrainLayer = null;
  detailedWorld = detailed;
  groundSampleGeneration++;
  groundSampling=false;
  groundKnown=!detailed;
  groundHeight=0;
  actors.position.y = 0;
  controls.adjustHeight=detailed;
  const map = new TilesRenderer();
  map.registerPlugin(new GeneratedSurfacePlugin({ overlay: osmOverlay(), projection: 'ellipsoid', applyOverlayTexture: true }));
  worldLayers.push(configure(map));
  if (detailed) {
    const token = element('cesiumToken').value.trim();
    if (!token) { status.textContent = 'Add a Cesium ion token for hosted terrain/buildings. OpenStreetMap remains enabled.'; return; }
    terrainLayer = new TilesRenderer();
    terrainLayer.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId: '1', autoRefreshToken: true }));
    terrainLayer.registerPlugin(new ImageOverlayPlugin({ overlays: [osmOverlay()], renderer, resolution: 256 }));
    worldLayers.push(configure(terrainLayer));
    const buildings = new TilesRenderer();
    buildings.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId: '96188', autoRefreshToken: true }));
    worldLayers.push(configure(buildings));
  }
  status.textContent = detailed
    ? 'Worldwide 3D enabled: terrain and mapped buildings stream automatically as the camera moves.'
    : 'NASA world ready. OpenStreetMap tiles stream in the background; local 3D actors start immediately.';
  if (viewKind==='local' && !navigationTouched) missionView();
  if (detailed) sampleGround();
}

function clearMeshes() {
  for (const mesh of meshes.values()) {
    actors.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  meshes.clear();
}

function colorOf(property, time, fallback = '#a5cfca') {
  const value = property?.getValue?.(time);
  const color = value?.color || value;
  return color && Number.isFinite(color.red)
    ? { color: new THREE.Color(color.red, color.green, color.blue), opacity: color.alpha ?? 1 }
    : { color: new THREE.Color(fallback), opacity: 1 };
}

function makeMesh(entity, time) {
  let geometry, material, shape;
  if (entity.box) {
    const d = entity.box.dimensions.getValue(time);
    geometry = entity.orientation ? new THREE.BoxGeometry(d.x,d.y,d.z) : new THREE.BoxGeometry(d.x,d.z,d.y);
    shape = entity.box;
  } else if (entity.ellipsoid) {
    const r = entity.ellipsoid.radii.getValue(time);
    geometry = new THREE.SphereGeometry(1,12,8);
    geometry.scale(r.x,r.z,r.y);
    shape = entity.ellipsoid;
  } else if (entity.ellipse) {
    geometry = new THREE.CircleGeometry(entity.ellipse.semiMajorAxis.getValue(time),32);
    geometry.rotateX(-Math.PI/2);
    shape = entity.ellipse;
  } else if (entity.polygon) {
    const positions = entity.polygon.hierarchy.getValue(time).positions;
    const height = entity.polygon.height?.getValue(time) ?? 0;
    const vertices = positions.map(p => {
      const carto = Cesium.Cartographic.fromCartesian(p);
      return local(Cesium.Cartesian3.fromRadians(carto.longitude,carto.latitude,height));
    });
    const triangles = THREE.ShapeUtils.triangulateShape(vertices.map(v => new THREE.Vector2(v.x,v.z)),[]).flat();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flatMap(v => v.toArray()),3));
    geometry.setIndex(triangles);
    geometry.computeVertexNormals();
    shape = entity.polygon;
  } else if (entity.polyline) {
    geometry = new THREE.BufferGeometry().setFromPoints(entity.polyline.positions.getValue(time).map(p => local(p)));
    material = new THREE.LineBasicMaterial({color:'#6bede3'});
    return new THREE.Line(geometry,material);
  } else return null;
  const appearance = colorOf(shape.material,time);
  material = new THREE.MeshLambertMaterial({color:appearance.color,opacity:appearance.opacity,
    transparent:appearance.opacity<1,side:THREE.DoubleSide});
  return new THREE.Mesh(geometry,material);
}

function syncActors() {
  if (typeof mission === 'undefined' || !mission) {
    if (meshes.size) clearMeshes();
    lastMission = null;
    return;
  }
  if (mission !== lastMission) {
    clearMeshes();
    anchor(mission.base || mission.terrain?.base || selected);
    lastMission = mission;
    missionView();
  }
  const time = Cesium.JulianDate.now();
  const entities = [...new Set([drone,...packages,...routeEntities].filter(Boolean))];
  const live = new Set(entities.map(e => e.id));
  for (const [id,mesh] of meshes) if (!live.has(id)) {
    actors.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshes.delete(id);
  }
  for (const entity of entities) {
    let mesh = meshes.get(entity.id);
    if (!mesh) {
      mesh = makeMesh(entity,time);
      if (!mesh) continue;
      meshes.set(entity.id,mesh);
      actors.add(mesh);
    }
    const position = entity.position?.getValue(time);
    if (position) local(position,mesh.position);
    const orientation = entity.orientation?.getValue(time);
    if (orientation) {
      mesh.quaternion.setFromRotationMatrix(inverse).multiply(new THREE.Quaternion(orientation.x,orientation.y,orientation.z,orientation.w));
    }
    const shape = entity.box || entity.ellipsoid || entity.ellipse || entity.polygon;
    if (shape && mesh.material.color) mesh.material.color.copy(colorOf(shape.material,time).color);
  }
  if (element('followDrone').checked && drone && meshes.has(drone.id) && (!detailedWorld || groundKnown)) {
    point.copy(meshes.get(drone.id).position).add(actors.position);
    camera.position.copy(point).add(new THREE.Vector3(90,100,150));
    camera.up.set(0,1,0);
    camera.lookAt(point);
  }
}

function missionView() {
  if (!ready) return;
  viewKind='local';
  navigationTouched=false;
  let north = 125;
  let distance = 500;
  if (typeof mission !== 'undefined' && mission?.target) {
    const position = WGS84_ELLIPSOID.getCartographicToPosition(THREE.MathUtils.degToRad(mission.target.lat),
      THREE.MathUtils.degToRad(mission.target.lon),0,new THREE.Vector3());
    local(position,point);
    north = -point.z/2;
    distance = Math.max(500,point.length()*1.8);
  }
  // Stay above even Himalayan peaks while the new area's elevation arrives.
  // Once sampled, focus down to a useful oblique view of the actual surface.
  if (detailedWorld && !groundKnown) distance=Math.max(distance,18000);
  // At mountain summits a street-scale view can fill the screen with one
  // hillside. Step back to show the surrounding relief when exploring.
  if (groundKnown && groundHeight>2500 && !(typeof mission!=='undefined' && mission)) distance=Math.max(distance,5000);
  const target = new THREE.Vector3(0,groundHeight+25,-north);
  camera.position.copy(target).add(new THREE.Vector3(0,distance*.67,distance*.74));
  camera.up.set(0,1,0);
  camera.lookAt(target);
  controls.resetState();
  camera.updateMatrixWorld();
}

function wholeEarth() {
  if (!ready) return;
  viewKind='globe';
  navigationTouched=false;
  element('followDrone').checked = false;
  const position = WGS84_ELLIPSOID.getCartographicToPosition(THREE.MathUtils.degToRad(20),
    THREE.MathUtils.degToRad(80),1.3e7,new THREE.Vector3());
  local(position,camera.position);
  camera.up.set(0,1,0);
  camera.lookAt(new THREE.Vector3().applyMatrix4(inverse));
  controls.resetState();
}

function selectArea(area) {
  if (!ready) return;
  anchor(area);
  missionView();
}

function exploreCoordinates() {
  const latValue=element('exploreLat').value.trim(), lonValue=element('exploreLon').value.trim();
  const lat=Number(latValue), lon=Number(lonValue);
  if (!latValue || !lonValue || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) {
    element('exploreStatus').textContent='Enter latitude −90 to 90 and longitude −180 to 180.';
    return;
  }
  if (typeof running!=='undefined' && running) {
    element('exploreStatus').textContent='Finish or reset the mission before selecting a new area.';
    return;
  }
  setLocation(lat,lon,'Operator coordinate selection','operator','coordinates supplied by operator');
  element('exploreStatus').textContent=`Exploring ${lat.toFixed(5)}, ${lon.toFixed(5)}. The camera will settle above the loaded terrain.`;
}

function setMode() {
  active = element('worldRenderer').value === 'nasa' && ready;
  worldElement.hidden = !active;
  element('nasaCredit').hidden = !active;
  element('globe').style.visibility = active ? 'hidden' : 'visible';
  if (typeof viewer !== 'undefined' && viewer) viewer.useDefaultRenderLoop = !active;
  if (active) { resize(); missionView(); }
  element('earthStatus').textContent = active
    ? element('detailedEarth').checked ? 'NASA world: worldwide 3D terrain and mapped buildings enabled.' : 'NASA world: fast map mode, 3D layers switched off.'
    : 'Cesium reference view selected. Its fast mode uses a schematic grid.';
}

function loadCustom(explicitUrl = null) {
  const value = typeof explicitUrl === 'string' ? explicitUrl : element('nasaTilesUrl').value.trim();
  if (!value || !ready) return;
  let url;
  try {
    url = new URL(value,location.href);
    if (!['http:','https:'].includes(url.protocol)) throw new Error('Use an HTTP(S) tileset URL.');
  } catch (error) { element('nasaTileStatus').textContent = error.message; return; }
  disposeLayer(customLayer);
  customLayer = configure(new TilesRenderer(url.href),true);
  viewKind='custom';
  customLayer.addEventListener('load-root-tileset', () => {
    // Fit the supplied survey; its root transform determines its actual location.
    const sphere = new THREE.Sphere();
    if (customLayer.getBoundingSphere(sphere)) {
      sphere.applyMatrix4(inverse);
      camera.position.copy(sphere.center).add(new THREE.Vector3(0,1,1.2).multiplyScalar(Math.max(80,sphere.radius*2)));
      camera.up.set(0,1,0); camera.lookAt(sphere.center);
    }
  });
  element('nasaTileStatus').textContent = 'Loading a georeferenced 3D Tiles dataset…';
}

async function loadODM(manifestUrl) {
  try {
    const base = new URL(manifestUrl,location.href);
    const response = await fetch(base);
    if (!response.ok) throw new Error(`Manifest returned HTTP ${response.status}`);
    const manifest = await response.json();
    const asset = element('odmMesh').checked && manifest.texturedMesh
      ? manifest.texturedMesh : element('odmCloud').checked && manifest.pointCloud ? manifest.pointCloud : null;
    if (!asset?.url) throw new Error('Select a tiled mesh or point cloud. Orthophoto and DSM overlays remain available in the Cesium reference view.');
    const url = new URL(asset.url,base).href;
    element('nasaTilesUrl').value=url;
    loadCustom(url);
    element('odmStatus').textContent='NASA renderer loading the selected ODM 3D layer. Orthophoto / DSM overlays use the reference view.';
    element('clearOdm').disabled=false;
  } catch (error) { element('odmStatus').textContent=`ODM: ${error.message}`; }
}

function clearCustom() {
  disposeLayer(customLayer); customLayer=null;
  element('nasaTileStatus').textContent='Custom tileset cleared.';
}

function flyToPreset(preset) {
  if (!ready) return;
  viewKind='preset';
  navigationTouched=false;
  const p=preset.camera;
  const world=WGS84_ELLIPSOID.getCartographicToPosition(THREE.MathUtils.degToRad(p.lat),
    THREE.MathUtils.degToRad(p.lon),p.height,new THREE.Vector3());
  local(world,camera.position);
  camera.up.set(0,1,0); camera.lookAt(new THREE.Vector3());
  controls.resetState();
}

function animate(now) {
  requestAnimationFrame(animate);
  if (!active || now-lastFrameAt<33) return;
  const dt = Math.min((now-lastFrameAt)/1000,.1);
  lastFrameAt = now;
  syncActors();
  controls.update(dt);
  camera.updateMatrixWorld();
  root.updateMatrixWorld(true);
  for (const tiles of [...worldLayers,customLayer].filter(Boolean)) tiles.update();
  // Once terrain is visible it supplies its own OSM overlay. Avoid coincident
  // flat-map and terrain surfaces fighting over the same depth pixels.
  if (worldLayers[0]) worldLayers[0].group.visible=!(terrainLayer?.visibleTiles.size>0);
  if (now-lastCreditCheck>2000) {
    lastCreditCheck=now;
    const credits=[];
    for (const layer of [...worldLayers,customLayer].filter(Boolean)) {
      for (const attribution of layer.getAttributions()) {
        // Provider markup is inert; insert only its attribution text into the UI.
        const template=document.createElement('template');
        template.innerHTML=String(attribution.value || '');
        const text=template.content.textContent.trim();
        if (text && !credits.includes(text)) credits.push(text);
      }
    }
    element('nasaProviderCredits').textContent=credits.length ? ' · '+credits.join(' · ') : '';
    const buildings=worldLayers[2];
    element('worldCoverage').textContent=!detailedWorld
      ? 'Fast map mode: global 3D terrain/buildings are switched off.'
      : `3D terrain: ${terrainLayer?.visibleTiles.size || 0} visible tiles · Buildings: ${buildings?.visibleTiles.size || 0} visible tiles. `+
        (buildings?.visibleTiles.size ? 'Mapped geometry is visible; detail varies by area.'
          : buildings?.isLoading ? 'Building data is loading for this view.'
          : buildings?.failedLoads ? 'Building requests failed; check network access and the configured token.'
          : 'No building geometry is visible at this zoom; coverage may be incomplete.');
  }
  renderer.render(scene,camera);
}

try {
  renderer = new THREE.WebGLRenderer({antialias:false,logarithmicDepthBuffer:true});
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1;
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));
  worldElement.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#d7f2ff','#344438',0.85));
  const light = new THREE.DirectionalLight('#fff0d6',1.5);
  light.position.set(300,700,300); scene.add(light);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1,64,32),new THREE.MeshLambertMaterial({color:'#224857'}));
  earth.rotation.x=Math.PI/2;
  // Coarse generated globe tiles have chord error measured in kilometres.
  // Keep the loading placeholder well inside them, rather than 100 m below.
  earth.scale.set(WGS84_ELLIPSOID.radius.x*.98,WGS84_ELLIPSOID.radius.z*.98,WGS84_ELLIPSOID.radius.y*.98);
  root.add(earth);
  controls = new GlobeControls(scene,camera,renderer.domElement);
  controls.setEllipsoid(WGS84_ELLIPSOID,root);
  controls.adjustHeight=false;
  controls.enableDamping=false;
  controls.minAltitude=25;
  controls.addEventListener('start',()=>{navigationTouched=true;});
  let down;
  renderer.domElement.addEventListener('pointerdown',e => {down={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e => {
    if (!down || Math.hypot(e.clientX-down.x,e.clientY-down.y)>4 || e.button!==0 || (typeof running!=='undefined' && running)) return;
    const rect=renderer.domElement.getBoundingClientRect();
    const ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    const ecefRay=ray.ray.clone().applyMatrix4(frame);
    const hit=WGS84_ELLIPSOID.intersectRay(ecefRay,new THREE.Vector3());
    if (hit) {
      const area=WGS84_ELLIPSOID.getPositionToCartographic(hit,{});
      setLocation(THREE.MathUtils.radToDeg(area.lat),THREE.MathUtils.radToDeg(area.lon),'NASA world map selection','operator','approximate map selection');
    }
  });
  ready=true;
  anchor(typeof selected!=='undefined' && selected ? selected : origin);
  window.RescueWorld={selectArea,missionView,loadWorld,wholeEarth,loadODM,clearCustom,flyToPreset,
    getState:()=>({engine:'NASA-AMMOS/3DTilesRendererJS',version:'0.5.3',active,ready,modelLoads,failures,
      detailed:detailedWorld,groundKnown,groundSampling,groundHeight,viewKind,
      cameraAltitude:WGS84_ELLIPSOID.getPositionElevation(camera.position.clone().applyMatrix4(frame)),
      actorCount:meshes.size,origin:{...origin},drawCalls:renderer.info.render.calls,
      terrainModels:terrainLayer?.loadedModels || 0,buildingModels:worldLayers[2]?.loadedModels || 0,
      terrainVisible:terrainLayer?.visibleTiles.size || 0,buildingVisible:worldLayers[2]?.visibleTiles.size || 0,
      visibleTiles:worldLayers.reduce((n,t)=>n+t.visibleTiles.size,0),customVisible:customLayer?.visibleTiles.size || 0})};
  element('worldRenderer').onchange=setMode;
  element('worldOverview').onclick=wholeEarth;
  element('worldMission').onclick=missionView;
  element('exploreWorld').onclick=exploreCoordinates;
  element('loadNasaTiles').onclick=loadCustom;
  element('clearNasaTiles').onclick=clearCustom;
  window.addEventListener('resize',resize);
  setMode();
  loadWorld(element('detailedEarth').checked);
  requestAnimationFrame(animate);
} catch (error) {
  status.textContent=`NASA world could not start: ${error.message}. Using the Cesium reference view.`;
  element('worldRenderer').value='cesium';
  active=false;
  worldElement.hidden=true;
  element('nasaCredit').hidden=true;
  element('globe').style.visibility='visible';
  if (typeof viewer!=='undefined' && viewer) viewer.useDefaultRenderLoop=true;
}
