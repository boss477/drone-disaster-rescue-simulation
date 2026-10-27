# Upstream integrations and team split

This project is an integration layer. It does not reimplement an autopilot, ground station, detector or photogrammetry engine.

## Repositories used

| Upstream project | Used for | Integration in this repository |
| --- | --- | --- |
| [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) | Main globe with its complete native application and layers | `run_gods_eye_rescue.ps1`, pinned checkout, integrated reports/image AI and inline fictional rescue; [guide](docs/GODS_EYE_RESCUE.md). One reproducible Windows test-path patch; application source unchanged. |
| [PX4 Autopilot](https://github.com/PX4/PX4-Autopilot) | Real software-in-the-loop flight dynamics and MAVLink telemetry | `start_sitl.ps1`, `sitl_telemetry_adapter.py` |
| [QGroundControl](https://github.com/mavlink/qgroundcontrol) | Mission planning and vehicle/telemetry inspection | UDP 14550 output from `mavlink_bridge.py` |
| [Ultralytics](https://github.com/ultralytics/ultralytics) | Pretrained person detection on recorded footage | `rescue_laptop.py`, `evaluate_aerial_people.py` |
| [OpenDroneMap](https://github.com/OpenDroneMap/ODM) | Orthophotos, point clouds, elevation products and 3D meshes | `run_open_dronemap.ps1` uses the official Docker image |
| [WebODM](https://github.com/OpenDroneMap/WebODM) | Optional browser UI for ODM jobs | Recommended extension; not embedded or required |

Each upstream project keeps its own license and installation lifecycle. Model weights, datasets, PX4 checkouts and ODM products stay outside this Git repository.

## Half implemented in this repository

- Cesium/OpenStreetMap 3D rescue dashboard with public hazard and weather context.
- Operator confirmation and independent payload authorization.
- Mission evidence logs and replay.
- Receive-only PX4/ArduPilot telemetry adapter.
- QGroundControl-compatible MAVLink telemetry output.
- Ultralytics YOLO recorded-footage review and held-out evaluator.
- Zero-shot CLIP scene classification.
- OpenDroneMap Docker runner for an external survey image set.
- Dataset provenance manifest with a train/validation overlap guard.

## Friend handoff: remaining half

Your friend should not rewrite the dashboard or detector. Their deliverable is reproducible validation using the upstream tools:

1. Install Ubuntu 22.04/24.04 in WSL2 and clone PX4 with submodules:
   `git clone https://github.com/PX4/PX4-Autopilot.git --recursive`.
2. Follow PX4's official Ubuntu toolchain setup, run `make px4_sitl gz_x500`, then run `./run_all_demo.ps1 -WithSitl -SitlFlavor px4` on Windows.
3. In QGroundControl, verify waypoint flight, return-to-home, geofence, GPS-loss, low-battery and aborted-delivery scenarios. Save dashboard mission JSON for each run.
4. Download a licensed held-out aerial-person dataset. Keep it outside the repository with separate `train/` and `val/` folders. Generate `dataset_manifest.json`, then run `evaluate_aerial_people.py` and preserve its CSV and console summary.
5. If flood mapping is required, download FloodNet under its terms and use it for flood segmentation evaluation—not as proof of a live emergency.
6. Put an overlapping drone survey image set in `<dataset-root>\rescue-survey\images`, run `run_open_dronemap.ps1`, and document the generated orthophoto, point cloud and textured mesh.
7. Complete 100 propeller-free MG90S latch bench cycles using stable external 5 V power and physical position feedback.

## Acceptance evidence from the friend

- PX4 and QGroundControl version/commit information.
- One successful and one aborted SITL mission log.
- Screenshots of QGroundControl telemetry and safety scenarios.
- Dataset source, version, license, immutable manifest and evaluation CSV.
- ODM command, input-image count and paths to generated outputs.
- Latch-cycle CSV with command, acknowledgement, observed position, duration and failure reason.

Do not claim autonomous rescue or real-world safety validation until those artifacts exist.
