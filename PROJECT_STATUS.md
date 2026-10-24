# Project status and remaining work

Last audited: **23 October 2026**

This is the source-of-truth checklist for the rescue-drone project. “Verified” means the repository contains the implementation and it has been exercised locally or covered by automated tests. Real incident data, AI detections, simulated flight, and physical hardware evidence are kept separate.

## Current result

The repository is already a complete **software demonstration platform** that runs without an API key. It combines disaster-scene classification, recorded-footage person detection, an operator-controlled Cesium rescue workflow, QGroundControl-compatible MAVLink telemetry, a receive-only SITL-to-Cesium path, mission evidence, and replay.

It is **not yet a validated real rescue drone**. A real autopilot installation, measured AI results on held-out data, and repeatable latch hardware evidence are still required.

## Implemented and verified

| Area | Current implementation | Evidence / entry point |
| --- | --- | --- |
| Disaster classification | Zero-shot CLIP categories: flood, fire, earthquake damage, landslide, storm damage, normal and uncertain | `disaster_zero_shot.py`, `image_upload_demo.py` |
| First-run model handling | Friendly cache check, first-use download, repository-local reuse and offline mode | `./setup.ps1`, `py disaster_zero_shot.py --check` |
| Basic 3D rescue | Bundled Three.js flood scene, slow drone, people, package loading/unloading, pause/reset/complete states | `./run_rescue_simulation.ps1` |
| Live map context | OpenStreetMap, NASA EONET events and Open-Meteo weather with timestamps/source warnings | `./run_live_operations.ps1` |
| Operator workflow | Confirm/reject candidate, success/abort scenarios, independent release approval and blocked unsafe release | `./run_earth_rescue.ps1` |
| Optional detailed Earth view | Cesium terrain and OSM 3D buildings; token remains in browser session storage | Token field in `earth_rescue.html` |
| Mission evidence | Timestamped decisions plus half-second position, altitude, heading, battery, phase and package samples | **Download JSON** in the dashboard |
| Mission replay | Replays a saved mission route, phase, battery and delivery count at 2× without sending commands | **Replay a mission JSON** in the dashboard |
| Recorded footage AI | YOLO person candidates from a video/camera; explicit confirm/reject; CSV evidence | `./run_recorded_footage.ps1 <video>` |
| AI evaluation | Held-out YOLO-format evaluator reports TP, FP, FN, precision, recall and FPS | `evaluate_aerial_people.py` |
| Dataset provenance | Records external dataset source, version, license, split counts and an inventory digest; blocks train/validation filename overlap | `dataset_manifest.py` |
| Aerial reconstruction | Runs the official OpenDroneMap Docker image on an external overlapping image set | `run_open_dronemap.ps1` |
| QGroundControl output | MAVLink position, battery, progress, people, packages, candidate and release-approval values | `mavlink_bridge.py`, UDP 14550 |
| Autopilot input | Receive-only PX4/ArduPilot telemetry drives Cesium position, heading, battery, mode, armed and GPS state | `sitl_telemetry_adapter.py` |
| No-autopilot integration demo | A clearly labelled mock MAVLink source verifies the receive path; it is not flight dynamics or an autopilot | `./run_all_demo.ps1 -MockSitl` |
| Nano latch protocol | 9600-baud `R`/`L` protocol and status acknowledgement; software release gate requires confirmation and explicit hardware enablement | `rescue_nano/rescue_nano.ino`, `rescue_laptop.py` |
| Repository safety | Loopback server, no committed model weights/API keys, simulation labels and SITL command guards | automated tests and `.gitignore` |

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

The no-key OpenStreetMap globe and scripted mission work immediately. A Cesium token is optional.

### Verify the repository

```powershell
node --check earth_rescue.js
py -m unittest discover -s tests -q
```

The latest audit passed **81 tests**. The mission-replay path was also smoke-tested in Chromium, and the mock vehicle → MAVLink adapter → `/api/autopilot` path was exercised end to end.

## Work still required

### 1. Real AI measurements — person and flood classifiers measured

- **Done (24 October 2026):** stock `yolov8n` was evaluated on the held-out VisDrone2019-DET validation split (548 images, 13,969 people). Result: **recall 7.4% at 640 px and 21.6% at 1280 px, precision about 75-79%**.
- **Done (24 October 2026):** an externally pretrained VisDrone YOLO11s checkpoint was checksum-verified and evaluated unchanged on the same split. At 640 px it reached **39.4% recall and 66.3% precision at 1.8 FPS on CPU**. No project training was performed.
- **Done (24 October 2026):** pretrained zero-shot CLIP was evaluated unchanged on 398 labelled FloodNet Track 1 images. It reached **79.9% six-category accuracy, 82.9% flood precision and 56.9% flood recall at 1.07 images/s on CPU**. No project training was performed.
- Both models remain operator-confirmed candidate generators. The better aerial model still misses about 61% of labelled people. Full details, provenance and limits: `evaluation_results/README.md`.
- CLIP still classifies the overall scene; it does not draw flood boundaries. It missed 22 of 51 flooded scenes, so it cannot verify that an area is safe or flood-free.

### 2. Full autopilot simulation — blocked on supported SITL

- Install PX4 or ArduPilot SITL in a supported environment.
- The machine currently has Ubuntu WSL 26.04; current PX4 documentation supports Ubuntu 22.04/24.04, so use a supported WSL distribution rather than forcing an unsupported install.
- Start with `./run_all_demo.ps1 -WithSitl -SitlFlavor px4` or `ardupilot`.
- Verify QGroundControl, geofence, failsafe, low-battery, GPS-loss, aborted delivery and return-to-home scenarios.
- Save the resulting mission evidence JSON for each repeatable scenario.

### 3. Physical latch validation — blocked on hardware evidence

- Power the MG90S from a stable external 5 V supply; join supply ground to Nano ground.
- Keep the control signal on Nano D6 and serial at 9600 baud.
- Add a latch-position feedback switch/sensor. A command acknowledgement alone does not prove physical movement.
- Run at least **100 loaded bench cycles** and record command, acknowledgement, observed position, elapsed time and failure reason.
- Test only on a bench with propellers removed. Real-flight control is outside this repository’s validated scope.

### 4. Optional Cesium enhancement — waiting for token

- Paste a Cesium ion token into the dashboard to enable hosted terrain and OSM 3D buildings.
- The token is optional and must never be committed. The basic OpenStreetMap globe already works without it.

## Explicitly not required

- A promotional/demo video is no longer part of the requested scope.
- A Google Maps or Google Earth paid API is not required.
- Training a disaster classifier dataset is not required for the current zero-shot CLIP mode.
- Connecting to or commanding a real aircraft is not required and has not been validated.

## Recommended completion order

1. Run and preserve one successful and one aborted mock-MAVLink mission log.
2. Add the held-out aerial dataset and publish evaluation results.
3. Install supported PX4/ArduPilot SITL and repeat the two mission scenarios.
4. Finish servo power/feedback and complete 100 documented bench cycles.
5. Add the optional Cesium token last; it improves visuals but does not affect core correctness.

## Completion definition

Call the project “validated” only when all of these are true:

- Fresh-clone setup and all automated tests pass.
- A fixed held-out dataset has published AI metrics and failure examples.
- Successful and aborted missions are repeated in real SITL with saved logs.
- QGroundControl displays expected telemetry and safety scenarios are documented.
- The latch completes 100 loaded cycles with physical position feedback and recorded outcomes.
- No API key, large model, private dataset or generated mission log is committed accidentally.

Until then, present it honestly as a **simulation and operator-workflow prototype**.
