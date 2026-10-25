# OpenDroneMap dashboard layer

The dashboard reads `manifest.json` from the external ODM folder passed to
`run_earth_rescue.ps1 -OdmRoot`. The default folder is
`D:\DroneRescueData\odm` when it exists. Large generated files must not be
committed to Git.

Copy `manifest.example.json` to `D:\DroneRescueData\odm\manifest.json` and
replace its coordinates and paths. The browser needs Cesium-ready derivatives:

- orthophoto: XYZ PNG/JPEG map tiles;
- elevation: Cesium quantized-mesh terrain;
- point cloud: 3D Tiles `tileset.json`;
- textured model: 3D Tiles `tileset.json`.

Raw ODM GeoTIFF, LAZ/PLY, and OBJ files are source outputs, but browsers cannot
display those formats directly. Convert them into the formats above, keep the
converted directories beside `manifest.json`, and then press **Load ODM**.
