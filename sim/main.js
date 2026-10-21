// Flood rescue 3D simulation. SIMULATION ONLY: every person, package and delivery is simulated.
// Mission data comes from sim/mission.json (shared with mission_model.py for the MAVLink bridge).
import * as THREE from '../vendor/three.module.js';

const $ = (id) => document.getElementById(id);
const mission = await (await fetch(new URL('./mission.json', import.meta.url))).json();
function selectedLiveLocation() {
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (valid) return { latitude_deg: lat, longitude_deg: lon, name: params.get('name') || 'Selected live-map area' };
  try {
    const saved = JSON.parse(localStorage.getItem('liveOpsMissionLocation'));
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) return { latitude_deg: saved.lat, longitude_deg: saved.lon, name: saved.name || 'Selected live-map area' };
  } catch { /* ignore malformed local storage */ }
  return null;
}
const liveLocation = selectedLiveLocation();
if (liveLocation) $('missionLocation').textContent = `SIMULATED mission origin: ${liveLocation.name} (${liveLocation.latitude_deg.toFixed(5)}, ${liveLocation.longitude_deg.toFixed(5)})`;

// ---------------------------------------------------------------- timeline
// Mirrors mission_model.py. Scene metres: +x east, -z north, +y up.
function buildTimeline(m) {
  const pad = [m.base.x, m.base.pad_height, m.base.z];
  const aboveBase = [pad[0], m.cruise_altitude_m, pad[2]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const segs = [];
  let heading = 0;
  const add = (phase, start, end, duration, site = -1) => {
    const dx = end[0] - start[0], dz = end[2] - start[2];
    if (Math.hypot(dx, dz) > 1e-6) heading = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    segs.push({ phase, start, end, duration: Math.max(duration, 0), site, heading, startTime: 0 });
  };
  add('loading', pad, pad, m.packages_loaded * m.load_seconds_per_package);
  add('takeoff', pad, aboveBase, dist(pad, aboveBase) / m.climb_speed_mps);
  let here = aboveBase;
  m.sites.forEach((s, i) => {
    const over = [s.x, m.cruise_altitude_m, s.z];
    const low = [s.x, s.roof_height + m.hover_above_roof_m, s.z];
    add('transit', here, over, dist(here, over) / m.cruise_speed_mps, i);
    add('descend', over, low, dist(over, low) / m.descent_speed_mps, i);
    add('detect', low, low, m.detect_seconds, i);
    add('unload', low, low, m.unload_seconds, i);
    add('ascend', low, over, dist(low, over) / m.climb_speed_mps, i);
    here = over;
  });
  add('return', here, aboveBase, dist(here, aboveBase) / m.cruise_speed_mps);
  add('landing', aboveBase, pad, dist(aboveBase, pad) / m.descent_speed_mps);
  let clock = 0;
  for (const s of segs) { s.startTime = clock; clock += s.duration; }
  return { segs, total: clock };
}

function stateAt(m, tl, tRaw) {
  const t = Math.min(Math.max(tRaw, 0), tl.total);
  let detected = 0, delivered = 0, cur = tl.segs[tl.segs.length - 1], found = false;
  for (const s of tl.segs) {
    if (t >= s.startTime + s.duration) {
      if (s.phase === 'detect') detected += m.sites[s.site].people;
      else if (s.phase === 'unload') delivered += 1;
      continue;
    }
    cur = s; found = true; break;
  }
  const complete = t >= tl.total;
  const f = cur.duration === 0 ? 1 : Math.min((t - cur.startTime) / cur.duration, 1);
  const pos = cur.start.map((a, i) => a + (cur.end[i] - a) * f);
  const vel = (cur.duration > 0 && !complete) ? cur.start.map((a, i) => (cur.end[i] - a) / cur.duration) : [0, 0, 0];
  const loaded = cur.phase === 'loading' && found
    ? Math.min(m.packages_loaded, Math.floor((t - cur.startTime) / m.load_seconds_per_package))
    : m.packages_loaded;
  const flight = Math.max(t - tl.segs[0].duration, 0);
  const items = m.sites.length + 2;
  const seq = (cur.phase === 'loading' || cur.phase === 'takeoff') ? 0
    : (cur.phase === 'return' || cur.phase === 'landing' || complete) ? items - 1 : cur.site + 1;
  return {
    source: 'browser', phase: complete ? 'complete' : cur.phase, t, total_seconds: tl.total,
    progress_percent: tl.total ? 100 * t / tl.total : 100,
    position: { x: pos[0], y: pos[1], z: pos[2] }, velocity: { x: vel[0], y: vel[1], z: vel[2] },
    heading_deg: cur.heading, battery_percent: Math.max(100 - m.battery_drain_percent_per_second * flight, 0),
    packages_loaded: loaded, packages_onboard: loaded - delivered, packages_delivered: delivered,
    people_detected: detected, site_index: cur.site, site_name: cur.site >= 0 ? m.sites[cur.site].name : '',
    mission_seq: seq, mission_total: items, complete, simulated: true,
    map_origin: liveLocation,
    unload_fraction: cur.phase === 'unload' && !complete ? f : 0,
    detect_fraction: cur.phase === 'detect' && !complete ? f : 0,
  };
}

const timeline = buildTimeline(mission);

// ------------------------------------------------------------------- scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07131f);
scene.fog = new THREE.Fog(0x07131f, 45, 110);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 250);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

// orbit camera (drag + wheel)
const orbit = { theta: 0.65, phi: 1.0, radius: 38, target: new THREE.Vector3(0, 2, 2) };
function placeCamera() {
  const { theta, phi, radius, target } = orbit;
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.theta -= (e.clientX - lastX) * 0.006;
  orbit.phi = Math.min(Math.max(orbit.phi - (e.clientY - lastY) * 0.006, 0.25), 1.5);
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.radius = Math.min(Math.max(orbit.radius * (e.deltaY > 0 ? 1.07 : 0.93), 10), 80);
}, { passive: false });

scene.add(new THREE.HemisphereLight(0x9fe7ff, 0x183044, 2));
const sun = new THREE.DirectionalLight(0xffe4b0, 2.2);
sun.position.set(-12, 25, 8);
scene.add(sun);

const mat = (c, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...extra });
const GROUND_Y = -1, WATER_Y = 1;

const ground = new THREE.Mesh(new THREE.BoxGeometry(48, 0.5, 38), mat(0x243d42));
ground.position.y = GROUND_Y - 0.25;
scene.add(ground);
const water = new THREE.Mesh(new THREE.BoxGeometry(52, WATER_Y - GROUND_Y, 42),
  mat(0x12617b, 0.2, { transparent: true, opacity: 0.72 }));
water.position.y = (WATER_Y + GROUND_Y) / 2;
scene.add(water);

// flooded buildings: lower floors sit under the translucent water
function building(x, z, roof, colour) {
  const h = roof - GROUND_Y;
  const b = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), mat(colour));
  b.position.set(x, GROUND_Y + h / 2, z);
  scene.add(b);
  for (let y = WATER_Y + 0.6; y < roof - 0.4; y += 1.3) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.06), mat(0xffd66e));
    w.position.set(x - 1.2, y, z + 2.03);
    scene.add(w);
  }
}
const siteCells = new Set(mission.sites.map((s) => `${s.x},${s.z}`));
for (let x = -18; x <= 18; x += 6) {
  for (let z = -14; z <= 14; z += 7) {
    if (siteCells.has(`${x},${z}`) || Math.hypot(x - mission.base.x, z - mission.base.z) < 5) continue;
    building(x, z, 2 + ((x * x + z * z) % 5) - 0.0, (x + z) % 2 ? 0x9b6b52 : 0x536477);
  }
}
mission.sites.forEach((s) => building(s.x, s.z, s.roof_height, 0x9b6b52));

// base dock
const dock = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, mission.base.pad_height - GROUND_Y, 32), mat(0x16b89a));
dock.position.set(mission.base.x, GROUND_Y + (mission.base.pad_height - GROUND_Y) / 2, mission.base.z);
scene.add(dock);

function label(text, colour = '#ffc857') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#07131fcc'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = colour; g.font = 'bold 26px Segoe UI, sans-serif'; g.textAlign = 'center';
  g.fillText(text, 128, 40);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

// simulated rooftop people (each clearly labelled)
const siteGroups = mission.sites.map((s) => {
  const group = new THREE.Group();
  for (let i = 0; i < s.people; i++) {
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.65, 8), mat(0xffb13b));
    body.position.y = 0.33; p.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), mat(0xf0c49a));
    head.position.y = 0.85; p.add(head);
    p.position.set((i - (s.people - 1) / 2) * 0.9, 0, 0.4);
    group.add(p);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.3, 32), new THREE.MeshBasicMaterial({ color: 0x8895a0, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; group.add(ring);
  const tag = label('SIMULATED PERSON'); tag.position.set(0, 2.0, 0.4); group.add(tag);
  group.position.set(s.x, s.roof_height, s.z);
  scene.add(group);
  return { group, ring };
});

// drone
const drone = new THREE.Group();
drone.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 1.05), mat(0xe9f3f5)));
const props = [];
for (const s of [-1, 1]) for (const t of [-1, 1]) {
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 8), mat(0x172b38));
  bar.rotation.z = Math.PI / 2; bar.position.set(s * 0.9, 0.1, t * 0.65); drone.add(bar);
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.03, 16), mat(0x53d7e8, 0.4, { transparent: true, opacity: 0.55 }));
  prop.position.set(s * 1.35, 0.28, t * 0.65); drone.add(prop); props.push(prop);
}
const droneTag = label('SIMULATED DRONE', '#7de7ff'); droneTag.position.y = 1.4; drone.add(droneTag);
scene.add(drone);

// package inventory: crates carried under the drone, crates delivered on rooftops
const crateGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const crateMat = mat(0xffc857);
const deliveredMat = mat(0x1ac7a2);
const carried = [];
for (let i = 0; i < mission.packages_loaded; i++) {
  const c = new THREE.Mesh(crateGeo, crateMat);
  c.visible = false; scene.add(c); carried.push(c);
}
const dropped = [];
const falling = new THREE.Mesh(crateGeo, crateMat); falling.visible = false; scene.add(falling);

// ------------------------------------------------------------------- state
let t = 0, running = false, finished = false, lastFrame = performance.now(), relayOk = false;
let state = stateAt(mission, timeline, 0);

const PHASE_TEXT = {
  loading: 'LOADING PACKAGES', takeoff: 'TAKING OFF', transit: 'FLYING TO RESCUE POINT',
  descend: 'DESCENDING TO ROOFTOP', detect: 'SCANNING FOR PEOPLE', unload: 'UNLOADING PACKAGE',
  ascend: 'CLIMBING', return: 'RETURNING TO BASE', landing: 'LANDING AT BASE', complete: 'MISSION COMPLETE',
};

function statusText(s) {
  switch (s.phase) {
    case 'loading': return `Loading packages at base: ${s.packages_loaded} of ${mission.packages_loaded}.`;
    case 'takeoff': return 'Drone lifting slowly from base...';
    case 'transit': return `Flying to ${mission.sites[s.site_index].name}.`;
    case 'descend': return `Descending to ${mission.sites[s.site_index].name}.`;
    case 'detect': return `Scanning ${mission.sites[s.site_index].name} for simulated people...`;
    case 'unload': return `Unloading a simulated package at ${mission.sites[s.site_index].name}.`;
    case 'ascend': return `Package delivered at ${mission.sites[s.site_index].name}. Climbing.`;
    case 'return': return 'All rescue points visited. Returning to base.';
    case 'landing': return 'Landing at base.';
    default: return `Mission complete. ${s.people_detected} simulated people detected, ${s.packages_delivered} simulated packages delivered.`;
  }
}

function setButtons() {
  $('start').disabled = running || (t > 0 && !finished) || finished;
  $('pause').disabled = finished || (!running && t === 0);
  $('pause').textContent = running ? 'Pause' : (t > 0 ? 'Resume' : 'Pause');
}

function render3D(s, dt) {
  drone.position.set(s.position.x, s.position.y + (s.phase === 'complete' || s.phase === 'loading' ? 0.3 : Math.sin(s.t * 2) * 0.08), s.position.z);
  drone.rotation.y = -s.heading_deg * Math.PI / 180;
  const spin = s.phase === 'loading' || s.phase === 'complete' ? 0 : 1;
  props.forEach((p, i) => { p.rotation.y += dt * 40 * spin * (i % 2 ? 1 : -1); p.material.opacity = spin ? 0.3 : 0.6; });

  // carried crates (those not yet delivered/falling), appear one by one while loading
  let onboardVisible = s.packages_onboard - (s.phase === 'unload' ? 1 : 0);
  carried.forEach((c, i) => {
    c.visible = i < onboardVisible;
    if (c.visible) c.position.set(drone.position.x + (i % 3 - 1) * 0.45, drone.position.y - 0.5 - Math.floor(i / 3) * 0.45, drone.position.z);
  });
  // package being unloaded drops from the drone to the roof
  falling.visible = s.phase === 'unload';
  if (falling.visible) {
    const site = mission.sites[s.site_index];
    const startY = drone.position.y - 0.5, endY = site.roof_height + 0.2;
    falling.position.set(site.x + 1.2, startY + (endY - startY) * s.unload_fraction, site.z - 0.8);
  }
  // delivered crates stay on rooftops
  while (dropped.length < s.packages_delivered) {
    const site = mission.sites[dropped.length];
    const c = new THREE.Mesh(crateGeo, deliveredMat);
    c.position.set(site.x + 1.2, site.roof_height + 0.2, site.z - 0.8);
    scene.add(c); dropped.push(c);
  }
  while (dropped.length > s.packages_delivered) scene.remove(dropped.pop());

  // detected people get a green ring
  let counted = 0;
  siteGroups.forEach((g, i) => {
    counted += mission.sites[i].people;
    g.ring.material.color.setHex(s.people_detected >= counted ? 0x1ac7a2 : (s.phase === 'detect' && s.site_index === i ? 0xffc857 : 0x8895a0));
  });
}

function renderHud(s) {
  $('detected').textContent = s.people_detected;
  $('delivered').textContent = s.packages_delivered;
  $('onboard').textContent = s.packages_onboard;
  $('battery').textContent = `${s.battery_percent.toFixed(0)}%`;
  $('phase').textContent = (running || t > 0) ? (PHASE_TEXT[s.phase] + (!running && !finished ? ' (PAUSED)' : '')) : 'READY';
  $('progressBar').style.width = `${s.progress_percent}%`;
  $('status').textContent = (t === 0 && !running) ? 'Drone ready at base. Mission speed: slow.' : statusText(s);
  const inv = $('inventory');
  if (inv.children.length !== mission.packages_loaded) {
    inv.innerHTML = '';
    for (let i = 0; i < mission.packages_loaded; i++) { const d = document.createElement('div'); d.className = 'pkg out'; inv.appendChild(d); }
  }
  [...inv.children].forEach((d, i) => {
    d.className = 'pkg ' + (i < s.packages_delivered ? 'done' : i < s.packages_loaded ? 'on' : 'out');
  });
  $('relay').textContent = relayOk ? 'Telemetry relay: connected (simulated data only)' : 'Telemetry relay: offline (optional, used by the MAVLink bridge)';
  $('relay').className = relayOk ? 'on' : '';
  if (finished) {
    $('complete').hidden = false;
    $('completeText').textContent = statusText(s);
  } else {
    $('complete').hidden = true;
  }
}

// ---------------------------------------------------------------- controls
function start() { if (finished) return; running = true; setButtons(); }
function togglePause() { if (finished || (t === 0 && !running)) return; running = !running; setButtons(); }
function reset() {
  t = 0; running = false; finished = false;
  state = stateAt(mission, timeline, 0);
  setButtons();
}
$('start').onclick = start;
$('pause').onclick = togglePause;
$('reset').onclick = reset;
$('again').onclick = () => { reset(); start(); };
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); running || t > 0 ? togglePause() : start(); } });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// Share state with the local server so the MAVLink bridge can mirror it (best effort).
setInterval(async () => {
  try {
    const body = JSON.stringify({ ...state, paused: !running && t > 0 && !finished });
    const r = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    relayOk = r.ok;
  } catch { relayOk = false; }
}, 250);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (running) {
    t += dt;
    if (t >= timeline.total) { t = timeline.total; running = false; finished = true; setButtons(); }
  }
  state = stateAt(mission, timeline, t);
  render3D(state, dt);
  renderHud(state);
  placeCamera();
  renderer.render(scene, camera);
}
window.__simReady = true;
setButtons();
requestAnimationFrame(frame);
