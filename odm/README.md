# OpenDroneMap dashboard layer

The dashboard reads `manifest.json` from the external ODM folder passed to
`run_earth_rescue.ps1 -OdmRoot`. The default folder is
`D:\DroneRescueData\odm` when it exists. Large generated files must not be
committed to Git.

Copy `manifest.example.json` to `D:\DroneRescueData\odm\manifest.json` and
replace its coordinates and paths. `run_open_dronemap.ps1` asks ODM to create
the browser-ready derivatives alongside the raw survey products:

- orthophoto: XYZ PNG/JPEG map tiles;
- elevation: DSM map tiles shown as a semi-transparent elevation overlay;
- point cloud: 3D Tiles `tileset.json`;
- textured model: 3D Tiles `tileset.json`.

Raw ODM GeoTIFF, LAZ/PLY, and OBJ files remain available for GIS and engineering
tools. The example manifest points at ODM's `orthophoto_tiles`, `dsm_tiles`, and
`3d_tiles/model` folders. If ODM's point cloud 3D Tiles conversion fails, use
`py3dtiles` to convert the georeferenced LAZ into `pointcloud_tiles`; the
example manifest points there. From the repository folder run
`py -m pip install -r requirements-odm-pointcloud.txt`, then
`py convert_odm_pointcloud.py --project-dir D:\DroneRescueData\odm\brighton_beach_odm`.
Keep `manifest.json` beside the project folder and press
**Load ODM**. The elevation checkbox displays a DSM visualization; it does not
replace the globe's geometric terrain with a quantized-mesh terrain provider.
