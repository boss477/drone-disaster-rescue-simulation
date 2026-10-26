# Project status and remaining work

Last audited: **26 October 2026**

This is the source-of-truth checklist for the rescue-drone project. “Verified” means the repository contains the implementation and it has been exercised locally or covered by automated tests. Real incident data, AI detections, simulated flight, and physical hardware evidence are kept separate.

## Current result

The repository is a **software demonstration platform** with an automatic 3D rescue demo and a separate manual mission workflow. The default world view uses NASA-AMMOS 3DTilesRendererJS with Three.js and OpenStreetMap imagery. Optional hosted terrain/buildings use the existing public Cesium ion token. The Cesium reference view and mission controller remain available. It combines disaster-scene classification, recorded-footage person detection, rescue workflow, QGroundControl-compatible MAVLink telemetry, a receive-only SITL path, mission evidence, and replay.

It is **not yet a validated real rescue drone**. AI evaluation and real PX4/Gazebo SITL are complete, but repeatable latch hardware evidence and physical position feedback are still required.

## Implemented and verified

| Area | Current implementation | Evidence / entry point |
| --- | --- | --- |
| Disaster classification | Zero-shot CLIP categories: flood, fire, earthquake damage, landslide, storm damage, normal and uncertain | `disaster_zero_shot.py`, `image_upload_demo.py` |
| Unified browser AI review | One upload or camera frame runs CLIP and YOLO, shows all scores and annotated person candidates, and records the review against an operator-selected map area; actual photo detections remain distinct from scripted rooftop people | `vision_service.py`, `earth_rescue_vision.js`, `tests/earth_vision_browser_check.py` |
| India climate training | Fictional Karnataka aid mission illustrates possible monsoon stress, dry ground and fire-risk markers; Peru wet and Indonesia dry alternatives; source linked, no live El Niño forecast claimed | **Climate training scenario**, `tests/earth_fast_climate_browser_check.py` |
| Fast startup | NASA local actors start while OSM imagery streams; Cesium reference starts with a schematic grid; neither waits for optional ion assets. 1×/2×/4× scripted playback, concurrent AI inference and identical-image result reuse | `earth_rescue.js`, `vision_service.py` |
| NASA world renderer | Default Three.js world uses NASA-AMMOS 3DTilesRendererJS 0.5.3, streamed OSM imagery, optional hosted terrain/buildings, custom georeferenced tilesets and ODM mesh/point-cloud loading; existing mission actors remain synchronized | `world/nasa_world.js`, bundled `vendor/nasa-world.js`, `tests/nasa_world_browser_check.py` |
| First-run model handling | Friendly cache check, first-use download, repository-local reuse and offline mode | `./setup.ps1`, `py disaster_zero_shot.py --check` |
| Basic 3D rescue | Bundled Three.js flood scene, slow drone, people, package loading/unloading, pause/reset/complete states | `./run_rescue_simulation.ps1` |
| Live map context | OpenStreetMap, NASA EONET events and Open-Meteo weather with timestamps/source warnings | `./run_live_operations.ps1` |
| Operator workflow | Confirm/reject candidate, success/abort scenarios, independent release approval and blocked unsafe release | `./run_earth_rescue.ps1` |
| Complete 3D rescue demo | Terrain-aware local drone, flooded settlement, three rooftop people, sequential package unloading, takeoff/landing, automatic demo success/abort, overview/follow camera and HUD | **Run 3D rescue demo**, `tests/earth_rescue_mission_browser_check.py` |
| Detailed Earth view | Enable Detailed Earth for Cesium terrain, OSM map tiles and 3D buildings using the public demo token; browser-session override remains available | `earth_rescue.js`, token field in `earth_rescue.html` |
| Sensor degradation | Switchable camera noise, rain, fog, GPS jitter, scripted wind drift, telemetry delay and false AI alert; effects are logged and do not command PX4 | **Sensor degradation** in `earth_rescue.html` |
| ODM dashboard integration | Read-only external-data loader for orthophoto, DSM visualization, point-cloud and textured-mesh layers | `odm/manifest.example.json`, `./run_earth_rescue.ps1 -OdmRoot <folder>` |
| Mission evidence | Timestamped decisions plus half-second position, altitude, heading, battery, phase and package samples | **Download JSON** in the dashboard |
| Mission replay | Replays a saved mission route, phase, battery and delivery count at 2× without sending commands | **Replay a mission JSON** in the dashboard |
| Recorded footage AI | YOLO person candidates from a video/camera; explicit confirm/reject; CSV evidence | `./run_recorded_footage.ps1 <video>` |
| AI evaluation | Held-out YOLO-format evaluator reports TP, FP, FN, precision, recall and FPS | `evaluate_aerial_people.py` |
| Dataset provenance | Records external dataset source, version, license, split counts and an inventory digest; blocks train/validation filename overlap | `dataset_manifest.py` |
| Aerial reconstruction | Official OpenDroneMap processed 18 GPS-tagged sample images into verified GeoTIFFs, LAZ, textured OBJ/GLB, map tiles and mesh tiles; Py3DTiles produced point-cloud tiles after ODM's Entwine converter failed | `run_open_dronemap.ps1`, `verify_odm_outputs.py`, `convert_odm_pointcloud.py` |
| QGroundControl output | MAVLink position, battery, progress, people, packages, candidate and release-approval values | `mavlink_bridge.py`, UDP 14550 |
| Autopilot input | Receive-only PX4/ArduPilot telemetry drives Cesium position, heading, battery, mode, armed and GPS state | `sitl_telemetry_adapter.py` |
| Real autopilot simulation | PX4 v1.17.0 X500 in Gazebo Harmonic on Ubuntu 24.04 WSL; QGroundControl plus takeoff/RTL, geofence, low-battery and GPS-loss checks | `evaluation_results/px4_sitl_v1_17_verification.json` |
| No-autopilot integration demo | A clearly labelled mock MAVLink source verifies the receive path; it is not flight dynamics or an autopilot | `./run_all_demo.ps1 -MockSitl` |
| Nano latch protocol | 9600-baud `R`/`L` protocol and status acknowledgement; software release gate requires confirmation and explicit hardware enablement | `rescue_nano/rescue_nano.ino`, `rescue_laptop.py` |
| Repository safety | Loopback server, no committed model weights, public demo Cesium token, simulation labels and SITL command guards | automated tests and `.gitignore` |

## Run the working demonstrations now

### Fastest full software demo

```powershell
./setup.ps1 -Mavlink
./run_all_demo.ps1 -MockSitl
```

In the browser choose **Follow PX4 / ArduPilot SITL telemetry**, confirm the simulated candidate, start the mission, then approve or abort the release. Open QGroundControl to inspect UDP 14550 telemetry.

### No MAVLink or QGroundControl

```powershell
./run_earth_rescue.ps1
```

The scripted mission works immediately. Cesium terrain and 3D buildings load with the committed public demo token; the OpenStreetMap base globe also works without it.

### Verify the repository

```powershell
node --check earth_rescue.js
py -m unittest discover -s tests -q
```

The latest local audit passed **100 tests**. Earlier successful, required-abort and degraded-sensor dashboard workflows were exercised in Chromium, and real PX4 telemetry was received by both the Windows adapter port and QGroundControl. The sample ODM layers were loaded in Chromium with Cesium terrain and 3D buildings in those earlier checks.

On 26 October, the India climate demo completed all three deliveries at 4× using real elapsed time. A browser test kept ion asset requests pending and verified startup within two seconds after CesiumJS loaded. It also checked zero ellipsoid ground heights, a visible drone after switching regions, and wet/dry regional effects. Actual cached CLIP + YOLO inference classified the sample as flood and detected one possible person: 35.05 seconds including the first Python model load after restart, then 0.03 seconds when the identical image result was reused. These timings describe this PC and this image, not general accuracy or latency guarantees.

The complete 3D rescue demo was also checked in Chrome: three sequential deliveries and landing, unsafe-zone abort with no release, terrain clearance, pause, and manual approval gating. The camera-frustum rendering regression and safe-map fallback have a separate browser check. These are software simulation checks; the physical latch still needs the bench evidence below.

The NASA renderer integration was checked against streamed OSM map imagery and a
generated synthetic georeferenced glTF tile, including custom loading/clearing,
ODM manifest mesh selection, whole-Earth view, reference-renderer switching and a
complete India mission. An additional live check loaded visible Cesium terrain
and OSM building tiles through NASA's renderer; the Dubai tower was visually
inspected. No actual ODM dataset was available on this PC for the new NASA path,
so that integration uses the synthetic manifest fixture rather than claiming a
survey-specific verification. The 100 Python tests and separate reference-view
mission/rendering checks also passed.

## Work still required

### 1. Real AI measurements — person and flood classifiers measured

- **Done (24 October 2026):** stock `yolov8n` was evaluated on the held-out VisDrone2019-DET validation split (548 images, 13,969 people). Result: **recall 7.4% at 640 px and 21.6% at 1280 px, precision about 75-79%**.
- **Done (24 October 2026):** an externally pretrained VisDrone YOLO11s checkpoint was checksum-verified and evaluated unchanged on the same split. At 640 px it reached **39.4% recall and 66.3% precision at 1.8 FPS on CPU**. No project training was performed.
- **Done (24 October 2026):** pretrained zero-shot CLIP was evaluated unchanged on 398 labelled FloodNet Track 1 images. It reached **79.9% six-category accuracy, 82.9% flood precision and 56.9% flood recall at 1.07 images/s on CPU**. No project training was performed.
- Both models remain operator-confirmed candidate generators. The better aerial model still misses about 61% of labelled people. Full details, provenance and limits: `evaluation_results/README.md`.
- CLIP still classifies the overall scene; it does not draw flood boundaries. It missed 22 of 51 flooded scenes, so it cannot verify that an area is safe or flood-free.

### 2. Full autopilot simulation — completed for PX4/Gazebo

- **Done (25 October 2026):** installed a dedicated D-drive-backed Ubuntu 24.04 WSL distribution named `Ubuntu-24.04-PX4` and built PX4 v1.17.0 (1,141/1,141 targets).
- **Done:** launched the Gazebo Harmonic X500, received real PX4 MAVLink on Windows UDP 14540, and connected QGroundControl on UDP 14550 with a valid heartbeat and zero receive loss.
- **Done:** verified takeoff and return-to-home, vertical geofence breach, accelerated low battery, and live GPS loss followed by PX4 failsafe landing.
- **Done:** exercised the operator-approved delivery and unsafe-drop-zone abort dashboard workflows. These remain operator-workflow simulations and do not command PX4.
- Machine-readable results and limitations are in `evaluation_results/px4_sitl_v1_17_verification.json`.
- Start it with `./run_all_demo.ps1 -WithSitl -SitlFlavor px4`; the launcher auto-selects the supported WSL distribution and routes telemetry from WSL to Windows.

### 3. Physical latch validation — blocked on hardware evidence

- Power the MG90S from a stable external 5 V supply; join supply ground to Nano ground.
- Keep the control signal on Nano D6 and serial at 9600 baud.
- Add a latch-position feedback switch/sensor. A command acknowledgement alone does not prove physical movement.
- Run at least **100 loaded bench cycles** and record command, acknowledgement, observed position, elapsed time and failure reason.
- Test only on a bench with propellers removed. Real-flight control is outside this repository’s validated scope.

### 4. Cesium enhancement — tested locally

- A public demo Cesium ion token is committed in `earth_rescue.js` at the project owner's request, so hosted terrain and OSM 3D buildings start automatically.
- The token is visible to anyone with repository access. Limit its Cesium ion permissions and replace or revoke it if needed. The basic OpenStreetMap globe works without it.

## Explicitly not required

- A promotional/demo video is no longer part of the requested scope.
- A Google Maps or Google Earth paid API is not required.
- Training a disaster classifier dataset is not required for the current zero-shot CLIP mode.
- Connecting to or commanding a real aircraft is not required and has not been validated.

## Recommended completion order

1. Run and preserve one successful and one aborted mock-MAVLink mission log.
2. Add the held-out aerial dataset and publish evaluation results.
3. Finish servo power/feedback and complete 100 documented bench cycles.
4. Keep the sample OpenDroneMap data on D: and re-run the verifier after any new survey.
5. Use the optional Cesium token in the dashboard for hosted 3D context; it does not affect core correctness.

## Completion definition

Call the project “validated” only when all of these are true:

- Fresh-clone setup and all automated tests pass.
- A fixed held-out dataset has published AI metrics and failure examples.
- Successful and aborted missions are repeated in real SITL with saved logs.
- QGroundControl displays expected telemetry and safety scenarios are documented.
- The latch completes 100 loaded cycles with physical position feedback and recorded outcomes.
- No API key, large model, private dataset or generated mission log is committed accidentally.

Until then, present it honestly as a **simulation and operator-workflow prototype**.
