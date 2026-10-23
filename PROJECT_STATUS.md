# Project implementation status

This file separates demonstrated behavior from planned integrations.

## Implemented and locally verified

- Zero-shot CLIP disaster classification with uncertainty reporting.
- No-key OpenStreetMap Cesium globe with optional Cesium ion terrain/buildings.
- One operator-controlled aid mission with successful and required-abort paths.
- Candidate confirmation, independent release approval, telemetry fields, and downloadable mission evidence.
- Downloaded mission evidence contains position samples and can be replayed safely in the dashboard without sending commands.
- Recorded-video or camera person candidates with CSV evidence logs and no automatic payload release.
- Held-out aerial-person evaluation for precision, recall, false positives, misses, and throughput.
- Telemetry-only MAVLink output for QGroundControl, including candidate and approval flags.
- Receive-only PX4/ArduPilot telemetry input for SITL-driven Cesium position, heading, battery, mode, armed state, and GPS status.
- A telemetry-only mock vehicle exercises the complete MAVLink receive path when a full autopilot is unavailable; it is explicitly not presented as flight dynamics or SITL.
- Bench-servo release gate requiring candidate confirmation, explicit hardware enablement, and an open serial link.

## Waiting for user-provided resources

- Cesium ion token: enables hosted terrain and 3D buildings. The basic map works without it.
- VisDrone held-out images/labels or another licensed aerial-person dataset: required for real evaluation numbers.
- FloodNet images/labels: required for flood-segmentation work; the existing CLIP result is scene classification, not segmentation.

## External software still required

- PX4 SITL or ArduPilot SITL. The current Ubuntu WSL installation is 26.04; the current PX4 documentation lists Ubuntu 22.04 and 24.04 as supported and says 26.04 is not yet supported.
- QGroundControl can already view the project's generated telemetry. The SITL-to-Cesium path is implemented but cannot be end-to-end demonstrated until a supported SITL installation is available.

## Hardware evidence still required

- Stable external servo power and common ground.
- Latch-position feedback sensor.
- Repeated loaded bench cycles with commanded-versus-observed results.

All drone positions, people, packages, releases, and mission outcomes in the browser are simulated.
