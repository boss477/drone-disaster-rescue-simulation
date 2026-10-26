# NASA world renderer dependencies

- 3DTilesRendererJS **0.5.3**, NASA-AMMOS: https://github.com/NASA-AMMOS/3DTilesRendererJS
  (Apache-2.0; license in `licenses/NASA-3DTilesRendererJS-LICENSE.txt`).
- Three.js **0.180.0**: https://github.com/mrdoob/three.js
  (MIT; license in `licenses/THREE-LICENSE.txt`). Draco decoder files are copied
  from this version's `examples/jsm/libs/draco/gltf` directory; Draco is a Google
  project distributed under Apache-2.0.
- Meshoptimizer decoder, distributed with Three.js, by Arseny Kapoulkine (MIT).
  See `licenses/MESHOPTIMIZER-LICENSE.txt`.

`nasa-world.js` is built from `world/nasa_world.js` with pinned npm dependencies.
Run `npm ci` and `npm run build:world` to rebuild it. The build script also copies
the decoder and license files. No Node installation is required just to run the
Python demo server from a clone containing these bundled assets.

NASA provides the renderer, not the Earth imagery or disaster predictions.
Map imagery is © OpenStreetMap contributors. Hosted terrain and buildings use
Cesium ion and the configured token. Dataset licensing, attribution and availability
remain with the respective providers. Application people, climate surfaces and
package deliveries are simulations.
