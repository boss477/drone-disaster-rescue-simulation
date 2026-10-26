/* Cesium rescue workflow. Map context can be real; every mission actor/action is simulated. */
const $ = id => document.getElementById(id);
const EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open';
const USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const WEATHER = 'https://api.open-meteo.com/v1/forecast';
// Public demo token, intentionally committed so a fresh clone can load hosted 3D.
const DEFAULT_CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Iml4cXdOSE5GdGlIcTFIc0oiLCJqdGkiOiI0NDdiZjExMy0wYTU1LTQwMTYtODA3YS0wOTQ5MjQ1ZDc3MzMiLCJpZCI6NDc1NzQxLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODgwMzk5NzJ9.RvaS4VEJiK--nGKk8ThRcwXbNNUtelpLukkvHnjK2rc';
const hazardStyle = {
  fire: { color: '#ff6048', title: 'Wildfires' },
  flood: { color: '#36a9ff', title: 'Floods' },
  storm: { color: '#c18bff', title: 'Severe storms' },
  quake: { color: '#ffca60', title: 'Earthquakes' },
  volcano: { color: '#ff8d48', title: 'Volcanoes' },
  landslide: { color: '#c79b70', title: 'Landslides' },
  other: { color: '#9bd8b5', title: 'Other natural events' },
};
const categoryKinds = { Wildfires: 'fire', Floods: 'flood', 'Severe Storms': 'storm', Earthquakes: 'quake', Volcanoes: 'volcano', Landslides: 'landslide' };
const incidentChecks = {fire:'showFire',flood:'showFlood',storm:'showStorm',quake:'showQuake',volcano:'showVolcano',landslide:'showLandslide',other:'showOther'};
const incidentFeeds = {eonet:{events:[],time:null,error:false},usgs:{events:[],time:null,error:false}};
let refreshingIncidents = false;
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
let recoveringRender = false;
let safeMapActive = false;
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
let sensorTelemetryQueue = [];
let odmImageryLayers = [];
let odmPrimitives = [];
let baseTerrainProvider = null;
let preparingMission = false;
let missionPreparation = 0;

const sensorControlIds = ['cameraNoise', 'rainEffect', 'fogEffect', 'weakGps', 'windDrift', 'telemetryDelay', 'falseDetections'];

function enabledSensorEffects() {
  return sensorControlIds.filter(id => $(id).checked);
}

function setSensorControlsDisabled(disabled) {
  sensorControlIds.forEach(id => { $(id).disabled = disabled; });
  $('toggleSensors').disabled = disabled;
}

function syncSensorEffects() {
  const overlay = $('sensorEffects');
  overlay.classList.toggle('noise', $('cameraNoise').checked);
  overlay.classList.toggle('rain', $('rainEffect').checked);
  overlay.classList.toggle('fog', $('fogEffect').checked);
  if (viewer) {
    viewer.scene.fog.enabled = $('fogEffect').checked;
    if ($('fogEffect').checked) viewer.scene.fog.density = 0.00055;
  }
  if (!$('telemetryDelay').checked) sensorTelemetryQueue = [];
  const active = enabledSensorEffects();
  $('sensorStatus').textContent = active.length
    ? `SIMULATED: ${active.map(id => $(id).parentElement.textContent.trim()).join(' · ')}`
    : 'Sensors nominal. Effects are simulated.';
}

function offsetMetres(position, east, north) {
  const latitudeScale = 111320;
  const longitudeScale = Math.max(1, latitudeScale * Math.cos(position.lat * Math.PI / 180));
  return { ...position, lat: position.lat + north / latitudeScale, lon: position.lon + east / longitudeScale };
}

function applyWindDrift(position) {
  if (!$('windDrift').checked || followsSITL()) return { ...position };
  return offsetMetres(position, 7 + 4 * Math.sin(missionClock * 0.7), 3 * Math.cos(missionClock * 0.45));
}

function sensorPosition(position) {
  let sensed = { ...position };
  if ($('weakGps').checked) {
    sensed = offsetMetres(sensed, 10 * Math.sin(missionClock * 2.3), 8 * Math.cos(missionClock * 1.7));
  }
  if (!$('telemetryDelay').checked) return sensed;
  sensorTelemetryQueue.push({ time: missionClock, position: sensed });
  const cutoff = missionClock - 2;
  let delayed = sensorTelemetryQueue[0].position;
  while (sensorTelemetryQueue.length > 1 && sensorTelemetryQueue[1].time <= cutoff) {
    delayed = sensorTelemetryQueue.shift().position;
  }
  return delayed;
}

function followsSITL() {
  return $('flightSource').value === 'sitl';
}

function refreshStartAvailability() {
  $('start').disabled = !selected || !targetConfirmed || running || preparingMission || (followsSITL() && !autopilotConnected);
  $('runDemo').disabled = !viewer || running || preparingMission;
  const world=window.RescueWorld?.getState();
  const incident3DReady=$('worldRenderer').value!=='nasa' || (world?.ready && (!world.detailed || (world.groundKnown && world.terrainVisible>0)));
  $('rescueIncident').disabled = !viewer || !selected?.incident || running || preparingMission || !incident3DReady;
  if (selected?.incident && !running && !preparingMission && $('incidentMissionStatus').dataset.loading==='true' && incident3DReady) {
    $('incidentMissionStatus').dataset.loading='false';
    $('incidentMissionStatus').textContent='3D area ready. Send the aid drone to simulate delivery to three recipients here.';
  }
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

function removeOdmLayers(showStatus = true) {
  if (viewer) {
    odmImageryLayers.forEach(layer => {
      try { viewer.imageryLayers.remove(layer, true); } catch (_) { /* viewer may have been rebuilt */ }
    });
  }
  if (viewer) {
    odmPrimitives.forEach(item => {
      try { viewer.scene.primitives.remove(item); } catch (_) { /* partial load */ }
    });
    if (baseTerrainProvider) viewer.terrainProvider = baseTerrainProvider;
  }
  odmImageryLayers = [];
  odmPrimitives = [];
  $('clearOdm').disabled = true;
  if (showStatus) $('odmStatus').textContent = 'ODM layers cleared.';
}

function odmAssetUrl(path, manifestUrl) {
  return new URL(path, new URL(manifestUrl, location.href)).toString();
}

async function loadOdmLayers() {
  if ($('worldRenderer').value === 'nasa' && window.RescueWorld) {
    return window.RescueWorld.loadODM($('odmManifest').value.trim());
  }
  if (!viewer) return;
  const manifestUrl = $('odmManifest').value.trim();
  if (!manifestUrl) {
    $('odmStatus').textContent = 'Enter an ODM manifest URL.';
    return;
  }
  removeOdmLayers(false);
  $('odmStatus').textContent = 'Loading ODM manifest…';
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    const manifest = await response.json();
    const loaded = [];
    if ($('odmOrtho').checked && manifest.orthophoto?.url) {
      const options = {
        url: odmAssetUrl(manifest.orthophoto.url, manifestUrl),
        minimumLevel: manifest.orthophoto.minimumLevel ?? 0,
        maximumLevel: manifest.orthophoto.maximumLevel ?? 22,
        credit: manifest.credit || 'OpenDroneMap survey',
      };
      if (Array.isArray(manifest.orthophoto.rectangle) && manifest.orthophoto.rectangle.length === 4) {
        options.rectangle = Cesium.Rectangle.fromDegrees(...manifest.orthophoto.rectangle);
      }
      const layer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider(options));
      layer.alpha = manifest.orthophoto.alpha ?? 0.9;
      odmImageryLayers.push(layer);
      loaded.push('orthophoto');
    }
    if ($('odmTerrain').checked && manifest.elevationOverlay?.url) {
      const options = {
        url: odmAssetUrl(manifest.elevationOverlay.url, manifestUrl),
        minimumLevel: manifest.elevationOverlay.minimumLevel ?? 0,
        maximumLevel: manifest.elevationOverlay.maximumLevel ?? 22,
        credit: manifest.credit || 'OpenDroneMap survey',
      };
      if (Array.isArray(manifest.elevationOverlay.rectangle) && manifest.elevationOverlay.rectangle.length === 4) {
        options.rectangle = Cesium.Rectangle.fromDegrees(...manifest.elevationOverlay.rectangle);
      }
      const layer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider(options));
      layer.alpha = manifest.elevationOverlay.alpha ?? 0.65;
      odmImageryLayers.push(layer);
      loaded.push('elevation overlay');
    }
    if ($('odmTerrain').checked && manifest.terrain?.url) {
      viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(odmAssetUrl(manifest.terrain.url, manifestUrl));
      loaded.push('elevation');
    }
    for (const [control, key, label] of [
      ['odmCloud', 'pointCloud', 'point cloud'],
      ['odmMesh', 'texturedMesh', 'textured mesh'],
    ]) {
      if (!$(control).checked || !manifest[key]?.url) continue;
      const tileset = await Cesium.Cesium3DTileset.fromUrl(odmAssetUrl(manifest[key].url, manifestUrl));
      viewer.scene.primitives.add(tileset);
      odmPrimitives.push(tileset);
      loaded.push(label);
    }
    if (!loaded.length) throw new Error('manifest has no selected Cesium-ready layers');
    $('clearOdm').disabled = false;
    $('odmStatus').textContent = `${manifest.name || 'ODM survey'}: ${loaded.join(', ')} loaded.`;
    if (Number.isFinite(manifest.center?.lat) && Number.isFinite(manifest.center?.lon)) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(manifest.center.lon, manifest.center.lat, manifest.center.height || 900),
        duration: 2.5,
      });
    } else if (odmPrimitives.length) {
      await viewer.zoomTo(odmPrimitives[0]);
    }
  } catch (error) {
    removeOdmLayers(false);
    $('odmStatus').textContent = `ODM unavailable: ${error.message || error}. Check the external manifest and generated layer files.`;
  }
}

function keepCameraFrustumFinite(scene) {
  const frustum = scene.camera.frustum;
  if (!Number.isFinite(frustum.near) || frustum.near <= 0) frustum.near = 0.1;
  if (!Number.isFinite(frustum.far) || frustum.far <= frustum.near) {
    frustum.far = Math.max(100_000_000, frustum.near + 1);
  }
}

function recoverFromRenderError() {
  if (recoveringRender) return;
  if (safeMapActive) {
    $('earthStatus').textContent = 'Safe map also failed to render. Refresh the page to retry.';
    return;
  }
  recoveringRender = true;
  safeMapActive = true;
  $('earthStatus').textContent = '3D rendering failed. Restarting with the safe OpenStreetMap globe…';
  setTimeout(async () => {
    try {
      resetMission();
      await initGlobe('');
      $('earthStatus').textContent = 'Safe OpenStreetMap globe ready. Use Reload 3D to retry hosted terrain and buildings.';
      $('odmStatus').textContent = 'ODM layers cleared after a map rendering error. Reload them when ready.';
    } catch (error) {
      $('earthStatus').textContent = `Map recovery failed: ${error.message || error}. Refresh the page to retry.`;
    } finally {
      recoveringRender = false;
    }
  }, 0);
}

async function initGlobe(token = '') {
  if (!cesiumReady()) return;
  const previous = selected;
  if (viewer && !viewer.isDestroyed()) viewer.destroy();
  viewer = null;
  odmImageryLayers = [];
  odmPrimitives = [];
  try {
    // NASA streams the global layers itself. Its hidden reference/controller
    // must start immediately rather than download a duplicate terrain world.
    const detailed = $('detailedEarth').checked && $('worldRenderer').value === 'cesium';
    if (token) Cesium.Ion.defaultAccessToken = token;
    let terrainProvider = new Cesium.EllipsoidTerrainProvider();
    let terrainFailed = false;
    if (token && detailed) {
      try { terrainProvider = await Cesium.createWorldTerrainAsync(); }
      catch (_) { terrainFailed = true; }
    }
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
      baseLayer: detailed ? osmLayer() : new Cesium.ImageryLayer(new Cesium.GridImageryProvider({
        cells: 16, color: Cesium.Color.fromCssColorString('#477879'),
        backgroundColor: Cesium.Color.fromCssColorString('#193c3d'), glowWidth: 0,
      })),
      terrainProvider,
      creditContainer: $('cesiumCredit'),
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      targetFrameRate: 30,
    });
    viewer.resolutionScale = detailed ? 1 : Math.min(1, 1 / (window.devicePixelRatio || 1));
    viewer.scene.postProcessStages.fxaa.enabled = detailed;
    viewer.useDefaultRenderLoop = $('worldRenderer').value !== 'nasa';
    viewer.scene.preUpdate.addEventListener(keepCameraFrustumFinite);
    viewer.scene.renderError.addEventListener(recoverFromRenderError);
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#07111c');
    viewer.scene.skyAtmosphere.show = true;
    baseTerrainProvider = viewer.terrainProvider;
    syncSensorEffects();
    $('earthStatus').textContent = !detailed
      ? 'Fast local 3D ready · schematic grid. Detailed Earth enables online geography.' : token
      ? 'OpenStreetMap loaded. Loading Cesium terrain and 3D buildings…'
      : 'OpenStreetMap globe ready. Add a Cesium ion token later for terrain and 3D buildings.';
    if (token && detailed) {
      try {
        const buildings = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(buildings);
        $('earthStatus').textContent = terrainFailed
          ? '3D buildings ready. Hosted terrain unavailable; using the basic globe.'
          : 'Cesium terrain and OpenStreetMap 3D buildings ready.';
      } catch (error) {
        $('earthStatus').textContent = `Base map ready; 3D content failed: ${error.message || error}`;
      }
    }
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 20, 20_000_000) });
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
    refreshStartAvailability();
    $('demoStatus').textContent = 'Ready. Run the demo to watch the full rescue procedure.';
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
  return event.categories?.length ? 'other' : null;
}

function lastGeo(event) { return [...(event.geometry || [])].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0] || null; }

function centroid(geometry) {
  if (!geometry?.coordinates) return null;
  if (geometry.type === 'Point') {
    const [lon,lat]=geometry.coordinates || [];
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180 ? {lat,lon} : null;
  }
  const points = [];
  const visit = value => typeof value[0] === 'number' ? points.push(value) : value.forEach(visit);
  visit(geometry.coordinates);
  return points.length ? {
    lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
    lon: Math.atan2(points.reduce((sum,p)=>sum+Math.sin(p[0]*Math.PI/180),0),points.reduce((sum,p)=>sum+Math.cos(p[0]*Math.PI/180),0))*180/Math.PI,
  } : null;
}

function drawHazards() {
  if (!viewer) return;
  hazardEntities.forEach(entity => viewer.entities.remove(entity));
  hazardEntities = [];
  const visible=visibleIncidents();
  $('incidentCount').textContent=`${visible.length} reports shown / ${hazards.length} feed records. No report is not evidence of safety.`;
  window.RescueWorld?.setIncidents(visible);
  visible.forEach(event => {
    const kind = kindFor(event);
    const geometry = lastGeo(event);
    if (!kind || !geometry) return;
    const position = centroid(geometry);
    if (!position) return;
    hazardEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(position.lon, position.lat, 30),
      point: {
        pixelSize: kind === 'fire' ? 12 : 10,
        color: Cesium.Color.fromCssColorString(hazardStyle[kind].color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: 0,
      },
      label: {
        text: event.title,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -17),
        disableDepthTestDistance: 0,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 250000),
      },
    }));
  });
}

function renderEvents() {
  const list = $('eventList');
  list.textContent = '';
  const visible=visibleIncidents();
  visible.forEach(event => {
    const kind = kindFor(event);
    const geometry = lastGeo(event);
    const center = centroid(geometry);
    if (!center) return;
    const button = document.createElement('button');
    button.className = 'event';
    button.dataset.incidentId=event.id;
    button.classList.toggle('selected',selected?.incident?.id===event.id);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = hazardStyle[kind].color;
    const text = document.createElement('span');
    text.textContent = event.title;
    const meta = document.createElement('small');
    meta.textContent = `${hazardStyle[kind].title} · ${event.feed || 'NASA EONET'} · reported ${geometry.date ? new Date(geometry.date).toLocaleString() : 'date unavailable'}`;
    text.append(meta);
    button.append(dot, text);
    button.onclick = () => selectIncident(event.id);
    list.append(button);
  });
  drawHazards();
  if (!visible.length) list.textContent='No reports match these filters. This does not establish that the area is safe.';
}

function visibleIncidents() {
  const days=Number($('incidentAge').value);
  const query=$('incidentSearch').value.trim().toLowerCase();
  return hazards.filter(event=>{
    const kind=kindFor(event), geometry=lastGeo(event);
    return kind && $(incidentChecks[kind]).checked && geometry && centroid(geometry) &&
      (!Number.isFinite(days) || Date.now()-Date.parse(geometry.date)<=days*86400000) &&
      (!query || event.title.toLowerCase().includes(query));
  }).sort((a,b)=>Date.parse(lastGeo(b).date)-Date.parse(lastGeo(a).date));
}

function selectIncident(id) {
  if (running || preparingMission) {
    $('incidentMissionStatus').textContent='Finish or reset the current mission before selecting another incident.';
    return;
  }
  const event=hazards.find(item=>item.id===id), geometry=event && lastGeo(event);
  const position=geometry && centroid(geometry);
  if (!position) return;
  const kind=kindFor(event);
  setLocation(Math.max(-89.99,position.lat-250/111320),position.lon,event.title,event.feed || 'NASA EONET','reported point/centroid; incident boundary and drop safety unknown');
  selected.incident={id:event.id,title:event.title,kind,feed:event.feed || 'NASA EONET',reported_at:geometry.date,
    retrieved_at:event.retrieved_at,location:position,sources:event.sources || []};
  selected.demoScene=kind==='flood' || kind==='storm';
  selected.climate=kind==='fire' ? 'incident-fire' : 'neutral';
  if (targetMarker) {
    targetMarker.position=Cesium.Cartesian3.fromDegrees(position.lon,position.lat,30);
    targetMarker.label.text='REPORTED AREA · SIMULATED DROP ZONE';
  }
  $('incidentContext').hidden=false;
  $('incidentTitle').textContent=event.title;
  $('incidentReport').textContent=`${selected.incident.feed} · latest report ${new Date(geometry.date).toLocaleString()} · ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)} · retrieved ${event.retrieved_at ? new Date(event.retrieved_at).toLocaleString() : 'unknown'}`;
  $('provenance').textContent=`SOURCE: ${selected.incident.feed} · REPORT: ${geometry.date} · LOCATION: reported point/centroid, boundary unknown · DROP ZONE: simulated`;
  const source=(event.sources || []).find(item=>{try{return ['http:','https:'].includes(new URL(item.url).protocol);}catch{return false;}});
  $('incidentSource').hidden=!source;
  if (source) $('incidentSource').href=source.url;
  $('incidentMissionStatus').textContent='Opening the reported area in 3D. Send the aid drone to watch a simulated loading, delivery and return at this location.';
  $('incidentMissionStatus').dataset.loading='true';
  $('candidate').querySelector('b').textContent='SIMULATED recipients near the reported area';
  $('candidate').querySelector('span').textContent='Three virtual recipients for this exercise; no person detections have been verified.';
  $('selection').textContent=`${event.title} · reported at ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)} · simulated base 250 m south`;
  refreshStartAvailability();
  logEvent('INCIDENT_SELECTED',JSON.stringify(selected.incident));
  renderEvents();
}

async function runIncidentRescue() {
  if (!selected?.incident || !viewer || running || preparingMission || $('rescueIncident').disabled) return;
  $('flightSource').value='scripted';
  $('scenario').value=$('incidentOutcome').value;
  $('packageCount').value='3';
  $('routeRadius').value='250';
  $('rainEffect').checked=['flood','storm'].includes(selected.incident.kind);
  syncSensorEffects();
  targetConfirmed=true;
  $('candidate').classList.add('confirmed');
  $('incidentMissionStatus').textContent='SIMULATED aid mission: three recipients and packages. Automatic demo review does not authorize any hardware release.';
  logEvent('INCIDENT_DEMO_REVIEW','Automatic simulated candidate/release decisions for '+selected.incident.id);
  await buildMission(true);
  if (mission?.incident) $('followDrone').checked=true;
}

async function refreshEvents() {
  if (refreshingIncidents) return;
  refreshingIncidents=true;
  $('feedStatus').textContent='Refreshing NASA EONET and USGS reports…';
  const results=await Promise.allSettled([EONET,USGS].map(async url=>{
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }));
  for (const [index,key] of ['eonet','usgs'].entries()) {
    const result=results[index], feed=incidentFeeds[key];
    feed.error=result.status==='rejected';
    if (feed.error) continue;
    feed.time=new Date().toISOString();
    feed.events=key==='eonet' ? (result.value.events || []).map(event=>({...event,feed:'NASA EONET',retrieved_at:feed.time}))
      : (result.value.features || []).filter(f=>f.properties?.type==='earthquake' && Number.isFinite(f.properties.time) && f.geometry?.type==='Point').map(f=>({
        id:'usgs-'+f.id,title:f.properties.title || `M${f.properties.mag} ${f.properties.place}`,feed:'USGS',retrieved_at:feed.time,
        categories:[{title:'Earthquakes'}],sources:[{id:'USGS',url:f.properties.url}],
        geometry:[{type:'Point',coordinates:f.geometry?.coordinates?.slice(0,2),date:new Date(f.properties.time).toISOString()}]}));
  }
  hazards=[...incidentFeeds.eonet.events,...incidentFeeds.usgs.events].filter(event=>kindFor(event) && lastGeo(event) && centroid(lastGeo(event)));
  const failed=Object.entries(incidentFeeds).filter(([,feed])=>feed.error).map(([key])=>key.toUpperCase());
  $('feedStatus').textContent=`${hazards.length} feed records · checked ${new Date().toLocaleString()} · `+
    (failed.length ? `${failed.join(', ')} unavailable; retained records may be stale.` : 'NASA EONET + USGS connected. Report times differ from refresh time.');
  refreshingIncidents=false;
  renderEvents();
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
  if (base.incident?.location) return {...base.incident.location};
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
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || running) return;
  if (mission) resetMission();
  missionPreparation += 1;
  preparingMission = false;
  selected = { lat, lon, name, source, uncertainty, timestamp: new Date().toISOString() };
  $('incidentContext').hidden=true;
  $('candidate').querySelector('b').textContent='AI candidate: possible stranded person';
  $('candidate').querySelector('span').textContent='SIMULATED detection · confidence 78% · operator review required';
  window.RescueWorld?.selectArea(selected);
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
      point: { pixelSize: 12, color: Cesium.Color.CYAN, heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: markerLabel('SIMULATED BASE', Cesium.Color.CYAN),
    });
    const target = targetFor();
    targetMarker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, 30),
      point: { pixelSize: 11, color: Cesium.Color.ORANGE, heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
  window.RescueWorld?.flyToPreset(preset);
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
  viewer.trackedEntity = undefined;
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

function setMissionInputsDisabled(disabled) {
  ['flightSource','scenario','packageCount','routeRadius','demoOutcome','climateScenario','detailedEarth'].forEach(id => { $(id).disabled = disabled; });
}

function missionWorldPosition(position) {
  const height = followsSITL() && mission?.terrain
    ? mission.terrain.heights[0] + position.alt : null;
  return RescueScene.worldPosition(mission?.terrain, position, height);
}

function missionOverview() {
  if (!viewer || !mission) return;
  if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) viewer.scene.morphTo3D(0);
  viewer.camera.cancelFlight();
  $('followDrone').checked = false;
  viewer.trackedEntity = undefined;
  const center = interpolate(mission.base || selected, mission.target, 0.5);
  const height = RescueScene.groundHeight(mission.terrain, center) + 25;
  const range = Math.max(500,groundDistanceMeters(mission.base || selected,mission.target) * 1.8);
  const pitch = Cesium.Math.toRadians(-42);
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(center.lon,center.lat,height));
  const destination = Cesium.Matrix4.multiplyByPoint(frame,
    new Cesium.Cartesian3(0,-range*Math.cos(pitch),-range*Math.sin(pitch)),new Cesium.Cartesian3());
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.camera.setView({destination,orientation:{heading:0,pitch,roll:0}});
  viewer.scene.requestRender();
  window.RescueWorld?.missionView();
}

async function runRescueDemo() {
  if (!viewer || running || preparingMission) return;
  resetMission();
  $('flightSource').value = 'scripted';
  $('scenario').value = $('demoOutcome').value;
  $('packageCount').value = '3';
  $('routeRadius').value = '250';
  const climate = $('climateScenario').value;
  const areas = {
    'elnino-india': [12.2958,76.6394,'Karnataka, India · El Niño monsoon stress scenario'],
    neutral: [46.8421,-91.994,'Flood rescue training area'],
    'elnino-wet': [-5.19,-80.63,'Coastal Peru · El Niño wet scenario'],
    'elnino-dry': [-2.5,114,'Indonesia · El Niño dry scenario'],
  };
  setLocation(...areas[climate], 'scripted climate training scenario','simulated placement');
  selected.demoScene = climate === 'neutral' || climate === 'elnino-wet';
  selected.climate = climate;
  $('rainEffect').checked = climate === 'elnino-wet';
  syncSensorEffects();
  $('climateStatus').textContent = climate === 'elnino-india'
    ? 'SIMULATED India scenario: a weaker summer monsoon, dry ground, heat stress and illustrative fire-risk markers. El Niño can affect Indian rainfall, but does not guarantee drought. This is not a current weather alert or forecast.'
    : climate === 'elnino-wet'
    ? 'SIMULATED El Niño wet scenario: coastal Peru, heavier rain and an expanded flood surface. Water levels are illustrative, not hydrological predictions.'
    : climate === 'elnino-dry'
      ? 'SIMULATED El Niño dry scenario: Indonesia, dry ground, smoke and fire-risk markers. Fires are illustrative; no real fire is predicted.'
      : 'Standard simulated flood scenario. No seasonal climate effect applied.';
  logEvent('CLIMATE_SCENARIO', $('climateStatus').textContent);
  targetConfirmed = true;
  $('candidate').classList.add('confirmed');
  logEvent('DEMO_TARGET_REVIEW','Automatic candidate confirmation for the software demonstration.');
  if (targetMarker) targetMarker.label.text = 'DEMO REVIEWED · 3 SIMULATED PEOPLE';
  await buildMission(true);
}

async function buildMission(autoDemo = false) {
  autoDemo = autoDemo === true;
  if (!viewer || !selected || !targetConfirmed || running || preparingMission || (followsSITL() && !autopilotConnected)) return;
  preparingMission = true;
  const generation = ++missionPreparation;
  const activeViewer = viewer;
  const base = { ...selected };
  const target = targetFor(base);
  refreshStartAvailability();
  $('demoStatus').textContent = 'Preparing terrain and 3D rescue scene…';
  let terrain;
  let sceneDecks={baseDeck:0,dropDeck:11};
  try {
    if (base.incident && $('worldRenderer').value==='nasa' && window.RescueWorld?.getState().detailed) {
      const prepared=await window.RescueWorld.prepareIncidentScene(base,target);
      terrain=prepared.terrain;
      sceneDecks=prepared;
      base.sceneDecks={baseDeck:prepared.baseDeck,dropDeck:prepared.dropDeck};
    } else terrain = await RescueScene.terrainProfile(activeViewer,base,target);
  }
  catch (error) {
    if (generation === missionPreparation) {
      preparingMission = false;
      refreshStartAvailability();
      $('demoStatus').textContent = `Scene preparation interrupted: ${error.message || error}. Retry the demo.`;
      if (base.incident) $('incidentMissionStatus').textContent=$('demoStatus').textContent;
    }
    return;
  }
  if (generation !== missionPreparation || activeViewer !== viewer) return;
  preparingMission = false;
  replayGeneration += 1;
  clearMissionEntities();
  const packageCount = Math.max(1, Math.min(6, Number($('packageCount').value) || 1));
  mission = {
    base,
    incident: base.incident || null,
    climate: base.climate || 'neutral',
    target,
    terrain,
    baseAltitude:sceneDecks.baseDeck+3,
    dropAltitude:sceneDecks.dropDeck+1,
    hoverAltitude:base.incident ? Math.max(35,sceneDecks.dropDeck+25) : 35,
    cruiseAltitude:Math.max(75,sceneDecks.dropDeck+60,sceneDecks.baseDeck+40),
    autoDemo,
    people: 3,
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
    sensorEffects: enabledSensorEffects(),
  };
  // Dynamic presentation geometry needs continuous rendering, including after landing.
  viewer.scene.requestRenderMode = false;
  sensorTelemetryQueue = [];
  [[selectedMarker,base],[targetMarker,target]].forEach(([marker,position]) => {
    if (!marker) return;
    marker.position = RescueScene.worldPosition(terrain,{ ...position, alt: 18 });
    marker.point.heightReference = Cesium.HeightReference.NONE;
  });
  routeEntities.push(...RescueScene.addSite(viewer,base,target,terrain,Boolean(base.demoScene),mission.climate));
  const routePositions = terrain.heights.map((height,index) => Cesium.Cartesian3.fromDegrees(
    base.lon + (target.lon-base.lon)*index/12,base.lat + (target.lat-base.lat)*index/12,height+mission.cruiseAltitude));
  routeEntities.push(viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => routePositions, false),
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.CYAN, dashLength: 12 }),
    },
  }));
  const aircraft = RescueScene.addDrone(viewer,missionWorldPosition({ ...base, alt: mission.baseAltitude }),() => missionClock);
  drone = aircraft.body;
  routeEntities.push(...aircraft.parts);
  packages = Array.from({ length: packageCount }, (_, index) => viewer.entities.add({
    position: missionWorldPosition({ ...base, alt: 1 }),
    box: { dimensions: new Cesium.Cartesian3(1.5, 1.5, 1.5), material: Cesium.Color.fromCssColorString('#ffc45c') },
  }));
  missionClock = 0;
  if ($('falseDetections').checked) {
    const falseTarget = offsetMetres(target, 45, -35);
    routeEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(falseTarget.lon, falseTarget.lat, 25),
      point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: markerLabel('INJECTED FALSE AI ALERT · SIMULATED', Cesium.Color.RED),
    }));
    logEvent('FALSE_DETECTION_INJECTED', 'A simulated false person alert was added for operator review; it is not a real detection.');
  }
  lastFrame = performance.now();
  running = true;
  paused = false;
  setSensorControlsDisabled(true);
  setMissionInputsDisabled(true);
  $('runDemo').disabled = true;
  $('missionView').disabled = false;
  $('missionHud').hidden = false;
  $('demoStatus').textContent = autoDemo
    ? 'Automatic software demonstration running. All people, flooding and decisions are simulated.'
    : 'Manual mission running. Approve or abort at the drop zone.';
  if (!terrain.sampled) $('demoStatus').textContent += ' Using currently loaded terrain heights.';
  $('panel').scrollTop = 0;
  $('start').disabled = true;
  $('pause').disabled = false;
  $('pause').textContent = 'Pause';
  $('abortMission').disabled = false;
  $('approveRelease').disabled = true;
  $('approvalText').textContent = 'Waiting for arrival at the confirmed drop zone.';
  $('phase').textContent = 'LOADING PACKAGES';
  $('missionStatus').textContent = `Loading ${packageCount} simulated package(s).`;
  renderInventory(packageCount, 0);
  missionOverview();
  logEvent('MISSION_STARTED', `${mission.scenario} scenario; ${packageCount} simulated package(s); position source ${mission.flightSource}; sensor effects ${mission.sensorEffects.join(', ') || 'none'}`);
  const flightGeneration = replayGeneration;
  requestAnimationFrame(now => animateMission(now,flightGeneration));
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
  setSensorControlsDisabled(false);
  setMissionInputsDisabled(false);
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
  $('demoStatus').textContent = outcome === 'delivered'
    ? `${mission.delivered} aid packages delivered to the rooftop. Drone landed at base. Simulation complete.`
    : 'Unsafe drop aborted. All packages retained; drone landed at base. Simulation complete.';
  refreshStartAvailability();
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

function approveSimulatedRelease() {
  if (!mission || mission.phase !== 'awaiting_approval' || mission.scenario !== 'success') return;
  mission.operatorApproved = true;
  $('approveRelease').disabled = true;
  $('abortMission').disabled = true;
  $('approvalText').textContent = mission.autoDemo ? 'Automatic demo decision recorded. Simulating release.' : 'Operator approval recorded. Simulating payload release.';
  setMissionPhase('releasing', mission.autoDemo
    ? 'Software demo approved the simulated release. Unloading aid packages one by one.'
    : 'Operator approved release; virtual latch command acknowledged.');
}

function awaitReleaseDecision() {
  setMissionPhase('awaiting_approval', 'Hovering over the rooftop. Reviewing the simulated drop zone.');
  $('approveRelease').disabled = mission.scenario !== 'success';
  $('approvalText').textContent = mission.scenario === 'success'
    ? 'Target confirmed. Review the zone, then approve or abort.'
    : 'Unsafe drop-zone condition injected. Abort is required.';
}

function missionPosition() {
  const elapsed = missionClock - mission.phaseStart;
  const baseAltitude=mission.baseAltitude ?? 3, cruise=mission.cruiseAltitude ?? 75, hover=mission.hoverAltitude ?? 35;
  if (mission.phase === 'loading') {
    if (elapsed >= 3) setMissionPhase('takeoff', 'Aid loaded. Taking off slowly.');
    return { ...selected, alt: baseAltitude };
  }
  if (mission.phase === 'takeoff') {
    const fraction = Math.min(elapsed / 4, 1);
    if (fraction >= 1) setMissionPhase('outbound', 'Flying to the confirmed simulated drop zone.');
    return { ...selected, alt: baseAltitude + (cruise-baseAltitude) * fraction };
  }
  if (mission.phase === 'outbound') {
    const livePosition = autopilotPosition();
    if (followsSITL()) {
      if (livePosition && groundDistanceMeters(livePosition, mission.target) <= 30) {
        awaitReleaseDecision();
      }
      return { ...selected, alt: 10 };
    }
    const fraction = Math.min(elapsed / 10, 1);
    if (fraction >= 1) {
      setMissionPhase('descending', 'Three simulated people located. Descending toward the rooftop drop zone.');
    }
    return { ...interpolate(selected, mission.target, fraction), alt: cruise };
  }
  if (mission.phase === 'descending') {
    const fraction = Math.min(elapsed / 4, 1);
    if (fraction >= 1) awaitReleaseDecision();
    return { ...mission.target, alt: cruise - (cruise-hover) * fraction };
  }
  if (mission.phase === 'awaiting_approval') {
    if (mission.autoDemo && elapsed >= 2) {
      if (mission.scenario === 'success') approveSimulatedRelease();
      else abortMission('Automatic demo review found an unsafe drop zone. All aid retained; returning to base.');
    }
    return { ...mission.target, alt: hover };
  }
  if (mission.phase === 'releasing') {
    const delivered = Math.min(mission.packageCount, Math.floor(elapsed / 3));
    if (delivered > mission.delivered) {
      mission.delivered = delivered;
      logEvent('PACKAGE_DELIVERED', `Simulated rooftop delivery ${delivered}/${mission.packageCount}.`);
    }
    if (mission.delivered >= mission.packageCount) {
      mission.returnFrom = mission.target;
      setMissionPhase('ascending', 'All packages delivered. Climbing for the return flight.');
    }
    return { ...mission.target, alt: hover };
  }
  if (mission.phase === 'ascending') {
    const fraction = Math.min(elapsed / 4, 1);
    if (fraction >= 1) setMissionPhase('returning', 'Returning to the aid base.');
    return { ...mission.target, alt: hover + (cruise-hover) * fraction };
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
    if (fraction >= 1) setMissionPhase('landing', 'Arrived at base. Landing slowly.');
    const startAltitude = mission.returnFrom?.alt ?? cruise;
    return { ...position, alt: startAltitude + (cruise - startAltitude) * Math.min(fraction * 3, 1) };
  }
  if (mission.phase === 'landing') {
    const fraction = Math.min(elapsed / 4, 1);
    if (fraction >= 1) finishMission(mission.outcome === 'aborted' ? 'aborted' : 'delivered');
    return { ...selected, alt: cruise - (cruise-baseAltitude) * fraction };
  }
  return { ...selected, alt: baseAltitude };
}

function postState(now, position) {
  if ((now - lastStateSent < 250 && running) || !mission) return;
  lastStateSent = now;
  const dx = (position.lon - selected.lon) * 111320 * Math.cos(selected.lat * Math.PI / 180);
  const dz = -(position.lat - selected.lat) * 111320;
  const elapsed = missionClock - mission.phaseStart;
  let progress = 0;
  if (mission.phase === 'loading') progress = Math.min(5, elapsed / 3 * 5);
  else if (mission.phase === 'takeoff') progress = 5 + Math.min(5, elapsed / 4 * 5);
  else if (mission.phase === 'outbound') progress = 10 + Math.min(40, elapsed / 10 * 40);
  else if (mission.phase === 'descending') progress = 50 + Math.min(10, elapsed / 4 * 10);
  else if (mission.phase === 'awaiting_approval') progress = 60;
  else if (mission.phase === 'releasing') progress = 60 + Math.min(15, elapsed / (3 * mission.packageCount) * 15);
  else if (mission.phase === 'ascending') progress = 75 + Math.min(5, elapsed / 4 * 5);
  else if (mission.phase === 'returning' || mission.phase === 'aborted_return') progress = 80 + Math.min(15, elapsed / 10 * 15);
  else if (mission.phase === 'landing') progress = 95 + Math.min(5, elapsed / 4 * 5);
  else if (mission.phase === 'complete') progress = 100;
  const telemetryPhase = mission.phase === 'releasing' ? 'unload' : mission.phase;
  const sequence = ['loading','takeoff'].includes(mission.phase) ? 0 : ['outbound','descending'].includes(mission.phase) ? 1 : mission.phase === 'awaiting_approval' ? 2 : mission.phase === 'releasing' ? 3 : mission.phase === 'complete' ? 5 : 4;
  const state = {
    source: followsSITL() ? 'sitl-mavlink-with-operator-workflow' : 'earth-simulation',
    phase: telemetryPhase,
    t: missionClock,
    total_seconds: 41 + 3 * mission.packageCount,
    progress_percent: progress,
    position: { x: dx, y: position.alt, z: dz },
    velocity: { x: 0, y: 0, z: 0 },
    heading_deg: followsSITL() ? (autopilotTelemetry?.heading_deg ?? 0) : 0,
    battery_percent: followsSITL() && autopilotTelemetry?.battery_percent != null
      ? autopilotTelemetry.battery_percent : Math.max(0, 100 - missionClock * 0.35),
    packages_loaded: loadedPackages(),
    packages_onboard: loadedPackages() - mission.delivered,
    packages_delivered: mission.delivered,
    people_detected: mission.people + ($('falseDetections').checked ? 1 : 0),
    automatic_demo: mission.autoDemo,
    incident_id: mission.incident?.id || null,
    false_detections_simulated: $('falseDetections').checked ? 1 : 0,
    sensor_effects: mission.sensorEffects,
    site_index: 0,
    site_name: 'Operator-confirmed simulated drop zone',
    mission_seq: sequence,
    mission_total: 6,
    target_confirmed: targetConfirmed,
    operator_release_approved: !mission.autoDemo && mission.operatorApproved,
    simulated_release_approved: mission.operatorApproved,
    outcome: mission.outcome,
    complete: !running,
    paused,
    simulated: true,
    map_origin: { latitude_deg: selected.lat, longitude_deg: selected.lon, name: selected.name },
  };
  fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }).catch(() => {});
}

function loadedPackages() {
  return mission.phase === 'loading'
    ? Math.min(mission.packageCount,Math.floor((missionClock-mission.phaseStart)/3*mission.packageCount))
    : mission.packageCount;
}

function animateMission(now, generation) {
  if (generation !== replayGeneration || !running || !mission || !drone) return;
  if (!paused) missionClock += Math.min((now - lastFrame) / 1000, 0.25) * (followsSITL() ? 1 : Number($('missionSpeed').value));
  lastFrame = now;
  const scriptedPosition = missionPosition();
  const actualPosition = autopilotPosition() || applyWindDrift(scriptedPosition);
  const position = sensorPosition(actualPosition);
  mission.current = actualPosition;
  drone.position = missionWorldPosition(position);
  viewer.scene.requestRender();
  if (followsSITL() && autopilotTelemetry?.heading_deg != null) {
    const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(autopilotTelemetry.heading_deg), 0, 0);
    drone.orientation = Cesium.Transforms.headingPitchRollQuaternion(drone.position.getValue(), hpr);
  }
  packages.forEach((item, index) => {
    if (index < mission.delivered) {
      item.position = RescueScene.worldPosition(mission.terrain, { lon: mission.target.lon + 0.000025 * index, lat: mission.target.lat, alt: mission.dropAltitude ?? 12 });
      item.box.material = Cesium.Color.fromCssColorString('#65dec0');
    } else if (mission.phase === 'releasing' && index === mission.delivered) {
      const fraction = Math.min(((missionClock - mission.phaseStart) / 3) - index, 1);
      const top=(mission.hoverAltitude ?? 35)-3, bottom=mission.dropAltitude ?? 12;
      item.position = RescueScene.worldPosition(mission.terrain, { ...mission.target, alt: top-(top-bottom)*Math.max(0,fraction) });
    } else {
      const loading = mission.phase === 'loading';
      item.position = RescueScene.worldPosition(mission.terrain, { lon: position.lon + index * 0.000012,
        lat: position.lat, alt: loading ? (mission.baseAltitude ?? 3)-2 : Math.max(1, position.alt - 2 - index * 0.3) });
    }
  });
  $('hudPhase').textContent = $('phase').textContent;
  $('hudPeople').textContent = mission.people;
  $('hudOnboard').textContent = loadedPackages() - mission.delivered;
  $('hudDelivered').textContent = mission.delivered;
  $('hudAltitude').textContent = `${position.alt.toFixed(0)} m`;
  $('hudDetail').textContent = $('missionStatus').textContent;
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
      height_ellipsoid_m: Number(Cesium.Cartographic.fromCartesian(drone.position.getValue()).height.toFixed(2)),
      heading_deg: followsSITL() ? (autopilotTelemetry?.heading_deg ?? 0) : 0,
      battery_percent: Number(Number(battery).toFixed(1)),
      phase: mission.phase,
      packages_delivered: mission.delivered,
      actual_lat: Number(actualPosition.lat.toFixed(7)),
      actual_lon: Number(actualPosition.lon.toFixed(7)),
      sensor_effects: mission.sensorEffects,
    });
  }
  renderInventory(mission.packageCount, mission.delivered);
  postState(now, position);
  if (running) requestAnimationFrame(time => animateMission(time,generation));
}

function resetMission() {
  missionPreparation += 1;
  preparingMission = false;
  replayGeneration += 1;
  running = false;
  paused = false;
  missionClock = 0;
  mission = null;
  sensorTelemetryQueue = [];
  setSensorControlsDisabled(false);
  setMissionInputsDisabled(false);
  clearMissionEntities();
  if (viewer) { viewer.scene.requestRenderMode = true; viewer.scene.requestRender(); }
  $('phase').textContent = 'DRONE AT BASE';
  $('delivered').textContent = '0';
  $('battery').textContent = '100%';
  $('missionStatus').textContent = 'Mission reset. Select and confirm a candidate to run again.';
  $('pause').disabled = true;
  $('pause').textContent = 'Pause';
  $('abortMission').disabled = true;
  $('approveRelease').disabled = true;
  $('approvalText').textContent = 'Available only after arrival and target confirmation.';
  $('missionHud').hidden = true;
  $('missionView').disabled = true;
  $('followDrone').checked = false;
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
  $('detailedEarth').checked = true;
  if ($('worldRenderer').value === 'nasa' && window.RescueWorld) {
    window.RescueWorld.loadWorld(true);
    return;
  }
  safeMapActive = false;
  initGlobe(token);
};
$('detailedEarth').onchange = () => {
  if ($('worldRenderer').value === 'nasa' && window.RescueWorld) {
    window.RescueWorld.loadWorld($('detailedEarth').checked);
    return;
  }
  resetMission();
  initGlobe($('cesiumToken').value.trim() || DEFAULT_CESIUM_TOKEN);
};
$('loadOdm').onclick = loadOdmLayers;
$('clearOdm').onclick = () => {
  if ($('worldRenderer').value === 'nasa' && window.RescueWorld) {
    window.RescueWorld.clearCustom();
    $('clearOdm').disabled = true;
    $('odmStatus').textContent = 'NASA ODM layer cleared.';
  } else removeOdmLayers();
};
$('toggleSensors').onclick = () => {
  const enable = enabledSensorEffects().length === 0;
  sensorControlIds.forEach(id => { $(id).checked = enable; });
  $('toggleSensors').textContent = enable ? 'Disable all' : 'Enable all';
  syncSensorEffects();
};
sensorControlIds.forEach(id => {
  $(id).onchange = () => {
    $('toggleSensors').textContent = enabledSensorEffects().length ? 'Disable all' : 'Enable all';
    syncSensorEffects();
  };
});
document.querySelectorAll('[data-preset]').forEach(button => {
  button.onclick = () => flyToPreset(button.dataset.preset);
});
Object.values(incidentChecks).forEach(id => $(id).onchange = renderEvents);
$('incidentAge').onchange=renderEvents;
$('incidentSearch').oninput=renderEvents;
$('rescueIncident').onclick=runIncidentRescue;
$('showIncidentGlobe').onclick=()=>window.RescueWorld?.wholeEarth();
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
$('runDemo').onclick = runRescueDemo;
$('missionView').onclick = missionOverview;
$('followDrone').onchange = () => {
  if (!viewer || !drone) return;
  viewer.camera.cancelFlight();
  if ($('followDrone').checked) viewer.trackedEntity = drone;
  else missionOverview();
};
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
$('approveRelease').onclick = approveSimulatedRelease;
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
  viewer.scene.requestRenderMode = false;
  const positions = samples.flatMap(sample => [sample.lon, sample.lat, sample.height_ellipsoid_m ?? sample.alt]);
  routeEntities.push(viewer.entities.add({
    polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(positions), width: 4, material: Cesium.Color.fromCssColorString('#ffc45c') },
  }));
  if (mission.terrain) routeEntities.push(...RescueScene.addSite(viewer,mission.base || mission.terrain.base,
    mission.target,mission.terrain,Boolean(mission.terrain.base.demoScene),mission.climate || 'neutral'));
  const aircraft = RescueScene.addDrone(viewer,Cesium.Cartesian3.fromDegrees(samples[0].lon,
    samples[0].lat,samples[0].height_ellipsoid_m ?? samples[0].alt),() => performance.now()/1000);
  drone = aircraft.body;
  drone.label.text = 'MISSION REPLAY · SIMULATED';
  routeEntities.push(...aircraft.parts);
  evidence = Array.isArray(record.events) ? record.events : [];
  $('missionLog').textContent = '';
  evidence.forEach(appendEventRow);
  $('phase').textContent = 'REPLAY';
  $('missionStatus').textContent = 'Replaying recorded simulated telemetry at 2× speed. No commands or telemetry are being sent.';
  $('missionHud').hidden = false;
  $('pause').disabled = true;
  $('abortMission').disabled = true;
  $('approveRelease').disabled = true;
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(samples[0].lon, samples[0].lat,
    Math.max(800,(samples[0].height_ellipsoid_m ?? samples[0].alt)+500)) });
  const started = performance.now();
  const duration = samples.at(-1).t;
  function replayFrame(now) {
    if (generation !== replayGeneration) return;
    const replayTime = Math.min((now - started) / 500, duration);
    let index = samples.findIndex(sample => sample.t >= replayTime);
    if (index < 0) index = samples.length - 1;
    const sample = samples[index];
    drone.position = Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.height_ellipsoid_m ?? sample.alt);
    viewer.scene.requestRender();
    const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(sample.heading_deg || 0), 0, 0);
    drone.orientation = Cesium.Transforms.headingPitchRollQuaternion(drone.position.getValue(), hpr);
    $('phase').textContent = `REPLAY · ${(sample.phase || 'mission').replaceAll('_', ' ').toUpperCase()}`;
    $('battery').textContent = `${Number(sample.battery_percent ?? 0).toFixed(0)}%`;
    $('batteryLabel').textContent = 'recorded battery';
    $('delivered').textContent = sample.packages_delivered ?? 0;
    $('hudPhase').textContent = $('phase').textContent;
    $('hudPeople').textContent = mission.people ?? 1;
    $('hudDelivered').textContent = sample.packages_delivered ?? 0;
    $('hudOnboard').textContent = (mission.packageCount ?? 0) - (sample.packages_delivered ?? 0);
    $('hudAltitude').textContent = `${sample.alt.toFixed(0)} m`;
    $('hudDetail').textContent = 'Replaying the recorded software demonstration.';
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

const rememberedToken = sessionStorage.getItem('rescueCesiumToken') || DEFAULT_CESIUM_TOKEN;
$('cesiumToken').value = rememberedToken;
if (new URLSearchParams(location.search).get('quality') === 'fast') $('detailedEarth').checked = false;
if (new URLSearchParams(location.search).get('renderer') === 'cesium') $('worldRenderer').value = 'cesium';
const initialGlobe = initGlobe(rememberedToken);
refreshEvents();
setInterval(refreshEvents, 5 * 60 * 1000);
refreshAutopilot();
setInterval(refreshAutopilot, 400);

const params = new URLSearchParams(location.search);
const queryLat = Number(params.get('lat'));
const queryLon = Number(params.get('lon'));
initialGlobe.then(() => {
  if (params.get('demo') === '1') {
    runRescueDemo();
  } else if (params.has('lat') && params.has('lon') && Number.isFinite(queryLat) && Number.isFinite(queryLon)) {
    setLocation(queryLat, queryLon, params.get('name') || 'Shared mission area', 'live operations map', '±100 m');
  }
});
