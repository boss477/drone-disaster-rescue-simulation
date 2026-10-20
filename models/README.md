# models/

Large model files are **not stored in Git**. This folder is created empty on a fresh clone.

## Disaster image classifier (CLIP) - automatic

Nothing to place here. On first use the pretrained CLIP model (about 600 MB) is downloaded into
`models/hf_cache/` and reused on later runs (offline afterwards). Delete that folder to free space.

## Wall-crack payload (`payload_app.py`) - optional `.pth` files

The Raspberry Pi / laptop crack-inspection payload needs these files in **this folder**
(names come from `payload_config.json`):

| File | Purpose |
| --- | --- |
| `wall_detector_model.pth` | ResNet18 wall / not-wall classifier |
| `master_crack_model.pth` | ResNet50 crack / no-crack classifier |
| `ssdlite320_mobilenet_v3_large_coco.pth` | SSDLite COCO object detector (optional; an offline face/body fallback is used if missing) |

`CHECKSUMS.sha256` in the repository root lists the expected SHA-256 of the original files. Verify with:

```powershell
Get-FileHash models\*.pth -Algorithm SHA256
```

The disaster classifier, the 3D simulation and the MAVLink/QGroundControl bridge do **not** need these files.
