/* Live public-data viewer. It never controls a vehicle or sends a flight command. */
const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=500';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const REFRESH_MS = 10 * 60 * 1000;
const CATEGORY = { 'Wildfires': 'wildfires', 'Floods': 'floods', 'Severe Storms': 'storms' };
const COLORS = { wildfires: '#ff643d', floods: '#39a9ff', storms: '#b47cff' };

const map = L.map('map', { zoomControl: true }).setView([20, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
const layers = { wildfires: L.layerGroup().addTo(map), floods: L.layerGroup().addTo(map), storms: L.layerGroup().addTo(map) };
let selected = null;
let selectedMarker = null;
let allEvents = [];

const $ = (id) => document.getElementById(id);
const fmt = (value) => new Date(value).toLocaleString();

function eventKind(event) {
  for (const category of event.categories || []) if (CATEGORY[category.title]) return CATEGORY[category.title];
  return null;
}

function latestGeometry(event) {
  const choices = event.geometry || [];
  return choices.length ? choices[choices.length - 1] : null;
}

function coordinatesCenter(geometry) {
  const coords = geometry?.coordinates;
  if (!coords) return null;
  if (geometry.type === 'Point') return { lat: coords[1], lon: coords[0] };
  const points = [];
  (function collect(value) { typeof value[0] === 'number' ? points.push(value) : value.forEach(collect); })(coords);
  if (!points.length) return null;
  return { lat: points.reduce((sum, p) => sum + p[1], 0) / points.length, lon: points.reduce((sum, p) => sum + p[0], 0) / points.length };
}

function sourceUrl(event) {
  return event.sources?.[0]?.url || `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(event.id)}`;
}

function addEvent(event) {
  const kind = eventKind(event);
  const geometry = latestGeometry(event);
  if (!kind || !geometry) return;
  const feature = { type: 'Feature', properties: {}, geometry };
  const layer = L.geoJSON(feature, {
    pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 7, color: COLORS[kind], fillColor: COLORS[kind], fillOpacity: .74, weight: 2 }),
    style: { color: COLORS[kind], weight: 3, fillOpacity: .18 },
  });
  const center = coordinatesCenter(geometry);
  layer.bindPopup(`<b>${escapeHtml(event.title)}</b><br>${escapeHtml(kind)} · ${geometry.date ? fmt(geometry.date) : 'date unavailable'}<br><a target="_blank" rel="noopener" href="${sourceUrl(event)}">Source record</a>`);
  layer.on('click', () => selectLocation(center, event.title));
  layer.addTo(layers[kind]);
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }

function renderEvents() {
  Object.values(layers).forEach(layer => layer.clearLayers());
  for (const event of allEvents) addEvent(event);
  const list = $('events');
  list.textContent = '';
  const visible = allEvents.filter(event => $(eventKind(event))?.checked).slice(0, 80);
  for (const event of visible) {
    const geometry = latestGeometry(event); const kind = eventKind(event); const center = coordinatesCenter(geometry);
    if (!geometry || !center) continue;
    const item = document.createElement('li');
    const button = document.createElement('button'); button.textContent = event.title;
    button.onclick = () => { map.flyTo([center.lat, center.lon], Math.max(map.getZoom(), 7)); selectLocation(center, event.title); };
    const meta = document.createElement('span'); meta.className = 'eventMeta'; meta.textContent = `${kind} · ${geometry.date ? fmt(geometry.date) : 'date unavailable'}`;
    item.append(button, meta); list.append(item);
  }
}

function weatherText(current) {
  const rain = Number(current.rain || 0) + Number(current.showers || 0);
  return `${current.temperature_2m ?? '—'}°C · wind ${current.wind_speed_10m ?? '—'} km/h · rain ${rain.toFixed(1)} mm · weather code ${current.weather_code ?? '—'}`;
}

async function loadWeather(location) {
  $('weather').textContent = 'Loading live weather…';
  const params = new URLSearchParams({ latitude: location.lat, longitude: location.lon, current: 'temperature_2m,apparent_temperature,precipitation,rain,showers,wind_speed_10m,wind_direction_10m,weather_code', timezone: 'auto' });
  try {
    const response = await fetch(`${WEATHER_URL}?${params}`);
    if (!response.ok) throw new Error(`weather HTTP ${response.status}`);
    const data = await response.json();
    $('weather').textContent = `${weatherText(data.current)} · observed ${data.current.time || 'now'} ${data.timezone_abbreviation || ''}`;
  } catch { $('weather').textContent = 'Live weather unavailable. Check your internet connection and try again.'; }
}

function updateMissionLink() {
  const url = new URL('rescue_simulation.html', location.href);
  if (selected) { url.searchParams.set('lat', selected.lat); url.searchParams.set('lon', selected.lon); url.searchParams.set('name', selected.name); }
  $('openMission').href = url.toString();
}

function selectLocation(location, name = 'Map selection') {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return;
  selected = { lat: Number(location.lat.toFixed(6)), lon: Number(location.lon.toFixed(6)), name };
  $('place').textContent = `${name}: ${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}`;
  if (selectedMarker) selectedMarker.remove();
  selectedMarker = L.marker([selected.lat, selected.lon]).addTo(map).bindPopup('Selected simulated mission origin').openPopup();
  $('setMission').disabled = false;
  updateMissionLink();
  loadWeather(selected);
}

async function refreshEvents() {
  $('feedStatus').textContent = 'Loading active worldwide events…';
  try {
    const response = await fetch(EONET_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`EONET HTTP ${response.status}`);
    const data = await response.json();
    allEvents = (data.events || []).filter(event => eventKind(event) && latestGeometry(event));
    renderEvents();
    $('feedStatus').textContent = `${allEvents.length} active wildfire, flood or severe-storm records loaded at ${new Date().toLocaleTimeString()}. Auto-refresh: 10 minutes.`;
  } catch {
    $('feedStatus').textContent = 'Live event feed unavailable. Check your internet connection and try Refresh.';
  }
}

map.on('click', (event) => selectLocation({ lat: event.latlng.lat, lon: event.latlng.lng }));
['wildfires', 'floods', 'storms'].forEach(id => $(id).addEventListener('change', () => {
  if ($(id).checked) map.addLayer(layers[id]); else map.removeLayer(layers[id]); renderEvents();
}));
$('refresh').onclick = refreshEvents;
$('setMission').onclick = () => {
  localStorage.setItem('liveOpsMissionLocation', JSON.stringify({ ...selected, selectedAt: new Date().toISOString() }));
  $('setMission').textContent = 'Simulation origin saved';
  $('openMission').focus();
};

try { const saved = JSON.parse(localStorage.getItem('liveOpsMissionLocation')); if (saved) selectLocation(saved, saved.name); } catch { /* no saved location */ }
refreshEvents();
setInterval(refreshEvents, REFRESH_MS);
