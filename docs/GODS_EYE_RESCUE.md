# Globe → fictional rescue workflow

## What is integrated

The existing Earth dashboard supplies NASA EONET/USGS reports, weather snapshots and the CLIP/YOLO photo review. Select a report and choose **Train in the detailed fictional district**. Harbour Ward receives its title, point, timestamps and original source link. Expand **Report context · fictional exercise** to inspect them.

The reported coordinates describe the incident context only. Harbour Ward stays the same invented neighbourhood; it is not a real building reconstruction or current damage survey. AI detections have unverified geolocation and do not replace the three fictional recipients. Open-Meteo values are labelled snapshots with observation/retrieval times, not live flight inputs.

In the district, choose flood, fire or storm effects. **Unsafe zone · abort** withholds all packs and returns home. **Abort approach** is available before unloading; an early abort preserves the actual number already loaded. **Mission log** downloads JSON with the context, simulated event timeline, outcome, inventory and explicit `hardware_commands: false`.

## God's Eye View, optional upstream app

We run [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) as a separate local app, unmodified. Version is pinned to `15de9d738c4a85be1a96726c6114181caef87eeb` in `integrations/gods_eye_view.json`. A Vite integration adds a small **DRONE RESCUE · TRAINING** panel. This is a source-level sidecar integration, not an iframe or a copy of its entire UI into our bundle.

Requirements: Git, Node.js 24.14+ within 24.x or 26.x, npm, internet for the first install and remote data. Start the existing rescue server:

```powershell
./run_earth_rescue.ps1 -Port 8877 -NoBrowser
```

In a second terminal:

```powershell
./run_gods_eye_rescue.ps1
```

The script installs the exact upstream revision and locked npm dependencies if absent, skips Puppeteer's browser download, and runs on loopback only. The default checkout is `%USERPROFILE%\PROJECTS\gods-eye-view`, outside this Git repository. Use `-InstallDir D:\DroneRescueData\integrations\gods-eye-view` if D: exists. An existing checkout at a different revision is left alone and produces a clear error. `-InstallOnly` performs setup without starting the server.

Open `http://127.0.0.1:4173`. For a selected dashboard report, **Explore this report in God's Eye View** passes both the report context and the upstream camera hash. In God's Eye View:

1. Use its globe and native data layers. On first launch, **Environmental** enables its environmental view; **Explore manually** starts with a clean globe.
2. The rescue panel retains the report handed over from our dashboard. **Use current map centre** explicitly replaces it with an operator-selected point, not a detected disaster or person.
3. Choose **Open fictional rescue district** to train. **Live disaster reports + AI review** returns to our dashboard.

Our bridge uses the upstream application lifecycle and viewer; we do not patch its files. It also serves Cesium assets from the upstream working directory. No flight-control or serial bridge is connected to God's Eye View or Harbour Ward.

The default God’s Eye View route is keyless imagery/terrain. Photorealistic 3D needs separate provider configuration, coverage and quota eligibility; this integration does not enable billing or enter credentials. The source-code MIT license does not cover third-party maps, data or models. Keep the upstream license and its `DATA_SOURCES.md` attribution/terms. Our overlay is placed above the attribution region.

`-Port` and `-RescuePort` configure the upstream server and its return URL. Dashboard/globe shortcuts default to 4173/8877; if you choose other ports, navigate to those ports explicitly.

## Verification

With both local servers running:

```powershell
py tests/fictional_rescue_browser_check.py
py tests/rescue_handoff_browser_check.py
py tests/gods_eye_rescue_browser_check.py
```

Tests cover actual WebGL rendering, mission success, pause/reset, source metadata, malformed URL input, AI snapshot labels, all hazard modes, aborted return, early-loading inventory, JSON download, upstream startup/static assets, and transfer from God's Eye View to Harbour Ward. Fixture reports/model outputs are marked test data and are not accuracy evidence. Remote layer availability depends on providers and the network.
