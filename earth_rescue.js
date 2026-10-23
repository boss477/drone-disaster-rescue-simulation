/* Cesium rescue workflow. Map context can be real; every mission actor/action is simulated. */
const $ = id => document.getElementById(id);
const EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=500';
const WEATHER = 'https://api.open-meteo.com/v1/forecast';
const hazardStyle = {
  fire: { color: '#ff6048', title: 'Wildfires' },
  flood: { color: '#36a9ff', title: 'Floods' },
  storm: { color: '#c18bff', title: 'Severe storms' },
};
const categoryKinds = { Wildfires: 'fire', Floods: 'flood', 'Severe Storms': 'storm' };
const viewPresets = {
  vancouver: {
    name: 'Vancouver city and Coast Mountains', lat: 49.2827, lon: -123.1207,
    camera: { lat: 49.235, lon: -123.185, height: 3200, heading: 0.72, pitch: -0.3 },
  },
  dubai: {
    name: 'Downtown Dubai skyline', lat: 25.1972, lon: 55.2744,
    camera: { lat: 25.175, lon: 55.245, height: 1700, heading: 0.8, pitch: -0.28 },
  },
  everest: {
    name: 'Mount Everest terrain', lat: 27.9881, lon: 86.9250,
    camera: { lat: 27.91, lon: 86.82, height: 9200, heading: 0.72, pitch: -0.18 },
  },
};

let viewer = null;
let selected = null;
let selectedMarker = null;
let targetMarker = null;
let hazards = [];
let hazardEntities = [];
let routeEntities = [];
let drone = null;
let packages = [];
let mission = null;
let running = false;
let paused = false;
let lastFrame = 0;
let lastStateSent = 0;
let missionClock = 0;
let evidence = [];
let targetConfirmed = false;
let autopilotConnected = false;
let autopilotTelemetry = null;
let replayGeneration = 0;

function followsSITL() {
  return $('flightSource').value === 'sitl';
}

function refreshStartAvailability() {
  $('start').disabled = !selected || !targetConfirmed || running || (followsSITL() && !autopilotConnected);
}

async function refreshAutopilot() {
  try {
    const response = await fetch('/api/autopilot', { cache: 'no-store' });
    const payload = await response.json();
    autopilotConnected = Boolean(payload.connected && payload.state
      && Number.isFinite(payload.state.latitude_deg) && Number.isFinite(payload.state.longitude_deg));
    autopilotTelemetry = autopilotConnected ? payload.state : null;
  } catch (_) {
    autopilotConnected = false;
    autopilotTelemetry = null;
  }
  if (followsSITL()) {
    const state = autopilotTelemetry;
    $('sitlStatus').textContent = state
      ? `SITL LIVE · ${state.flight_mode || 'UNKNOWN'} · ${state.armed ? 'ARMED' : 'DISARMED'} · GPS fix ${state.gps_fix_type ?? '—'}`
      : 'Waiting for the receive-only SITL telemetry adapter…';
  } else {
    $('sitlStatus').textContent = autopilotConnected ? 'SITL feed available; scripted path selected.' : 'SITL feed not selected.';
  }
  refreshStartAvailability();
}

function autopilotPosition() {
  if (!followsSITL() || !autopilotTelemetry) return null;
  return {
    lat: autopilotTelemetry.latitude_deg,
    lon: autopilotTelemetry.longitude_deg,
    alt: Math.max(0, autopilotTelemetry.relative_altitude_m ?? 0),
  };
}

function cesiumReady() {
  if (!window.Cesium) {
    $('earthStatus').textContent = 'CesiumJS did not load. Check the internet connection.';
    return false;
  }
  return true;
}

function osmLayer() {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors',
    maximumLevel: 19,
  });
  return new Cesium.ImageryLayer(provider);
}

async function initGlobe(token = '') {
  if (!cesiumReady()) return;
  const previous = selected;
  if (viewer && !viewer.isDestroyed()) viewer.destroy();
  viewer = null;
  try {
    if (token) Cesium.Ion.defaultAccessToken = token;
    viewer = new Cesium.Viewer('globe', {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: osmLayer(),
      terrain: token ? Cesium.Terrain.fromWorldTerrain() : undefined,
      creditContainer: $('cesiumCredit'),
      requestRenderMode: false,
    });
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#07111c');
    viewer.scene.skyAtmosphere.show = true;
    $('earthStatus').textContent = token
      ? 'OpenStreetMap loaded. Loading Cesium terrain and 3D buildings…'
      : 'OpenStreetMap globe ready. Add a Cesium ion token later for terrain and 3D buildings.';
    if (token) {
      try {
        const buildings = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(buildings);
        $('earthStatus').textContent = 'Cesium terrain and OpenStreetMap 3D buildings ready.';
      } catch (error) {
        $('earthStatus').textContent = `Base map ready; 3D content failed: ${error.message || error}`;
      }
    }
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 15_000_000, 11_000_000) });
    viewer.screenSpaceEventHandler.setInputAction(event => {
      const ray = viewer.camera.getPickRay(event.position);
      const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
      const cartographic = hit ? Cesium.Cartographic.fromCartesian(hit) : null;
      if (cartographic) {
        setLocation(
          Cesium.Math.toDegrees(cartographic.latitude),
          Cesium.Math.toDegrees(cartographic.longitude),
          'Operator map selection',
          'operator',
          '±25 m',
        );
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    if (previous) setLocation(previous.lat, previous.lon, previous.name, previous.source, previous.uncertainty);
  } catch (error) {
    $('earthStatus').textContent = `Map could not start: ${error.message || error}`;
  }
}

function appendEventRow(item) {
  const row = document.createElement('li');
  const time = document.createElement('time');
  const label = document.createElement('b');
  const message = document.createElement('span');
  time.textContent = new Date(item.timestamp).toLocaleTimeString();
  label.textContent = item.type;
  message.textContent = item.detail;
  row.append(time, label, message);
  $('missionLog').append(row);
  $('missionLog').scrollTop = $('missionLog').scrollHeight;
  $('downloadLog').disabled = false;
}

function logEvent(type, detail) {
  const item = { timestamp: new Date().toISOString(), mission_seconds: Number(missionClock.toFixed(1)), type, detail };
  evidence.push(item);
  appendEventRow(item);
}

function kindFor(event) {
  for (const category of event.categories || []) if (categoryKinds[category.title]) return categoryKinds[category.title];
  return null;
}

function lastGeo(event) { return (event.geometry || []).at(-1) || null; }

function centroid(geometry) {
  if (!geometry?.coordinates) return null;
  if (geometry.type === 'Point') return { lat: geometry.coordinates[1], lon: geometry.coordinates[0] };
  const points = [];
  const visit = value => typeof value[0] === 'number' ? points.push(value) : value.forEach(visit);
  visit(geometry.coordinates);
  return points.length ? {
    lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
    lon: points.reduce((sum, point) => sum + point[0], 0) / points.length,
  } : null;
}

function drawHazards() {
  if (!viewer) return;
  hazardEntities.forEach(entity => viewer.entities.remove(entity));
  hazardEntities = [];
  const enabled = { fire: $('showFire').checked, flood: $('showFlood').checked, storm: $('showStorm').checked };
  hazards.forEach(event => {
    const kind = kindFor(event);
    const geometry = lastGeo(event);
    if (!kind || !enabled[kind] || !geometry) return;
    const position = centroid(geometry);
    if (!position) return;
    hazardEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(position.lon, position.lat, 30),
      point: {
        pixelSize: kind === 'fire' ? 12 : 10,
        color: Cesium.Color.fromCssColorString(hazardStyle[kind].color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: event.title,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -17),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  });
}

function renderEvents() {
  const list = $('eventList');
  list.textContent = '';
  const enabled = { fire: $('showFire').checked, flood: $('showFlood').checked, storm: $('showStorm').checked };
  hazards.filter(event => enabled[kindFor(event)]).slice(0, 70).forEach(event => {
    const kind = kindFor(event);
    const geometry = lastGeo(event);
    const center = centroid(geometry);
    if (!center) return;
    const button = document.createElement('button');
    button.className = 'event';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = hazardStyle[kind].color;
    const text = document.createElement('span');
    text.textContent = event.title;
    const meta = document.createElement('small');
    meta.textContent = `${hazardStyle[kind].title} · ${geometry.date ? new Date(geometry.date).toLocaleString() : 'date unavailable'}`;
    text.append(meta);
    button.append(dot, text);
    button.onclick = () => setLocation(center.lat, center.lon, event.title, 'NASA EONET', 'event centroid; boundary unknown');
    list.append(button);
  });
  drawHazards();
}

async function refreshEvents() {
  $('feedStatus').textContent = 'Loading active worldwide events…';
  try {
    const response = await fetch(EONET, { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    hazards = (data.events || []).filter(event => kindFor(event) && lastGeo(event));
    $('feedStatus').textContent = `${hazards.length} active event records · refreshed ${new Date().toLocaleTimeString()}`;
    renderEvents();
  } catch {
    $('feedStatus').textContent = 'Event feed unavailable; the mission demo still works from a map selection.';
  }
}

async function loadWeather(lat, lon) {
  $('weather').textContent = 'Loading current weather…';
  const query = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,precipitation,rain,showers,wind_speed_10m,wind_direction_10m,weather_code',
    timezone: 'auto',
  });
  try {
    const response = await fetch(`${WEATHER}?${query}`);
    if (!response.ok) throw Error();
    const data = await response.json();
    const current = data.current;
    $('weather').textContent = `${current.temperature_2m}°C · rain ${Number(current.rain || 0) + Number(current.showers || 0)} mm · wind ${current.wind_speed_10m} km/h · observed ${current.time} ${data.timezone_abbreviation || ''}`;
  } catch {
    $('weather').textContent = 'Current weather unavailable.';
  }
}

function targetFor(base = selected) {
  const radius = Math.max(100, Math.min(2000, Number($('routeRadius').value) || 500));
  return { lat: base.lat + radius / 111320, lon: base.lon };
}

function markerLabel(text, color) {
  return {
    text,
    font: 'bold 11px sans-serif',
    fillColor: color,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -18),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

function setLocation(lat, lon, name, source, uncertainty) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || running) return;
  selected = { lat, lon, name, source, uncertainty, timestamp: new Date().toISOString() };
  targetConfirmed = false;
  $('selection').textContent = `${name} · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $('provenance').textContent = `SOURCE: ${source} · TIME: ${new Date(selected.timestamp).toLocaleString()} · UNCERTAINTY: ${uncertainty}`;
  $('confirmTarget').disabled = false;
  $('rejectTarget').disabled = false;
  $('start').disabled = true;
  $('candidate').classList.remove('confirmed', 'rejected');
  if (viewer) {
    if (selectedMarker) viewer.entities.remove(selectedMarker);
    if (targetMarker) viewer.entities.remove(targetMarker);
    selectedMarker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 30),
      point: { pixelSize: 12, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: markerLabel('SIMULATED BASE', Cesium.Color.CYAN),
    });
    const target = targetFor();
    targetMarker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, 30),
      point: { pixelSize: 11, color: Cesium.Color.ORANGE, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: markerLabel('AI CANDIDATE · UNCONFIRMED', Cesium.Color.ORANGE),
    });
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 3500), duration: 2.2 });
  }
  loadWeather(lat, lon);
  logEvent('AREA_SELECTED', `${source}: ${name}; ${lat.toFixed(5)}, ${lon.toFixed(5)}; uncertainty ${uncertainty}`);
}

function flyToPreset(key) {
  const preset = viewPresets[key];
  if (!preset || !viewer || running) return;
  setLocation(preset.lat, preset.lon, preset.name, '3D view preset', 'visualization only');
  const camera = preset.camera;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, camera.height),
    orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
    duration: 3.2,
  });
  $('earthStatus').textContent = `${preset.name}: angled 3D view. Buildings and terrain detail depend on Cesium coverage.`;
}

function clearMissionEntities() {
  if (!viewer) return;
  if (drone) viewer.entities.remove(drone);
  routeEntities.forEach(entity => viewer.entities.remove(entity));
  packages.forEach(entity => viewer.entities.remove(entity));
  drone = null;
  routeEntities = [];
  packages = [];
}

function renderInventory(total, delivered) {
  $('inventory').textContent = '';
  for (let index = 0; index < total; index += 1) {
    const item = document.createElement('span');
    item.className = `pack${index < delivered ? ' released' : ''}`;
    item.title = index < delivered ? 'Release confirmed (simulated)' : 'Onboard (simulated)';
    $('inventory').append(item);
  }
}

function setMissionPhase(phase, detail) {
  mission.phase = phase;
  mission.phaseStart = missionClock;
  $('phase').textContent = phase.replaceAll('_', ' ').toUpperCase();
  if (detail) $('missionStatus').textContent = detail;
  logEvent(phase.toUpperCase(), detail || phase);
}

function buildMission() {
  if (!viewer || !selected || !targetConfirmed || (followsSITL() && !autopilotConnected)) return;
  replayGeneration += 1;
  clearMissionEntities();
  const target = targetFor();
  const packageCount = Math.max(1, Math.min(6, Number($('packageCount').value) || 1));
  mission = {
    target,
    packageCount,
    delivered: 0,
    operatorApproved: false,
    outcome: 'active',
    phase: 'loading',
    phaseStart: 0,
    returnFrom: target,
    scenario: $('scenario').value,
    flightSource: $('flightSource').value,
    samples: [],
    lastSampleAt: -1,
  };
  routeEntities.push(viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        selected.lon, selected.lat, 120,
        target.lon, target.lat, 120,
        selected.lon, selected.lat, 120,
      ]),
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.CYAN, dashLength: 12 }),
    },
  }));
  drone = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(selected.lon, selected.lat, 12),
    model: { uri: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumDrone/CesiumDrone.glb', minimumPixelSize: 64, maximumScale: 120 },
    point: { pixelSize: 10, color: Cesium.Color.CYAN },
    label: markerLabel('SIMULATED DRONE', Cesium.Color.CYAN),
  });
  packages = Array.from({ length: packageCount }, (_, index) => viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(selected.lon + index * 0.00001, selected.lat, 8),
    box: { dimensions: new Cesium.Cartesian3(2, 2, 2), material: Cesium.Color.fromCssColorString('#ffc45c') },
  }));
  missionClock = 0;
  lastFrame = performance.now();
  running = true;
  paused = false;
  $('start').disabled = true;
  $('pause').disabled = false;
  $('pause').textContent = 'Pause';
  $('abortMission').disabled = false;
  $('approveRelease').disabled = true;
  $('approvalText').textContent = 'Waiting for arrival at the confirmed drop zone.';
  $('phase').textContent = 'LOADING PACKAGES';
  $('missionStatus').textContent = `Loading ${packageCount} simulated package(s).`;
  renderInventory(packageCount, 0);
  logEvent('MISSION_STARTED', `${mission.scenario} scenario; ${packageCount} simulated package(s); position source ${mission.flightSource}`);
  requestAnimationFrame(animateMission);
}

function interpolate(from, to, fraction) {
  return { lat: from.lat + (to.lat - from.lat) * fraction, lon: from.lon + (to.lon - from.lon) * fraction };
}

function groundDistanceMeters(from, to) {
  const meanLatitude = (from.lat + to.lat) * Math.PI / 360;
  const dx = (from.lon - to.lon) * 111320 * Math.cos(meanLatitude);
  const dz = (from.lat - to.lat) * 111320;
  return Math.hypot(dx, dz);
}

function finishMission(outcome) {
  running = false;
  mission.outcome = outcome;
  mission.phase = 'complete';
  $('pause').disabled = true;
  $('abortMission').disabled = true;
  $('approveRelease').disabled = true;
  $('start').disabled = false;
  const message = outcome === 'delivered'
    ? 'Mission complete: simulated package release was operator-approved and confirmed.'
    : 'Mission complete: delivery was aborted and no package was released.';
  $('phase').textContent = outcome === 'delivered' ? 'MISSION COMPLETE' : 'ABORTED · RETURNED TO BASE';
  $('missionStatus').textContent = message;
  logEvent('MISSION_FINISHED', message);
}

function abortMission(reason) {
  if (!running || !mission || ['returning', 'aborted_return'].includes(mission.phase)) return;
  mission.outcome = 'aborted';
  mission.returnFrom = mission.current || selected;
  setMissionPhase('aborted_return', reason || 'Operator aborted delivery; package retained.');
  $('approveRelease').disabled = true;
  $('abortMission').disabled = true;
  $('approvalText').textContent = 'Release blocked. Returning to base.';
}

function missionPosition() {
  const elapsed = missionClock - mission.phaseStart;
  if (mission.phase === 'loading') {
    if (elapsed >= 3) setMissionPhase('outbound', 'Flying to the confirmed simulated drop zone.');
    return { ...selected, alt: 10 };
  }
  if (mission.phase === 'outbound') {
    const livePosition = autopilotPosition();
    if (followsSITL()) {
      if (livePosition && groundDistanceMeters(livePosition, mission.target) <= 30) {
        setMissionPhase('awaiting_approval', 'SITL vehicle is within 30 m of the drop zone. Operator decision required.');
        if (mission.scenario === 'success') {
          $('approveRelease').disabled = false;
          $('approvalText').textContent = 'Target confirmed. Review the zone, then approve or abort.';
        } else {
          $('approvalText').textContent = 'Unsafe drop-zone condition injected. Abort is required.';
        }
      }
      return { ...selected, alt: 10 };
    }
    const fraction = Math.min(elapsed / 10, 1);
    if (fraction >= 1) {
      setMissionPhase('awaiting_approval', 'Holding over the drop zone. Operator decision required.');
      if (mission.scenario === 'success') {
        $('approveRelease').disabled = false;
        $('approvalText').textContent = 'Target confirmed. Review the zone, then approve or abort.';
      } else {
        $('approvalText').textContent = 'Unsafe drop-zone condition injected. Abort is required.';
      }
    }
    return { ...interpolate(selected, mission.target, fraction), alt: 120 };
  }
  if (mission.phase === 'awaiting_approval') return { ...mission.target, alt: 35 };
  if (mission.phase === 'releasing') {
    const fraction = Math.min(elapsed / 3, 1);
    if (fraction >= 1) {
      mission.delivered = 1;
      mission.returnFrom = mission.target;
      setMissionPhase('returning', 'Simulated release confirmed. Returning to base.');
    }
    return { ...mission.target, alt: 35 };
  }
  if (mission.phase === 'returning' || mission.phase === 'aborted_return') {
    const livePosition = autopilotPosition();
    if (followsSITL()) {
      if (livePosition && groundDistanceMeters(livePosition, selected) <= 30 && livePosition.alt <= 15) {
        finishMission(mission.outcome === 'aborted' ? 'aborted' : 'delivered');
      }
      return { ...selected, alt: 10 };
    }
    const fraction = Math.min(elapsed / 10, 1);
    const position = interpolate(mission.returnFrom || mission.target, selected, fraction);
    if (fraction >= 1) finishMission(mission.outcome === 'aborted' ? 'aborted' : 'delivered');
    return { ...position, alt: fraction >= 1 ? 10 : 120 };
  }
  return { ...selected, alt: 10 };
}

function postState(now, position) {
  if (now - lastStateSent < 250 || !mission) return;
  lastStateSent = now;
  const dx = (position.lon - selected.lon) * 111320 * Math.cos(selected.lat * Math.PI / 180);
  const dz = -(position.lat - selected.lat) * 111320;
  const elapsed = missionClock - mission.phaseStart;
  let progress = 0;
  if (mission.phase === 'loading') progress = Math.min(10, elapsed / 3 * 10);
  else if (mission.phase === 'outbound') progress = 10 + Math.min(50, elapsed / 10 * 50);
  else if (mission.phase === 'awaiting_approval') progress = 60;
  else if (mission.phase === 'releasing') progress = 60 + Math.min(10, elapsed / 3 * 10);
  else if (mission.phase === 'returning' || mission.phase === 'aborted_return') progress = 70 + Math.min(30, elapsed / 10 * 30);
  else if (mission.phase === 'complete') progress = 100;
  const telemetryPhase = mission.phase === 'releasing' ? 'unload' : mission.phase;
  const sequence = mission.phase === 'loading' ? 0 : mission.phase === 'outbound' ? 1 : mission.phase === 'awaiting_approval' ? 2 : mission.phase === 'releasing' ? 3 : mission.phase === 'complete' ? 5 : 4;
  const state = {
    source: followsSITL() ? 'sitl-mavlink-with-operator-workflow' : 'earth-simulation',
    phase: telemetryPhase,
    t: missionClock,
    total_seconds: 26,
    progress_percent: progress,
    position: { x: dx, y: position.alt, z: dz },
    velocity: { x: 0, y: 0, z: 0 },
    heading_deg: followsSITL() ? (autopilotTelemetry?.heading_deg ?? 0) : 0,
    battery_percent: followsSITL() && autopilotTelemetry?.battery_percent != null
      ? autopilotTelemetry.battery_percent : Math.max(0, 100 - missionClock * 0.35),
    packages_loaded: mission.packageCount,
    packages_onboard: mission.packageCount - mission.delivered,
    packages_delivered: mission.delivered,
    people_detected: 1,
    site_index: 0,
    site_name: 'Operator-confirmed simulated drop zone',
    mission_seq: sequence,
    mission_total: 6,
    target_confirmed: targetConfirmed,
    operator_release_approved: mission.operatorApproved,
    outcome: mission.outcome,
    complete: !running,
    paused,
    simulated: true,
    map_origin: { latitude_deg: selected.lat, longitude_deg: selected.lon, name: selected.name },
  };
  fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }).catch(() => {});
}

function animateMission(now) {
  if (!running || !mission || !drone) return;
  if (!paused) missionClock += (now - lastFrame) / 1000;
  lastFrame = now;
  const scriptedPosition = missionPosition();
  const position = autopilotPosition() || scriptedPosition;
  mission.current = position;
  drone.position = Cesium.Cartesian3.fromDegrees(position.lon, position.lat, position.alt);
  if (followsSITL() && autopilotTelemetry?.heading_deg != null) {
    const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(autopilotTelemetry.heading_deg), 0, 0);
    drone.orientation = Cesium.Transforms.headingPitchRollQuaternion(drone.position.getValue(), hpr);
  }
  packages.forEach((item, index) => {
    if (index < mission.delivered) {
      item.position = Cesium.Cartesian3.fromDegrees(mission.target.lon + 0.000025 * index, mission.target.lat, 3);
      item.box.material = Cesium.Color.fromCssColorString('#65dec0');
    } else if (mission.phase === 'releasing' && index === 0) {
      const fraction = Math.min((missionClock - mission.phaseStart) / 3, 1);
      item.position = Cesium.Cartesian3.fromDegrees(mission.target.lon, mission.target.lat, 30 - 27 * fraction);
    } else {
      item.position = Cesium.Cartesian3.fromDegrees(position.lon, position.lat, Math.max(4, position.alt - 5 - index * 0.3));
    }
  });
  $('delivered').textContent = mission.delivered;
  const battery = followsSITL() && autopilotTelemetry?.battery_percent != null
    ? autopilotTelemetry.battery_percent : Math.max(0, 100 - missionClock * 0.35);
  $('battery').textContent = `${Number(battery).toFixed(0)}%`;
  $('batteryLabel').textContent = followsSITL() ? 'SITL battery' : 'simulated battery';
  if (missionClock - mission.lastSampleAt >= 0.5 || !running) {
    mission.lastSampleAt = missionClock;
    mission.samples.push({
      t: Number(missionClock.toFixed(2)),
      lat: Number(position.lat.toFixed(7)),
      lon: Number(position.lon.toFixed(7)),
      alt: Number(position.alt.toFixed(2)),
      heading_deg: followsSITL() ? (autopilotTelemetry?.heading_deg ?? 0) : 0,
      battery_percent: Number(Number(battery).toFixed(1)),
      phase: mission.phase,
      packages_delivered: mission.delivered,
    });
  }
  renderInventory(mission.packageCount, mission.delivered);
  postState(now, position);
  if (running) requestAnimationFrame(animateMission);
}

function resetMission() {
  replayGeneration += 1;
  running = false;
  paused = false;
  missionClock = 0;
  mission = null;
  clearMissionEntities();
  $('phase').textContent = 'DRONE AT BASE';
  $('delivered').textContent = '0';
  $('battery').textContent = '100%';
  $('missionStatus').textContent = 'Mission reset. Select and confirm a candidate to run again.';
  $('pause').disabled = true;
  $('pause').textContent = 'Pause';
  $('abortMission').disabled = true;
  $('approveRelease').disabled = true;
  $('approvalText').textContent = 'Available only after arrival and target confirmation.';
  refreshStartAvailability();
  renderInventory(0, 0);
  logEvent('MISSION_RESET', 'Operator reset the simulation.');
}

$('loadCesium').onclick = () => {
  const token = $('cesiumToken').value.trim();
  if (!token) {
    $('earthStatus').textContent = 'Paste a Cesium ion token to enable hosted terrain and buildings.';
    return;
  }
  sessionStorage.setItem('rescueCesiumToken', token);
  initGlobe(token);
};
document.querySelectorAll('[data-preset]').forEach(button => {
  button.onclick = () => flyToPreset(button.dataset.preset);
});
['showFire', 'showFlood', 'showStorm'].forEach(id => $(id).onchange = renderEvents);
$('refresh').onclick = refreshEvents;
$('confirmTarget').onclick = () => {
  if (!selected || running) return;
  targetConfirmed = true;
  $('candidate').classList.add('confirmed');
  $('candidate').classList.remove('rejected');
  refreshStartAvailability();
  if (targetMarker) targetMarker.label.text = 'OPERATOR-CONFIRMED · SIMULATED';
  logEvent('TARGET_CONFIRMED', 'Operator confirmed the simulated AI candidate and manually placed drop zone.');
};
$('rejectTarget').onclick = () => {
  if (!selected || running) return;
  targetConfirmed = false;
  $('candidate').classList.add('rejected');
  $('candidate').classList.remove('confirmed');
  $('start').disabled = true;
  logEvent('TARGET_REJECTED', 'Operator rejected the simulated AI candidate; launch blocked.');
};
$('start').onclick = buildMission;
$('flightSource').onchange = () => {
  $('batteryLabel').textContent = followsSITL() ? 'SITL battery' : 'simulated battery';
  refreshAutopilot();
  if (followsSITL() && autopilotTelemetry && !running) {
    setLocation(
      autopilotTelemetry.latitude_deg,
      autopilotTelemetry.longitude_deg,
      'SITL vehicle home',
      'receive-only MAVLink telemetry',
      'reported GPS position',
    );
  }
  logEvent('POSITION_SOURCE_SELECTED', followsSITL() ? 'SITL telemetry selected; launch waits for live data.' : 'Scripted demonstration path selected.');
};
$('pause').onclick = () => {
  if (!running) return;
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  if (!paused) lastFrame = performance.now();
  logEvent(paused ? 'MISSION_PAUSED' : 'MISSION_RESUMED', `Operator ${paused ? 'paused' : 'resumed'} the simulation.`);
};
$('approveRelease').onclick = () => {
  if (!mission || mission.phase !== 'awaiting_approval' || mission.scenario !== 'success') return;
  mission.operatorApproved = true;
  $('approveRelease').disabled = true;
  $('abortMission').disabled = true;
  $('approvalText').textContent = 'Operator approval recorded. Simulating payload release.';
  setMissionPhase('releasing', 'Operator approved release; virtual latch command acknowledged.');
};
$('abortMission').onclick = () => abortMission('Operator aborted delivery; package retained and return initiated.');
$('reset').onclick = resetMission;
$('downloadLog').onclick = () => {
  const record = { exported_at: new Date().toISOString(), simulation_only: true, selected_area: selected, mission, events: evidence };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `rescue-mission-${new Date().toISOString().replaceAll(':', '-')}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
};

function isReplayRecord(record) {
  const samples = record?.mission?.samples;
  return record?.simulation_only === true && Array.isArray(samples) && samples.length >= 2
    && samples.every(sample => Number.isFinite(sample.t) && Number.isFinite(sample.lat)
      && Number.isFinite(sample.lon) && Number.isFinite(sample.alt));
}

function startReplay(record) {
  if (!viewer || !isReplayRecord(record)) throw new Error('This is not a valid simulated mission log with position samples.');
  replayGeneration += 1;
  const generation = replayGeneration;
  running = false;
  paused = false;
  clearMissionEntities();
  const samples = record.mission.samples;
  mission = record.mission;
  const positions = samples.flatMap(sample => [sample.lon, sample.lat, sample.alt]);
  routeEntities.push(viewer.entities.add({
    polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(positions), width: 4, material: Cesium.Color.fromCssColorString('#ffc45c') },
  }));
  drone = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(samples[0].lon, samples[0].lat, samples[0].alt),
    model: { uri: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumDrone/CesiumDrone.glb', minimumPixelSize: 64, maximumScale: 120 },
    point: { pixelSize: 10, color: Cesium.Color.fromCssColorString('#ffc45c') },
    label: markerLabel('MISSION REPLAY · SIMULATED', Cesium.Color.fromCssColorString('#ffc45c')),
  });
  evidence = Array.isArray(record.events) ? record.events : [];
  $('missionLog').textContent = '';
  evidence.forEach(appendEventRow);
  $('phase').textContent = 'REPLAY';
  $('missionStatus').textContent = 'Replaying recorded simulated telemetry at 2× speed. No commands or telemetry are being sent.';
  $('pause').disabled = true;
  $('abortMission').disabled = true;
  $('approveRelease').disabled = true;
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(samples[0].lon, samples[0].lat, Math.max(800, samples[0].alt + 500)) });
  const started = performance.now();
  const duration = samples.at(-1).t;
  function replayFrame(now) {
    if (generation !== replayGeneration) return;
    const replayTime = Math.min((now - started) / 500, duration);
    let index = samples.findIndex(sample => sample.t >= replayTime);
    if (index < 0) index = samples.length - 1;
    const sample = samples[index];
    drone.position = Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.alt);
    const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(sample.heading_deg || 0), 0, 0);
    drone.orientation = Cesium.Transforms.headingPitchRollQuaternion(drone.position.getValue(), hpr);
    $('phase').textContent = `REPLAY · ${(sample.phase || 'mission').replaceAll('_', ' ').toUpperCase()}`;
    $('battery').textContent = `${Number(sample.battery_percent ?? 0).toFixed(0)}%`;
    $('batteryLabel').textContent = 'recorded battery';
    $('delivered').textContent = sample.packages_delivered ?? 0;
    if (replayTime < duration) requestAnimationFrame(replayFrame);
    else $('missionStatus').textContent = 'Replay complete. Load another log or reset to prepare a new mission.';
  }
  requestAnimationFrame(replayFrame);
}

$('replayFile').onchange = async event => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    startReplay(JSON.parse(await file.text()));
  } catch (error) {
    $('missionStatus').textContent = `Replay rejected: ${error.message || error}`;
  } finally {
    event.target.value = '';
  }
};

const rememberedToken = sessionStorage.getItem('rescueCesiumToken') || '';
$('cesiumToken').value = rememberedToken;
initGlobe(rememberedToken);
refreshEvents();
setInterval(refreshEvents, 10 * 60 * 1000);
refreshAutopilot();
setInterval(refreshAutopilot, 400);

const params = new URLSearchParams(location.search);
const queryLat = Number(params.get('lat'));
const queryLon = Number(params.get('lon'));
if (Number.isFinite(queryLat) && Number.isFinite(queryLon)) {
  const waitForViewer = setInterval(() => {
    if (!viewer) return;
    clearInterval(waitForViewer);
    setLocation(queryLat, queryLon, params.get('name') || 'Shared mission area', 'live operations map', '±100 m');
  }, 100);
}
