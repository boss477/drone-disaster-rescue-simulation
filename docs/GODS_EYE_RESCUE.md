# Globe → fictional rescue workflow

## What is integrated

God's Eye View is the main globe. Its **DRONE RESCUE · OPERATIONS** panel loads NASA EONET/USGS reports directly, places selectable markers on the native Cesium globe, filters report age/category/name, and fetches Open-Meteo snapshots for the selected point. It refreshes every five minutes; a failed feed retains its previous records with an explicit stale-data message. The panel lists the first 80 matching reports and maps the first 600; filters narrow that set.

The **Image AI** tab uploads a photo or captures a camera frame and runs the existing cached CLIP + YOLO service through a same-origin proxy. It shows category scores, possible-person boxes, timing and per-model errors. **Attach AI review to exercise** preserves the estimate separately from the public incident context.

**Enter 3D rescue mission** opens Harbour Ward in a full-screen training frame inside God's Eye View. It retains the report title, point, timestamps, source and any attached AI review. The background globe stops rendering while the training frame is open, then resumes with its camera/layers preserved when you choose **Return to globe**. A separate-page training link and the earlier Earth/SITL dashboard remain available.

The reported coordinates describe the incident context only. Harbour Ward stays the same invented neighbourhood; it is not a real building reconstruction or current damage survey. AI detections have unverified geolocation and do not replace the three fictional recipients. Open-Meteo values are labelled snapshots with observation/retrieval times, not live flight inputs.

In the district, choose flood, fire or storm effects. **Unsafe zone · abort** withholds all packs and returns home. **Abort approach** is available before unloading; an early abort preserves the actual number already loaded. **Mission log** downloads JSON with the context, simulated event timeline, outcome, inventory and explicit `hardware_commands: false`.

## Full upstream app and one-command launcher

We run the complete [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) application, pinned to `15de9d738c4a85be1a96726c6114181caef87eeb` in `integrations/gods_eye_view.json`. Its application source, native globe, data layers, weather, tracking, camera tools, styles and provider settings stay intact. The installer applies one documented test-only Windows path fix from `integrations/gods_eye_view_windows.patch`. A Vite plugin adds our rescue panel and proxies the local image API and training page. The upstream app itself is not embedded in an iframe; only our standalone fictional training scene uses a frame over it.

Requirements: Git, Node.js 24.14+ within 24.x or 26.x, npm, Python with `requirements-demo.txt` installed, and internet for the first install and remote data. Run:

```powershell
./run_gods_eye_rescue.ps1
```

The script installs the exact upstream revision and locked npm dependencies if absent, skips Puppeteer's browser download, and runs on loopback only. It starts the rescue backend on 8877 automatically if absent, or reuses a compatible running backend. Ctrl+C stops the globe and a backend it owns; it does not stop a pre-existing backend. A different service occupying the rescue port produces an error. The default checkout is `%USERPROFILE%\PROJECTS\gods-eye-view`, outside this Git repository. Use `-InstallDir D:\DroneRescueData\integrations\gods-eye-view` if D: exists. An existing checkout at a different revision is left alone and produces a clear error. `-InstallOnly` performs setup without starting the server.

Open `http://127.0.0.1:4173`. For a selected dashboard report, **Explore this report in God's Eye View** passes both the report context and the upstream camera hash. In God's Eye View:

1. Use its globe and native data layers. On first launch, **Environmental** enables its environmental view; **Explore manually** starts with a clean globe.
   Collapse the rescue panel using its summary to reach the native controls underneath.
2. Select a report in the rescue panel or click its globe marker. In **Context**, **Use current map centre** explicitly replaces it with an operator-selected point, not a detected disaster or person.
3. Optionally upload a photo in **Image AI**, analyse it and attach the review.
4. Choose **Enter 3D rescue mission**, complete or abort the exercise, download its JSON and return to the same globe. **Legacy dashboard + SITL tools** opens the earlier dashboard.

Our bridge uses the upstream application lifecycle and viewer. It serves Cesium assets from the upstream working directory. No flight-control or serial bridge is connected to God's Eye View or Harbour Ward.

The default God’s Eye View route is keyless imagery/terrain. Photorealistic 3D needs separate provider configuration, coverage and quota eligibility; this integration does not enable billing or enter credentials. The source-code MIT license does not cover third-party maps, data or models. Keep the upstream license and its `DATA_SOURCES.md` attribution/terms. Our overlay is placed above the attribution region.

`-Port` and `-RescuePort` configure the upstream server and its return URL. Dashboard/globe shortcuts default to 4173/8877; if you choose other ports, navigate to those ports explicitly.

## New York 3D buildings

Open `http://127.0.0.1:4173/?nyc=1`, or press **New York · 3D buildings** in the rescue panel. Choose Lower Manhattan, Midtown Manhattan or Citywide overview; drag to orbit and scroll to zoom. **Hide buildings** toggles the layer without downloading another copy. No model conversion is required.

The loader first requests the ready-made **New York City 3D Buildings** asset linked by Cesium's [official metadata tutorial](https://cesium.com/learn/unreal/unreal-visualize-metadata/) and [Asset Depot](https://ion.cesium.com/assetdepot/75343). If that asset is inaccessible, it explicitly displays **OSM building geometry · New York** instead, using the global Cesium OSM tileset viewed over NYC. It does not label OSM as the curated city dataset. These are actual streamed 3D building shapes, not procedurally invented buildings or photorealistic facade textures.

To activate the curated city layer, sign into Cesium ion, add **New York City 3D Buildings** to **My Assets**, ensure the browser token may access it, copy its numeric asset ID into **Curated asset ID**, and select **Curated NYC** again. The current configured token returned HTTP 404 for curated asset 75343 and successfully accessed OSM asset 96188 during verification. Adding account assets requires the user's signed-in ion account; the existing browser token alone did not provide this access. If using another token, configure `CESIUM_ION_TOKEN` before launching. Tokens remain browser credentials and should be appropriately restricted in ion.

The NYC survey metadata describes historical 2014 building geometry; neither dataset proves current disaster damage. Loading buildings does not place or launch a rescue mission. Choose a real report or **Use current map centre** to set the separate exercise context. Harbour Ward remains fictional.

The local JSON config is `integrations/new_york_buildings.json`. SDK loading uses `IonResource.fromAssetId(id, {accessToken})` with `Cesium3DTileset.fromUrl`; it does not change the upstream app's global ion token or automatically enable Google's photorealistic service. Esri imagery is selected before loading the independent building layer. Streaming is limited by a 128 MiB tileset cache plus 64 MiB overflow; it does not download the whole city. Tile/feature counters are cumulative diagnostics, not a count of unique buildings.

Live check: `py tests/gods_eye_new_york_browser_check.py` verifies real tile content, source labels, camera positions, source access fallback, show/hide and invalid asset IDs. The curated dataset's contents remain unverified until account access is enabled. An actual live OSM run loaded 50 content tiles and 39,549 cumulative building features across the three NYC presets without page errors.

## Verification commands

With both local servers running:

```powershell
py tests/fictional_rescue_browser_check.py
py tests/rescue_handoff_browser_check.py
py tests/gods_eye_rescue_browser_check.py
py tests/gods_eye_operations_browser_check.py
```

Tests cover actual WebGL rendering, mission success, pause/reset, source metadata, malformed URL input, AI snapshot labels, all hazard modes, aborted return, early-loading inventory, JSON download, upstream startup/static assets, and transfer from God's Eye View to Harbour Ward. Fixture reports/model outputs are marked test data and are not accuracy evidence. Remote layer availability depends on providers and the network.

The upstream production build was also run successfully. Its initial Windows test run reported 8,783 passes, 10 skips and one failure in `skyAssets.paintOut.test.mjs`: it passed a URL `.pathname` (`/C:/...`) to Sharp instead of a Windows filesystem path. Our reproducible test-only patch uses Node's `fileURLToPath`; no checks are removed or weakened. The patched full `npm test` run passed **8,799 tests with 10 skipped**: 8,784 ordinary tests plus 15 isolated allocation checks. The local output is in `inspection_reports/gods_eye_upstream_tests.log`.

Additional live verification on 2026-10-27: both real report feeds connected (7,259 catalog records, 80 within the default 30-day display filter); a fresh re-encoded flood sample returned `flood scene`, one possible person and no model errors in 0.39 seconds through the actual same-origin API proxy. Those results demonstrate operation, not detection accuracy or complete emergency coverage. Startup on unused ports 4174/8878 created the backend automatically; Ctrl+C removed both owned listeners. The normal launcher reused the existing 8877 backend without stopping it.
