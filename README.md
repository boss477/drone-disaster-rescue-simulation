# Raspberry Pi Wall Crack Inspection Payload

## Flood rescue 3D simulation

Open `rescue_simulation.html` or run `./run_rescue_simulation.ps1`. This is a
slow, interactive training simulation: the drone visits four rooftop rescue
points, detects simulated people, unloads one package at each point, and
returns to base. Drag to orbit and use the mouse wheel to zoom. All counts are
explicitly simulated; this does not control a real drone.

## Disaster image classifier

The repository also includes a zero-shot disaster image classifier. It uses a
pretrained CLIP model and does not require a project-specific training dataset.
The first analysis downloads the pretrained model; later runs reuse the local
cache. It estimates: flood, fire, earthquake damage, landslide, storm damage,
or normal scene. Results are AI estimates, not verified emergency decisions.

On Windows:

```powershell
py -m pip install -r requirements-demo.txt
./run_image_upload.ps1
```

Choose an image in the window. The first launch may take several minutes while
the CLIP weights download. Internet is only needed for that first model setup.

This folder turns the existing laptop demonstration into a self-contained Raspberry Pi payload demonstrator. It automatically reads a Pi Camera or USB webcam, pauses inspection when a person is present, rejects phones/laptops/TV screens in the scan area, checks whether the central region is a wall, and only then runs the crack classifier. It displays a live HUD and saves a CSV inspection log plus crack evidence images.

This is an autonomous **perception payload** demonstration. It does not control a drone, motors, navigation, or collision avoidance. That distinction is important during the exhibition.

## Processing flow

```text
Pi Camera / USB webcam
          |
          v
Person and screen safety gate ---- person -> pause and show PERSON DETECTED
          |
          v
Blur, light, and glare gate ------ poor view -> request a better view
          |
          v
ResNet18 wall classifier --------- not wall -> reject frame
          |
          v
ResNet50 crack classifier -------- crack / no crack / uncertain
          |
          v
HUD + CSV log + evidence image + optional LEDs/buzzer
```

All three model files are supplied in `models/`, so inference does not need internet access after installation.

## What was fixed

- Replaced the Windows-only `cv2.CAP_DSHOW` camera path with automatic Picamera2, Linux USB/V4L2, and Windows USB support.
- Added true COCO `person` detection and kept `cell phone`, `laptop`, and `tv` rejection. Person always has priority.
- Packaged the object detector weights locally; the demo does not download a model at startup.
- Added a face/full-body offline fallback if the COCO detector cannot load.
- Added blur, low-light, and glare checks so a poor camera frame is not labelled safe.
- Added temporal smoothing and an uncertainty band instead of forcing every frame into safe/cracked.
- Added automatic CSV logs and crack evidence captures.
- Added optional green LED, red LED, and buzzer outputs.
- Removed Windows paths and made all model/report paths relative to the project folder.
- Added automated tests for the decision logic.

## Recommended hardware

Use the hardware you already have before buying a webcam:

- Raspberry Pi 5 (preferred) or Raspberry Pi 4 with 4 GB or more
- Raspberry Pi Camera Module and the correct CSI ribbon cable for your Pi model
- Official-quality power supply, or a regulated power bank that matches the Pi's required voltage/current
- microSD card with Raspberry Pi OS 64-bit Desktop
- HDMI monitor for the exhibition, or VNC for setup
- Small ventilated payload box, standoffs, cable strain relief, and a camera opening
- Optional: two LEDs, two 220-330 ohm resistors, and a low-current active-buzzer module

A cheap USB webcam is not automatically better for cracks. Use the Pi Camera first. Buy a webcam only if your existing camera cannot focus at the required working distance or you need a separate laptop demo camera.

## Camera connection

1. Shut the Raspberry Pi down and disconnect power.
2. Find the connector labelled **CAMERA** or **CSI**. Do not use the similar display/DSI connector.
3. Lift the connector latch gently, insert the ribbon fully and straight, and close the latch. The correct contact orientation varies by Pi/cable, so follow the camera/board markings.
4. Mount the camera facing forward. Keep the ribbon away from sharp bends and add strain relief.
5. Connect HDMI and power, then boot Raspberry Pi OS.
6. Test the camera before installing the project:

```bash
rpicam-hello -t 5000
```

If that command fails, fix the camera connection first. The Python application cannot correct a cable or camera-stack problem.

For a USB webcam, connect it to USB and verify the index:

```bash
v4l2-ctl --list-devices
```

## Optional indicator wiring

The pin names below use **BCM numbering**, matching `payload_config.json`.

| Function | BCM GPIO | Physical pin | Connection |
|---|---:|---:|---|
| Green safe LED | GPIO17 | 11 | GPIO -> 220-330 ohm resistor -> LED anode; cathode -> GND |
| Red alert LED | GPIO27 | 13 | GPIO -> 220-330 ohm resistor -> LED anode; cathode -> GND |
| Buzzer module signal | GPIO22 | 15 | Signal pin only; wire VCC/GND according to the module |
| Ground | GND | 6 | Common ground |

Do not connect a high-current buzzer or motor directly to a GPIO pin. Use a suitable transistor/driver or a low-current buzzer module.

## Install on Raspberry Pi

Use Raspberry Pi OS 64-bit Desktop. Copy this complete folder to the Pi, for example to `/home/pi/raspberry_pi_payload`, using a USB drive, SCP, or a shared folder. Then run:

```bash
cd /home/pi/raspberry_pi_payload
chmod +x install_pi.sh run_payload.sh
./install_pi.sh
```

The installer uses Debian packages for Picamera2/OpenCV/GPIO access and creates a virtual environment for PyTorch/Torchvision. Internet is needed during this one-time installation, but not when running the demo later.

## Run the payload

Automatic camera selection and full-screen exhibition mode:

```bash
./run_payload.sh
```

Force the Pi Camera:

```bash
./run_payload.sh --camera pi
```

Force a USB webcam:

```bash
./run_payload.sh --camera usb --camera-index 0
```

Test a saved image without a camera:

```bash
./run_payload.sh --image samples/test_cracked.jpg
```

### Laptop camera mode

On Windows, use the laptop's built-in camera or a USB webcam:

```powershell
.\run_laptop.ps1
```

This starts the first rescue-drone demo. It detects a person and simulates the payload release on screen; no servo or GPIO is used. Hold a person in view until the status changes to `PAYLOAD RELEASE SIMULATED`. Press `r` to test a manual simulated release, and press `q` or `Esc` to quit.

The HUD also shows `Persons detected N`, which is the number of people currently visible to the detector.

The rescue demo displays `POSSIBLE BLOOD - PERSON MAY BE HARMED` when it sees a large red region inside a person box. This is only a color-based demo warning; it cannot confirm blood or injury and may detect red clothing or objects. Human verification is required.

If Windows assigns the camera another index:

```powershell
.\run_laptop.ps1 -CameraIndex 1
```

The equivalent direct command is `py payload_app.py --laptop-camera --rescue-demo`. When moving to the Raspberry Pi, use `./run_payload.sh --camera pi`; the laptop option does not change or remove the Pi Camera path.

### Image input mode

To test a saved image instead of the camera:

```powershell
.\run_image.ps1 .\samples\flood_street.jpg
```

Equivalent direct command:

```powershell
py payload_app.py --image .\samples\flood_street.jpg --rescue-demo
```

Controls:

- `q` or `Esc`: quit cleanly
- `s`: save a manual evidence image
- `f`: toggle full screen

Run with `--gpio` only after wiring and checking the optional indicators:

```bash
./run_payload.sh --gpio
```

## Optional laptop rehearsal

The same application can be rehearsed on Windows with a USB webcam. From PowerShell in this folder:

```powershell
python -m venv .venv-win
.\.venv-win\Scripts\python -m pip install torch torchvision opencv-python
.\.venv-win\Scripts\python payload_app.py --camera usb --camera-index 0
```

The Pi uses the included shell installer instead; do not copy the Windows virtual environment to the Pi.

## Exhibition setup

1. Place the payload on a stand or mock drone plate; keep the propellers/motors absent or disconnected.
2. Put the camera 30-80 cm from the sample wall, depending on lens focus and crack size.
3. Use bright, diffuse side lighting. Avoid a torch pointed directly at glossy paint.
4. Fill most of the central scan box with the wall. A thin crack occupying only a few pixels cannot be recovered by software.
5. Start with a person in view to show the safety pause.
6. Move the person away, show a non-wall object/screen, then show a clear wall and cracked-wall sample.
7. Press `s` for a manual screenshot if required. Logs appear in `inspection_reports/<session>/`.

Prepare three physical A4/A5 samples: a clean wall image, an obvious cracked-concrete image, and an uncertain/faint-crack image. Test the exact lighting, camera distance, and thresholds the day before the exhibition.

## Threshold tuning

Edit `payload_config.json`; do not edit the Python code for normal tuning.

- `wall_accept_threshold`: increase to reduce false wall detections; decrease if real walls are often rejected.
- `crack_alert_threshold`: decrease to detect more possible cracks, but expect more false alarms.
- `crack_safe_threshold`: keep clearly below the alert threshold so uncertain samples request a rescan.
- `blur_minimum`: decrease only if sharp images are incorrectly rejected.
- `classification_interval_frames`: increase on a slower Pi to keep the display responsive.
- `object_detection_interval_frames`: increase if person/object detection is too slow.
- `torch_threads`: use `4` for Pi 4/5 as a starting point.

The displayed values are neural-network scores, not calibrated probabilities. Tune thresholds using real Pi Camera captures, not the training images.

## Performance options

The supplied ResNet50 model is heavy for a Raspberry Pi. A Pi 5 may update the classification only a few times per second, and a Pi 4 may be slower. The live video remains responsive because model inference is intentionally skipped between frames.

If performance is poor:

1. Increase `classification_interval_frames` from `3` to `5` or `8`.
2. Increase `object_detection_interval_frames` from `8` to `12`.
3. Reduce camera resolution to `960 x 540` in the config.
4. As a last resort, add `--no-hog`; this affects only the fallback detector, not SSDLite.

A future version should retrain the crack model using MobileNetV3-Small or EfficientNet-Lite and export it to an optimized edge format. Do not replace the current model immediately before the exhibition without measuring accuracy on your validation set.

## Honest model limitations

The current crack network is an image-level classifier. It says whether the scan area appears cracked; it does **not** locate the precise crack pixels or measure crack width. The rectangle is the scan area, not a crack bounding box.

The supplied crack confusion matrix contains 756 missed cracked samples out of 1,698 actual cracked samples (about 55.5% recall). A better camera helps only when blur, focus, lighting, or resolution caused the failure. It does not fix training-data bias. For a safety-oriented demonstration, the application therefore uses an uncertainty band and never converts a weak score into a confident “safe” result.

For true localization, build a later version with an annotated crack detection/segmentation dataset and a small YOLO segmentation or MobileNet-based segmentation model.

## Troubleshooting

**`rpicam-hello` works but Python cannot import Picamera2**

Re-run `./install_pi.sh`. Its virtual environment uses `--system-site-packages`, which is required to see Raspberry Pi OS camera packages.

**No USB camera opens**

Try `--camera-index 1`, check `v4l2-ctl --list-devices`, and close other camera applications.

**The program says blur even on a wall**

Clean the lens, add diffuse light, allow autofocus to settle, move closer, and only then lower `blur_minimum` slightly.

**The program is too slow**

Use the performance options above. Do not set a high camera resolution just to improve the displayed video; both classifiers receive 224 x 224 input.

**The program stops at model loading**

Confirm the three files in `models/` were copied completely. Compare them with `CHECKSUMS.sha256` using:

```bash
sha256sum -c CHECKSUMS.sha256
```

## Project files

- `payload_app.py`: camera, models, person/object gate, HUD, logging, and optional GPIO
- `payload_logic.py`: tested state machine and safety thresholds
- `payload_config.json`: camera, decision, timing, and GPIO settings
- `models/`: the two supplied classifiers and packaged SSDLite object detector
- `tests/`: decision-logic unit tests
- `PROJECT_AUDIT.md`: technical review of the original project
- `EXHIBITION_AND_VIVA.md`: demo sequence and likely viva answers
- `install_pi.sh`: one-time Raspberry Pi installer
- `run_payload.sh`: normal launcher

## Official references

- Raspberry Pi camera software and Picamera2: https://www.raspberrypi.com/documentation/computers/camera_software.html
- Raspberry Pi camera hardware installation: https://www.raspberrypi.com/documentation/accessories/camera.html
- PyTorch Linux installation: https://docs.pytorch.org/get-started/locally/
- Torchvision SSDLite model details: https://docs.pytorch.org/vision/main/models/generated/torchvision.models.detection.ssdlite320_mobilenet_v3_large.html
