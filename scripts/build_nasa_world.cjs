const esbuild = require('esbuild');
const fs = require('node:fs');
fs.mkdirSync('vendor/draco', {recursive:true});
fs.mkdirSync('vendor/licenses', {recursive:true});
for (const name of ['draco_decoder.wasm','draco_wasm_wrapper.js','draco_decoder.js']) {
  fs.copyFileSync('node_modules/three/examples/jsm/libs/draco/gltf/' + name, 'vendor/draco/' + name);
}
for (const [source,target] of [['node_modules/three/LICENSE','THREE-LICENSE.txt'],
  ['node_modules/3d-tiles-renderer/LICENSE','NASA-3DTilesRendererJS-LICENSE.txt']]) {
  fs.copyFileSync(source, 'vendor/licenses/' + target);
}
esbuild.buildSync({entryPoints:['world/nasa_world.js'],outfile:'vendor/nasa-world.js',
  bundle:true,minify:true,format:'esm',target:'es2022',legalComments:'linked'});
