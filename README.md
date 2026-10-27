# Drone Disaster Rescue Simulation

> **SIMULATION ONLY.** The flood-rescue simulation, the telemetry bridge and the image classifier never control a real drone, motor or flight controller. All people, packages and deliveries in the 3D scene are simulated. Image-classifier output is an AI estimate, not a verified emergency decision.

**Project status:** the no-key software demo, operator workflow, mission logs/replay, measured pretrained AI models, QGroundControl output, real PX4/Gazebo SITL validation, and sample OpenDroneMap reconstruction are implemented. The 100 physical latch cycles still require hardware evidence. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the audited checklist, exact run commands and finish plan. A demo video is not part of the required scope.

This repository intentionally integrates established projects instead of rebuilding them. See [UPSTREAM_INTEGRATIONS.md](UPSTREAM_INTEGRATIONS.md) for the PX4, QGroundControl, Ultralytics and OpenDroneMap boundaries plus the exact teammate handoff.

This repository contains three independent parts plus an optional Raspberry Pi crack-inspection payload:

| Part | What it does | Run |
| --- | --- | --- |
| Disaster image classifier | Zero-shot CLIP: flood / fire / earthquake damage / landslide / storm damage / normal | `py disaster_zero_shot.py samples/flood_street.jpg` or `py image_upload_demo.py` |
| 3D rescue simulation | Slow drone, flooded buildings, simulated rooftop people, package inventory | `./run_rescue_simulation.ps1` |
| Live disaster operations map | Real OpenStreetMap geography, live weather and active wildfire/flood/storm records; simulated mission origin | `./run_live_operations.ps1` |
| Operator-controlled 3D rescue | No-key OpenStreetMap globe, optional Cesium terrain/buildings, live context, successful/aborted missions and evidence log | `./run_earth_rescue.ps1` |
| QGroundControl telemetry (SITL-only) | Streams the simulated mission over UDP MAVLink | `./run_all_demo.ps1` |
| Wall-crack payload (Pi / laptop) | Perception payload, needs optional `.pth` files | see further below |

## Detailed fictional rescue neighbourhood

**Main globe workflow:** run `./run_gods_eye_rescue.ps1` and open `http://127.0.0.1:4173`. The full upstream God's Eye View app runs with a rescue operations panel: select a NASA/USGS report or globe marker, review a photo using CLIP + YOLO, attach its estimates, then **Enter 3D rescue mission**. Harbour Ward opens inside the same app; return to the preserved globe after delivery or abort. The launcher starts or reuses the local backend automatically. Native upstream data layers, weather, camera and display controls remain available. See the [God's Eye View guide](docs/GODS_EYE_RESCUE.md) for installation, provider limits and verification.

**New York 3D:** open `http://127.0.0.1:4173/?nyc=1` or press **New York · 3D buildings**. Lower Manhattan, Midtown and citywide views stream real building geometry. The curated NYC asset requires access in your Cesium ion account; if unavailable, the app explicitly shows the working OSM building layer instead. The [guide](docs/GODS_EYE_RESCUE.md#new-york-3d-buildings) explains activation and the asset-ID field. Building shapes are untextured and do not represent live damage.

**Fly inside the real city view:** frame a neighbourhood, then press **Fly drone through this area**. An original animated quadcopter flies a simulated rooftop loop in the same Cesium building scene, with follow/free camera, pause/resume, reset and 4/8/16 m/s speed. It loads the local terrain and imagery, samples model heights and sets an elevated route. The scripted route is not validated flight planning or autopilot/SITL control; no hardware or payload commands are sent. The Queens example opens at `http://127.0.0.1:4173/?drone=1&flightLat=40.6937&flightLon=-73.7814`. Rebuild the bundled model with `npm run build:drone` after editing `scripts/build_city_drone.mjs`.

Open [Harbour Ward](fictional_rescue.html) from the Earth dashboard, or run:

```powershell
py -m http.server 8877 --bind 127.0.0.1
```

Visit `http://127.0.0.1:8877/fictional_rescue.html`. If the existing demo server already uses 8877, just open that URL; do not start a second server.

This compact fictional district includes textured building facades, balconies, rooftop equipment, roads, cars, trees, surrounding hills and animated floodwater. Start the mission to load three packs, fly to the rooftop refuge, lower each pack and return to the depot. Pause/resume, reset, 1×/2×/4× speed and district/street/rooftop/follow cameras are available. Drag to orbit, scroll to zoom and right-drag to pan.

All people, scenery, floodwater and aid deliveries are fictional. This page sends no hardware commands and needs no map token or external assets. It is a game-style training scene, not a reconstruction of any real incident or an AAA game environment. Geometry and textures are generated locally; the bundled Three.js runtime retains its [MIT license](vendor/licenses/THREE-LICENSE.txt).

The ready-to-run bundle is committed. To edit the scene, change `world/fictional_rescue.js`, then run `npm ci` and `npm run build:fictional`. Browser verification: `py tests/fictional_rescue_browser_check.py` with the local server running.

## Quick start (Windows, fresh clone)

```powershell
git clone https://github.com/boss477/drone-disaster-rescue-simulation
cd drone-disaster-rescue-simulation
./setup.ps1                 # creates .venv, installs requirements-demo.txt, checks the install
./setup.ps1 -Mavlink        # add this flag if you want the QGroundControl bridge
```

If PowerShell blocks scripts, run once: `Set-ExecutionPolicy -Scope Process Bypass`.

`./setup.ps1 -DownloadModel` fetches the CLIP model right away; otherwise it downloads on first use.
Everything is relative to the repository folder; the `.ps1` scripts use `.venv` automatically.
Run the tests with `py -m unittest discover -s tests -t .` (use `.venv\Scripts\python` after setup).

## Disaster image classifier (CLIP, zero-shot)

Uses a pretrained CLIP model, no project-specific training data. The six categories are
flood, fire, earthquake damage, landslide, storm damage and normal scene.

```powershell
py disaster_zero_shot.py samples/flood_street.jpg      # CLI: one image
py disaster_zero_shot.py path\to\folder --csv out.csv   # CLI: a folder, optional CSV
py image_upload_demo.py                                 # GUI: pick an image
py disaster_zero_shot.py --check                        # are dependencies / model cache present?
```

- Output shows the predicted category, its confidence and **all** category scores, labelled as an **AI estimate**.
  Predictions are flagged **UNCERTAIN** when the top score is below 40% or the runner-up is within 10 points.
- **First use:** if the model is not cached you get a friendly notice, then it downloads once (about 600 MB, internet needed)
  into `models/hf_cache/` inside the repository. Later runs reuse that cache and work offline.
  Add `--offline` to refuse downloading. If packages are missing, the tools tell you to run `./setup.ps1`.
- Scores are relative text-image matches, not calibrated probabilities or measured accuracy.

## 3D rescue simulation

```powershell
./run_rescue_simulation.ps1        # starts a local server on 127.0.0.1:8765 and opens the browser
```

Browsers block the bundled Three.js module when a page is opened by double-clicking the `.html` file, so the
script serves the repository locally (`sim_server.py`, loopback only). If you open the file directly you will see a
message explaining this. Three.js r180 is bundled in `vendor/` (`three.module.js` + `three.core.js`); nothing is loaded from the internet.

### User guide

1. Press **Start mission** (or Space). The drone is loaded with 6 simulated packages one by one, takes off slowly and visits four rooftops.
2. At each rooftop it **descends, scans for simulated people** (counter goes up, ring turns green), **unloads one package** (it drops onto the roof) and climbs away.
3. After the fourth delivery it **returns to base and lands**; a **Mission complete** panel appears. Counters show people detected, deliveries, packages onboard and a simulated battery.
4. **Pause / Resume** (button or Space) freezes the mission; **Reset** returns everything to the start; **Run again** restarts after completion.
5. Drag to orbit, mouse wheel to zoom.

Everything is labelled: the HUD says *simulation only*, and each person and the drone carry a "SIMULATED" tag.
Mission data (sites, speeds, inventory) lives in `sim/mission.json`; the same file drives the telemetry bridge.

## Live disaster operations map (real public data)

```powershell
./run_live_operations.ps1
```

This opens a real-world OpenStreetMap base map with live location weather and currently open wildfire, flood and severe-storm records from NASA EONET. Click a real event or any location to see weather and select it as the origin for the **simulated** drone mission. Then choose **Use as simulated mission area** and open the 3D mission. QGroundControl telemetry will appear around that chosen latitude/longitude when the browser mission is running, but it is still generated simulation data.

- The live map requires internet access. It uses map tiles only for the current interactive view—there is no prefetching or bulk download.
- Event geometry and timestamps are source data, not a live emergency command, precise flood boundary, evacuation instruction or flight clearance.
- NASA EONET event records, Open-Meteo weather and OpenStreetMap tiles can be temporarily unavailable. The page shows a timestamp/error rather than reusing an unlabelled stale result.
- For a fully offline exhibition, use a licensed offline map-data provider or self-hosted tiles; do not bulk-download `tile.openstreetmap.org`.

## Operator-controlled 3D rescue mission

For the complete visual demonstration, click **Run 3D rescue demo** at the top of the dashboard, or open `earth_rescue.html?demo=1` on the local server. It creates a simulated flooded settlement on real Cesium terrain, three rooftop people, a local 3D quadcopter and three aid packages. Watch loading, takeoff, approach, descent, simulated review, sequential unloading, return and landing. Choose **Unsafe zone: abort and return** to keep every package onboard. Use **Overview**, **Follow the drone**, **Pause** and **Reset** to inspect the flight.

Automatic demo decisions are labelled and logged as simulated. The regular mission controls below still require explicit target confirmation and release approval. Ground heights are sampled along the route so the drone, buildings and dropped packages appear above terrain; if sampling is unavailable, the view uses currently loaded terrain heights. The added buildings and flood surface are training geometry, not evidence of a real flood at that location. The demo runs entirely in the browser and uses no physical servo or aircraft connection. Check success, abort, terrain clearance, pause and manual approval with `py tests/earth_rescue_mission_browser_check.py` while the local server is running (requires Playwright and Chrome).

Start the local server with `./run_earth_rescue.ps1`, then open `http://127.0.0.1:8765/earth_rescue.html`. Select an incident or map location, review the simulated AI candidate, confirm it, and choose either the successful or aborted scenario. The drone loads, flies to one marked delivery zone and holds. A successful mission requires a separate operator release approval; the abort scenario blocks release and returns with the package. Every decision and a half-second position timeline appear in a downloadable timestamped JSON evidence log. Load that JSON with **Replay a mission JSON** to reproduce the route, phases, battery and delivery count at 2× speed without sending telemetry or commands. The bridge can mirror the live simulated position, target-confirmation state and operator approval to QGroundControl.

The **Aircraft position source** selector has two modes. The default scripted mode is self-contained. **Follow PX4 / ArduPilot SITL telemetry** reads latitude, longitude, relative altitude, heading, battery, flight mode, armed state and GPS quality from `/api/autopilot`; launch stays blocked until a live simulator feed exists. Selecting it uses the current SITL position as mission home. Fly the virtual vehicle using QGroundControl: arrival is recognized within 30 m of the drop zone, and return completes within 30 m of home below 15 m relative altitude. The mission decision workflow remains operator-controlled and simulated; this adapter sends no flight commands.

The default NASA world streams worldwide terrain and mapped 3D buildings automatically, using the public demo token committed in `earth_rescue.js` at the project owner's request. Turn off **3D terrain & buildings** or add `?quality=fast` for a lighter view. You can override the token using the dashboard field; overrides stay in browser session storage. Terrain and building detail varies by location, and public services require an internet connection. The drone, candidate person, route, package release and QGroundControl position are simulation only. Incident and weather layers are public informational context with source delays and do not provide flight clearance or emergency instructions.

After enabling Cesium 3D, use the preset buttons for an angled **Vancouver city + mountains**, **Dubai skyline**, or **Everest mountains** view. These are visualization presets; building and terrain detail depends on streamed Cesium coverage.

The dashboard guards against an invalid Cesium camera near-plane. If hosted 3D still encounters a rendering error, it resets the simulated mission and falls back to the basic OpenStreetMap globe; **Reload 3D** retries hosted terrain and buildings. To run the browser regression check with Playwright and a local dashboard server running, use `py tests/earth_render_browser_check.py`.

The **Sensor degradation** panel can independently inject camera noise, rain, fog, weak-GPS jitter, scripted wind drift, a two-second telemetry delay and a clearly labelled false AI alert. Effects are recorded in mission JSON. They degrade only the visualization and reported simulation telemetry; they do not alter PX4 state or send flight commands.

## Recorded footage and measurable person detection

Install `requirements-hardware.txt`, then run `./run_recorded_footage.ps1 path\to\video.mp4`. YOLO marks possible people, but the operator must press `c` to confirm or `x` to reject. No hardware command is sent in this mode. The program records candidate, confirmation, rejection, blocked-release and latch-status events in `mission_logs/`.

For a held-out VisDrone subset converted to YOLO format, measure precision, recall, missed people, false alarms and processing speed:

```powershell
py evaluate_aerial_people.py --images path\to\images --labels path\to\labels --output aerial_people_evaluation.csv
```

Keep the evaluation images separate from training images and report the model, confidence threshold and IoU threshold with the results. VisDrone classes `0` (pedestrian) and `1` (people) are treated as one person category by default.

### No-training pretrained model option

The project can use a VisDrone-fine-tuned YOLO11s checkpoint as-is; no local training is required. Store all large assets outside Git (for example on D:):

```powershell
./download_pretrained_assets.ps1 -AssetRoot D:\DroneRescueData -IncludeFloodNet
```

The download registry records source, license, expected checksum and person-class mapping in `pretrained_assets.json`. Run the pretrained aerial model on recorded footage:

```powershell
./run_recorded_footage.ps1 path\to\video.mp4 --model D:\DroneRescueData\models\yolo11s-visdrone-best.pt --person-classes 0,1
```

Evaluate it on the untouched VisDrone validation conversion:

```powershell
py evaluate_aerial_people.py --images D:\DroneRescueData\datasets\visdrone_val_yolo\images --labels D:\DroneRescueData\datasets\visdrone_val_yolo\labels --model D:\DroneRescueData\models\yolo11s-visdrone-best.pt --prediction-classes 0,1 --imgsz 640 --output D:\DroneRescueData\evaluation\yolo11s_visdrone.csv
```

To put the CLIP cache on the external drive too, set `DRONE_RESCUE_DATA_ROOT=D:\DroneRescueData` before running the classifier. Model and dataset artifacts are never committed.

For a labelled flood/normal or multi-disaster CSV containing `image,label`, evaluate the existing pretrained CLIP model without training:

```powershell
$env:DRONE_RESCUE_DATA_ROOT='D:\DroneRescueData'
py build_floodnet_manifest.py --dataset D:\DroneRescueData\datasets\FloodNetTrack1Labeled --output D:\DroneRescueData\evaluation\floodnet_track1_labeled.csv
py evaluate_disaster_dataset.py --manifest D:\DroneRescueData\evaluation\floodnet_track1_labeled.csv --image-root D:\DroneRescueData\datasets\FloodNetTrack1Labeled --output-dir D:\DroneRescueData\evaluation\clip_floodnet
```

This writes per-image predictions plus accuracy, class support and a full confusion matrix. The measured FloodNet Track 1 labelled subset result is **79.9% six-category accuracy, 82.9% flood precision and 56.9% flood recall** on 398 images. See `evaluation_results/README.md` for provenance and limitations. Do not report accuracy from a one-class test set; a flood-only collection can measure recall but cannot measure false alarms on normal scenes.

Record the external dataset's source, license, version and split before evaluation:

```powershell
py dataset_manifest.py path\to\dataset --name VisDrone --version 2019 --source-url https://github.com/VisDrone/VisDrone-Dataset --license "verify with dataset publisher"
```

The dataset directory must contain separate `train/` and `val/` folders. The tool refuses identical relative image names across those splits and writes only a small ignored manifest; it never copies dataset images into Git.

## OpenDroneMap survey processing

This repository uses the official [OpenDroneMap](https://github.com/OpenDroneMap/ODM) Docker image rather than implementing photogrammetry. Requires Docker Desktop. Photos and every output stay **outside Git**, by default under `D:\DroneRescueData\odm\`; the launcher refuses a dataset folder inside this repository.

**Sample dataset (not disaster data).** `odm_sample_dataset.json` records the source commit, verified BSD-2-Clause license, image count and expected path of the OpenDroneMap *Brighton Beach* sample (18 locally verified GPS-tagged DJI JPGs, about 62 MB). It is sample imagery for testing the pipeline, **not live disaster data**. The verified local images are in `D:\DroneRescueData\odm\brighton_beach_odm\images`; to reproduce the run:

```powershell
./run_open_dronemap.ps1 -ProjectName brighton_beach_odm -DryRun # check paths, print the Docker command
./run_open_dronemap.ps1 -ProjectName brighton_beach_odm         # run ODM (-DetailedModel for a finer orthophoto)
py verify_odm_outputs.py --project-dir D:\DroneRescueData\odm\brighton_beach_odm
```

The verifier reports existence, size and path of the four products and exits non-zero if any is missing or not the right file type: orthophoto GeoTIFF (`odm_orthophoto/odm_orthophoto.tif`), DSM GeoTIFF (`odm_dem/dsm.tif`), georeferenced point cloud (`odm_georeferencing/odm_georeferenced_model.laz`) and textured OBJ (`odm_texturing/odm_textured_model_geo.obj`). Use `-DatasetRoot` for another location. The products are reconstructions of supplied imagery, never live disaster evidence.

The launcher also requests browser-ready map tiles, 3D Tiles and GLB output. ODM 3.6.2 generated the mesh tiles but its bundled Entwine converter failed on this sample's point cloud. An optional fallback uses Py3DTiles:

```powershell
py -m pip install -r requirements-odm-pointcloud.txt
py convert_odm_pointcloud.py --project-dir D:\DroneRescueData\odm\brighton_beach_odm
```

The fallback reads the LAZ coordinate system, converts to Earth-centered coordinates, and scales its 8-bit colors for display. It skips a completed tileset and refuses output inside the repository. Copy `odm/manifest.example.json` to `D:\DroneRescueData\odm\manifest.json`, adjust its project name and coordinates if needed, and run:

```powershell
./run_earth_rescue.ps1 -OdmRoot D:\DroneRescueData\odm
```

Press **Load ODM** to load the selected survey products (NASA: tiled mesh or point cloud; reference view: orthophoto, DSM overlay and 3D layers). The DSM overlay is a color visualization, not geometric terrain. The local server exposes only the configured ODM directory at `/odm-data/`; parent folders remain inaccessible. Hosted terrain and buildings are enabled by default. To use your own token, paste it into the dashboard's password field and click **Reload 3D**; that override stays in your browser session.

## QGroundControl-compatible telemetry (SITL / simulation only)

```
3D flood simulation (browser)
        |  POST /api/state (localhost)
        v
sim_server.py  --->  mavlink_bridge.py  --UDP MAVLink-->  QGroundControl (UDP 14550)
                                              (optional)  PX4/ArduPilot SITL
```

**Safety rules**

- Nothing connects to real hardware. The bridge is **send-only telemetry by default** and never reads or obeys incoming commands.
- It announces itself as a virtual quadcopter (system id 42) that is **never armed**.
- Arm / takeoff / land commands exist only for a **local PX4/ArduPilot SITL** and are refused unless **all** of these hold:
  `"mode": "sitl"` and `"sitl.enabled": true` in `mavlink_config.json`, the `--enable-sitl-commands` flag, and a loopback (`127.0.0.1`) endpoint.
  This SITL command path is covered by safety-guard unit tests but has not been run against a live PX4/ArduPilot here.
- Do not connect this project to a real drone until flight control, failsafes, geofence, battery and emergency-stop behaviour have been tested separately.

**What is sent** (MAVLink common messages, 4 Hz, heartbeat as part of each update): `HEARTBEAT`, `GLOBAL_POSITION_INT` and `GPS_RAW_INT`
(simulated position and altitude, around a configurable home point), `ATTITUDE`, `VFR_HUD`, `SYS_STATUS` and `BATTERY_STATUS` (battery),
`MISSION_CURRENT` and `MISSION_ITEM_REACHED` (mission progress), `NAMED_VALUE_INT` (`PEOPLE`, `DELIVERED`, `ONBOARD`, `PROGRESS`) and `STATUSTEXT`
messages such as "[SIM] simulated package 2 delivered".

### Connect QGroundControl

1. Install the optional dependency: `./setup.ps1 -Mavlink`.
2. Install QGroundControl from <https://qgroundcontrol.com> (optional; any MAVLink GCS on UDP 14550 works).
3. Start everything: `./run_all_demo.ps1` (opens the simulation and the bridge). Click **Start mission** in the browser.
4. Open QGroundControl. It listens on UDP port 14550 by default, so **Vehicle 42** appears automatically with live position, altitude, battery and mission progress.
   Custom values (`PEOPLE`, `DELIVERED`, `TARGET_OK`, `APPROVED`) are visible under *Analyze Tools > MAVLink Inspector*; status messages show in the notification area.
5. Different port or a GCS on another computer? Edit `qgc.host` / `qgc.udp_port` in `mavlink_config.json`
   (in QGroundControl: *Application Settings > Comm Links* to add a UDP link on that port).

Start the pieces separately if you prefer:

```powershell
./start_visual_sim.ps1             # a. 3D visual simulation
./start_mavlink_bridge.ps1         # b. telemetry bridge (-DryRun prints without sockets, -Standalone ignores the browser)
./start_sitl.ps1                   # c. PX4/ArduPilot SITL in supported Ubuntu WSL2; set PX4_AUTOPILOT_DIR or ARDUPILOT_DIR
./start_sitl_telemetry.ps1         # d. receive-only SITL -> Cesium position adapter
```

For the integrated path, run `./run_all_demo.ps1 -WithSitl -SitlFlavor px4` (or `ardupilot`). The launcher prefers `Ubuntu-24.04-PX4`, then another installed Ubuntu 24.04/22.04 distribution; set `SITL_WSL_DISTRO` or pass `-Distro` to override it. It detects the Windows host address and routes PX4 telemetry to the dashboard on UDP 14540 and QGroundControl on UDP 14550. ArduPilot uses UDP 14541 for the dashboard. Pass `-NoWindowsUdpForward` only when the consumer runs inside WSL. The adapter never sends commands to the autopilot.

The verified local configuration is PX4 v1.17.0 with Gazebo Harmonic's X500 on Ubuntu 24.04 WSL. Measured takeoff/RTL, geofence, low-battery, GPS-loss, dashboard success/abort and QGroundControl connection evidence is recorded in `evaluation_results/px4_sitl_v1_17_verification.json`. All of those tests are simulation-only.

To verify the full MAVLink receive path without installing an autopilot, run `./run_all_demo.ps1 -MockSitl`. The clearly labelled mock source sends a repeating takeoff → 500 m northbound → hold → return → land telemetry sequence on UDP 14540. It is useful for the presentation and integration tests, but it is not flight dynamics, PX4, or ArduPilot.

If the browser page is closed the bridge falls back to a built-in copy of the same mission so QGroundControl still shows a flight.

## Nano servo + laptop camera prototype

The hardware prototype is in `rescue_nano/rescue_nano.ino` and
`rescue_laptop.py`. Live hardware mode requires an Arduino Nano, servo, camera,
and a real serial port; GPS is optional. Install the Arduino `Servo`, `SoftwareSerial`, and
`TinyGPSPlus` libraries, select Nano / ATmega328P (Old Bootloader if needed),
upload the sketch, and use Serial Monitor at 9600 baud. Send `R` to release and
`L` to lock. Connect the servo signal wire to Nano D6.

For a continuous wiring-only bench check, upload `servo_sweep_d6/servo_sweep_d6.ino`. It moves the MG90S between 45° and 135° every two seconds on D6 and prints each command at 9600 baud. Test with propellers removed and do not attach a payload until the unloaded sweep is reliable.

For the laptop side:

```powershell
py -m pip install -r requirements-hardware.txt
py rescue_laptop.py                                      # camera, vision-only
./run_recorded_footage.ps1 samples\your_aerial_video.mp4 # recorded footage, vision-only
py rescue_laptop.py --port COM3 --enable-hardware-release # explicit bench-hardware mode
```

After a person remains visible for 15 frames, the program creates a candidate; it does not release automatically. Press `c` to confirm or `x` to reject. Press `r` to request release, `l` to lock, and `q` to quit. A hardware release is allowed only when the candidate was confirmed, `--enable-hardware-release` was supplied, and the serial connection is open. Timestamped CSV evidence logs are written to `mission_logs/`. The hardware path cannot be verified without the Nano and servo connected. Test with the servo unloaded and propellers disconnected.
With a real SITL running, SITL itself already reports to QGroundControl on 14550; the bridge appears as a second vehicle (id 42).

## Optional model files (`.pth`)

Large model files are **not in Git** (`.gitignore` excludes `models/*.pth`, `models/hf_cache/`). Only the Raspberry Pi / laptop
crack-inspection payload needs them; place them in `models/` as described in [models/README.md](models/README.md):
`wall_detector_model.pth`, `master_crack_model.pth` and (optional) `ssdlite320_mobilenet_v3_large_coco.pth`.
The classifier, simulation and bridge work without them. `CHECKSUMS.sha256` lists the expected hashes.

---

# Raspberry Pi Wall Crack Inspection Payload

This folder turns the existing laptop demonstration into a self-contained Raspberry Pi payload demonstrator. It automatically reads a Pi Camera or USB webcam, pauses inspection when a person is present, rejects phones/laptops/TV screens in the scan area, checks whether the central region is a wall, and only then runs the crack classifier. It displays a live HUD and saves a CSV inspection log plus crack evidence images.

This is an autonomous **perception payload** demonstration. It does not control a drone, motors, navigation, or collision avoidance. That distinction is important during the exhibition.

## Processing flow

```text
Pi Camera / USB webcam
          |
          v
Person and screen safety gate ---- person -> pause and show PERSON DETECTED
          |
          v
Blur, light, and glare gate ------ poor view -> request a better view
          |
          v
ResNet18 wall classifier --------- not wall -> reject frame
          |
          v
ResNet50 crack classifier -------- crack / no crack / uncertain
          |
          v
HUD + CSV log + evidence image + optional LEDs/buzzer
```

The three model files are **not stored in Git**: place them in `models/` (see `models/README.md`). After that, inference does not need internet access.

## What was fixed

- Replaced the Windows-only `cv2.CAP_DSHOW` camera path with automatic Picamera2, Linux USB/V4L2, and Windows USB support.
- Added true COCO `person` detection and kept `cell phone`, `laptop`, and `tv` rejection. Person always has priority.
- Packaged the object detector weights locally; the demo does not download a model at startup.
- Added a face/full-body offline fallback if the COCO detector cannot load.
- Added blur, low-light, and glare checks so a poor camera frame is not labelled safe.
- Added temporal smoothing and an uncertainty band instead of forcing every frame into safe/cracked.
- Added automatic CSV logs and crack evidence captures.
- Added optional green LED, red LED, and buzzer outputs.
- Removed Windows paths and made all model/report paths relative to the project folder.
- Added automated tests for the decision logic.

## Recommended hardware

Use the hardware you already have before buying a webcam:

- Raspberry Pi 5 (preferred) or Raspberry Pi 4 with 4 GB or more
- Raspberry Pi Camera Module and the correct CSI ribbon cable for your Pi model
- Official-quality power supply, or a regulated power bank that matches the Pi's required voltage/current
- microSD card with Raspberry Pi OS 64-bit Desktop
- HDMI monitor for the exhibition, or VNC for setup
- Small ventilated payload box, standoffs, cable strain relief, and a camera opening
- Optional: two LEDs, two 220-330 ohm resistors, and a low-current active-buzzer module

A cheap USB webcam is not automatically better for cracks. Use the Pi Camera first. Buy a webcam only if your existing camera cannot focus at the required working distance or you need a separate laptop demo camera.

## Camera connection

1. Shut the Raspberry Pi down and disconnect power.
2. Find the connector labelled **CAMERA** or **CSI**. Do not use the similar display/DSI connector.
3. Lift the connector latch gently, insert the ribbon fully and straight, and close the latch. The correct contact orientation varies by Pi/cable, so follow the camera/board markings.
4. Mount the camera facing forward. Keep the ribbon away from sharp bends and add strain relief.
5. Connect HDMI and power, then boot Raspberry Pi OS.
6. Test the camera before installing the project:

```bash
rpicam-hello -t 5000
```

If that command fails, fix the camera connection first. The Python application cannot correct a cable or camera-stack problem.

For a USB webcam, connect it to USB and verify the index:

```bash
v4l2-ctl --list-devices
```

## Optional indicator wiring

The pin names below use **BCM numbering**, matching `payload_config.json`.

| Function | BCM GPIO | Physical pin | Connection |
|---|---:|---:|---|
| Green safe LED | GPIO17 | 11 | GPIO -> 220-330 ohm resistor -> LED anode; cathode -> GND |
| Red alert LED | GPIO27 | 13 | GPIO -> 220-330 ohm resistor -> LED anode; cathode -> GND |
| Buzzer module signal | GPIO22 | 15 | Signal pin only; wire VCC/GND according to the module |
| Ground | GND | 6 | Common ground |

Do not connect a high-current buzzer or motor directly to a GPIO pin. Use a suitable transistor/driver or a low-current buzzer module.

## Install on Raspberry Pi

Use Raspberry Pi OS 64-bit Desktop. Copy this complete folder to the Pi, for example to `/home/pi/raspberry_pi_payload`, using a USB drive, SCP, or a shared folder. Then run:

```bash
cd /home/pi/raspberry_pi_payload
chmod +x install_pi.sh run_payload.sh
./install_pi.sh
```

The installer uses Debian packages for Picamera2/OpenCV/GPIO access and creates a virtual environment for PyTorch/Torchvision. Internet is needed during this one-time installation, but not when running the demo later.

## Run the payload

Automatic camera selection and full-screen exhibition mode:

```bash
./run_payload.sh
```

Force the Pi Camera:

```bash
./run_payload.sh --camera pi
```

Force a USB webcam:

```bash
./run_payload.sh --camera usb --camera-index 0
```

Test a saved image without a camera:

```bash
./run_payload.sh --image samples/test_cracked.jpg
```

### Laptop camera mode

On Windows, use the laptop's built-in camera or a USB webcam:

```powershell
.\run_laptop.ps1
```

This starts the first rescue-drone demo. It detects a person and simulates the payload release on screen; no servo or GPIO is used. Hold a person in view until the status changes to `PAYLOAD RELEASE SIMULATED`. Press `r` to test a manual simulated release, and press `q` or `Esc` to quit.

The HUD also shows `Persons detected N`, which is the number of people currently visible to the detector.

The rescue demo displays `POSSIBLE BLOOD - PERSON MAY BE HARMED` when it sees a large red region inside a person box. This is only a color-based demo warning; it cannot confirm blood or injury and may detect red clothing or objects. Human verification is required.

If Windows assigns the camera another index:

```powershell
.\run_laptop.ps1 -CameraIndex 1
```

The equivalent direct command is `py payload_app.py --laptop-camera --rescue-demo`. When moving to the Raspberry Pi, use `./run_payload.sh --camera pi`; the laptop option does not change or remove the Pi Camera path.

### Image input mode

To test a saved image instead of the camera:

```powershell
.\run_image.ps1 .\samples\flood_street.jpg
```

Equivalent direct command:

```powershell
py payload_app.py --image .\samples\flood_street.jpg --rescue-demo
```

Controls:

- `q` or `Esc`: quit cleanly
- `s`: save a manual evidence image
- `f`: toggle full screen

Run with `--gpio` only after wiring and checking the optional indicators:

```bash
./run_payload.sh --gpio
```

## Optional laptop rehearsal

The same application can be rehearsed on Windows with a USB webcam. From PowerShell in this folder:

```powershell
python -m venv .venv-win
.\.venv-win\Scripts\python -m pip install torch torchvision opencv-python
.\.venv-win\Scripts\python payload_app.py --camera usb --camera-index 0
```

The Pi uses the included shell installer instead; do not copy the Windows virtual environment to the Pi.

## Exhibition setup

1. Place the payload on a stand or mock drone plate; keep the propellers/motors absent or disconnected.
2. Put the camera 30-80 cm from the sample wall, depending on lens focus and crack size.
3. Use bright, diffuse side lighting. Avoid a torch pointed directly at glossy paint.
4. Fill most of the central scan box with the wall. A thin crack occupying only a few pixels cannot be recovered by software.
5. Start with a person in view to show the safety pause.
6. Move the person away, show a non-wall object/screen, then show a clear wall and cracked-wall sample.
7. Press `s` for a manual screenshot if required. Logs appear in `inspection_reports/<session>/`.

Prepare three physical A4/A5 samples: a clean wall image, an obvious cracked-concrete image, and an uncertain/faint-crack image. Test the exact lighting, camera distance, and thresholds the day before the exhibition.

## Threshold tuning

Edit `payload_config.json`; do not edit the Python code for normal tuning.

- `wall_accept_threshold`: increase to reduce false wall detections; decrease if real walls are often rejected.
- `crack_alert_threshold`: decrease to detect more possible cracks, but expect more false alarms.
- `crack_safe_threshold`: keep clearly below the alert threshold so uncertain samples request a rescan.
- `blur_minimum`: decrease only if sharp images are incorrectly rejected.
- `classification_interval_frames`: increase on a slower Pi to keep the display responsive.
- `object_detection_interval_frames`: increase if person/object detection is too slow.
- `torch_threads`: use `4` for Pi 4/5 as a starting point.

The displayed values are neural-network scores, not calibrated probabilities. Tune thresholds using real Pi Camera captures, not the training images.

## Performance options

The supplied ResNet50 model is heavy for a Raspberry Pi. A Pi 5 may update the classification only a few times per second, and a Pi 4 may be slower. The live video remains responsive because model inference is intentionally skipped between frames.

If performance is poor:

1. Increase `classification_interval_frames` from `3` to `5` or `8`.
2. Increase `object_detection_interval_frames` from `8` to `12`.
3. Reduce camera resolution to `960 x 540` in the config.
4. As a last resort, add `--no-hog`; this affects only the fallback detector, not SSDLite.

A future version should retrain the crack model using MobileNetV3-Small or EfficientNet-Lite and export it to an optimized edge format. Do not replace the current model immediately before the exhibition without measuring accuracy on your validation set.

## Honest model limitations

The current crack network is an image-level classifier. It says whether the scan area appears cracked; it does **not** locate the precise crack pixels or measure crack width. The rectangle is the scan area, not a crack bounding box.

The supplied crack confusion matrix contains 756 missed cracked samples out of 1,698 actual cracked samples (about 55.5% recall). A better camera helps only when blur, focus, lighting, or resolution caused the failure. It does not fix training-data bias. For a safety-oriented demonstration, the application therefore uses an uncertainty band and never converts a weak score into a confident “safe” result.

For true localization, build a later version with an annotated crack detection/segmentation dataset and a small YOLO segmentation or MobileNet-based segmentation model.

## Troubleshooting

**`rpicam-hello` works but Python cannot import Picamera2**

Re-run `./install_pi.sh`. Its virtual environment uses `--system-site-packages`, which is required to see Raspberry Pi OS camera packages.

**No USB camera opens**

Try `--camera-index 1`, check `v4l2-ctl --list-devices`, and close other camera applications.

**The program says blur even on a wall**

Clean the lens, add diffuse light, allow autofocus to settle, move closer, and only then lower `blur_minimum` slightly.

**The program is too slow**

Use the performance options above. Do not set a high camera resolution just to improve the displayed video; both classifiers receive 224 x 224 input.

**The program stops at model loading**

Confirm the three files in `models/` were copied completely. Compare them with `CHECKSUMS.sha256` using:

```bash
sha256sum -c CHECKSUMS.sha256
```

## Project files

- `payload_app.py`: camera, models, person/object gate, HUD, logging, and optional GPIO
- `payload_logic.py`: tested state machine and safety thresholds
- `payload_config.json`: camera, decision, timing, and GPIO settings
- `models/`: put the optional `.pth` files here (not in Git); also holds the CLIP cache `models/hf_cache/`
- `disaster_zero_shot.py`, `image_upload_demo.py`: CLIP disaster classifier (CLI, GUI)
- `rescue_simulation.html`, `sim/`, `vendor/`, `sim_server.py`, `mission_model.py`: 3D simulation and shared mission data
- `mavlink_bridge.py`, `mavlink_config.json`: QGroundControl telemetry bridge (simulation only)
- `setup.ps1`, `run_all_demo.ps1`, `start_*.ps1`: Windows setup and start scripts
- `tests/`: decision-logic unit tests
- `PROJECT_AUDIT.md`: technical review of the original project
- `EXHIBITION_AND_VIVA.md`: demo sequence and likely viva answers
- `install_pi.sh`: one-time Raspberry Pi installer
- `run_payload.sh`: normal launcher
- `requirements-demo.txt`, `requirements-mavlink.txt`, `requirements-pi.txt`: Python dependencies

## Official references

- Raspberry Pi camera software and Picamera2: https://www.raspberrypi.com/documentation/computers/camera_software.html
- Raspberry Pi camera hardware installation: https://www.raspberrypi.com/documentation/accessories/camera.html
- PyTorch Linux installation: https://docs.pytorch.org/get-started/locally/
- Torchvision SSDLite model details: https://docs.pytorch.org/vision/main/models/generated/torchvision.models.detection.ssdlite320_mobilenet_v3_large.html

## Unified AI review and 3D rescue dashboard

Run `./run_earth_rescue.ps1` and use **AI image review · CLIP + YOLO** in the same
dashboard as the Cesium mission. Upload an image or enable **Camera**, then
**Capture frame**, and click **Analyse image**. CLIP estimates the disaster
category and all scores; YOLO marks possible people on that same image.
The first analysis downloads pretrained weights; later analyses reuse models
in memory and cached weights on disk. Install dependencies with
`py -m pip install -r requirements-demo.txt`. Uploaded images remain in memory.

Click a map area and **Attach review to selected map area** to record the AI
results in the mission evidence log. Confirm the simulated candidate and launch
using the existing controls. Photo pixels have no verified GPS coordinates;
the operator places the area, and the 3D people and deliveries stay simulated.
Camera capture analyses a still frame, not a continuous live video stream.
Use **3D rescue view** at the lower right to restore the angled mission scene,
or start the complete training scene if there is no mission yet. Clicking a new
map area after completion clears the old mission and its HUD.

## Fast India / El Niño demo

The default **India · El Niño / weaker monsoon scenario** places a fictional aid
mission near Mysuru, Karnataka. Dry ground, smoke and fire-risk markers illustrate
monsoon stress; they do not depict verified fires or a forecast. El Niño develops
in the equatorial Pacific and can influence India's monsoon; reduced rainfall
is not guaranteed. See [NOAA's ENSO explanation](https://www.noaa.gov/understanding-el-nino).
Separate coastal Peru wet and Indonesia dry scenarios are also available.

The NASA view starts with worldwide terrain and mapped 3D buildings enabled;
OSM imagery and geometry stream in the background. The hidden reference/controller
starts immediately without rendering a duplicate terrain world. Turn off
**3D terrain & buildings** (or use `?quality=fast`) for a lighter view.
The mission controller's CesiumJS dependency
still loads from the CDN. Choose
1×, 2× or 4× playback; SITL telemetry keeps its original timing. AI models run
independently, remain in memory, and reuse the previous successful image result
when the identical image is analysed again. The first model load still takes time.

Browser check: `py tests/earth_fast_climate_browser_check.py` verifies startup with
ion requests stalled and completes the India mission at 4× using real elapsed time.
Optional real inference check: `py tests/vision_live_check.py`.

## NASA 3D Tiles world renderer

The dashboard defaults to **NASA-AMMOS 3D Tiles · Three.js**, using
[3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) version 0.5.3
and Three.js 0.180.0. Its runtime and Draco decoder are bundled locally.
The current mission supplies the same drone, package and actor positions to this
view; candidate approval, image review, telemetry and evidence stay in the existing
workflow. The hidden Cesium reference view stops its render loop to avoid drawing
two worlds at once. Select **Cesium reference view** to return to it.

- **Whole Earth** zooms out; **Mission view** returns to the local mission.
- OpenStreetMap imagery streams onto a globe in the background. This is a map
  texture, not satellite photography or a global textured building model.
- **3D terrain & buildings** is on by default. Cesium ion quantized-mesh terrain
  and OSM 3D buildings stream globally through NASA's renderer using the existing
  token; they are not restricted to the demo site. Availability and detail vary.
- **Go to any coordinates** selects a location by latitude/longitude. An oblique
  camera settles above a terrain-source height sample; high mountain locations
  get a wider view. Sampling is asynchronous and does not block mission setup.
  Missing building geometry, loading, and source errors are reported separately.
- **3D Tiles / ODM tileset URL** loads a georeferenced `tileset.json` over HTTP(S).
  Relative `/odm-data/...` paths use the existing read-only survey server mapping.
  External hosts need CORS permission. **Load ODM** uses the manifest's selected
  tiled mesh or point cloud; its orthophoto and DSM overlays use the reference view.
- The synthetic rescue settlement and climate/fire markers are explicitly simulated.
  NASA's library supplies rendering, not hazard feeds, terrain data or AI models.

Run normally with `./run_earth_rescue.ps1`. Node/npm is needed only to change and
rebuild the world renderer: `npm ci`, then `npm run build:world`.
Source: `world/nasa_world.js`; attribution: `vendor/NASA-WORLD-NOTICE.md`.

Browser integration: `py tests/nasa_world_browser_check.py` checks the actual
renderer, a generated synthetic georeferenced glTF tile, mission completion and
renderer switching. Add `--details` to verify live hosted terrain/building tiles.
`py tests/global_3d_browser_check.py` checks automatic streaming at Bengaluru,
Everest and Dubai, sampled elevation, above-ground camera placement and coordinate
validation. Global terrain is not a promise that every building has been mapped
or that every location has photorealistic imagery.

## Report → local 3D view → simulated aid delivery

Open `earth_rescue.html?incidents=1` on the running local server. The first panel
shows NASA EONET open incident records and USGS M2.5+ earthquakes from the past
day. Fire, flood, storm, earthquake, volcano, landslide and other categories have
separate filters. The default age filter uses the latest report from the past
30 days; older open catalog records are available explicitly. Reports refresh
every five minutes. A failed source retains labelled stale records from that
source; refresh time and event/report time are shown separately.

1. Click a coloured globe marker or report in the list. The actual reported point
   or approximate polygon centroid opens in an angled NASA 3D view, with available
   terrain and mapped buildings. The original source link and report time appear.
2. Choose **Send aid drone · simulated** once the 3D terrain is ready. The mission
   stays near this report; it does not jump to the fixed India training location.
3. Watch the virtual drone load three packages, approach three simulated recipients,
   unload and return. The camera follows it by default; disable Follow to inspect
   the whole area. **Unsafe zone: abort and return** retains all packages.

For incident missions, terrain samples along the route and available building
roof geometry position the virtual base/drop platforms and set display flight
heights. These are visual simulation estimates, not obstacle avoidance, a surveyed
landing zone or flight clearance. Original 3D map content is retained; schematic
hazard effects and recipient platforms are explicitly simulated. A report does
not verify trapped people, aid needs, damage or safe delivery conditions. Automatic
demo approval remains blocked from the physical payload-release gate.

Sources: [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) and
[USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
This is curated near-real-time metadata with incomplete coverage and source
delays; EONET catalog “open” does not establish that a disaster is still happening.
Terrain and buildings are reference data, not live damage reconstruction.

Verification: `py tests/incident_rescue_browser_check.py` uses synthetic report
fixtures with the actual world renderer to check marker clicks, filters, source
provenance, terrain/roof-aware delivery, abort, release gating and a partial feed
outage. `py tests/live_incident_feed_check.py --mission` exercises real feed
connections and a simulated delivery at a real reported event location.
