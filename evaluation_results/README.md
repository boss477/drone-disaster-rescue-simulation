# AI evaluation: measured results

Measured on **24 October 2026**. These are real measurements, and they show that the stock model is **not good enough to find people from the air**.

## Setup

| Item | Value |
| --- | --- |
| Dataset | VisDrone2019-DET **validation** split, 548 images, 13,969 person boxes (categories 1 pedestrian + 2 people) |
| Source | `https://github.com/ultralytics/assets/releases/download/v0.0.0/VisDrone2019-DET-val.zip` (a mirror of the VisDrone dataset) |
| Dataset ZIP SHA-256 | `abeea063037e5d20398837deb11084e652402a34ddf4f207bdf541a6f2a35ef9` |
| License | VisDrone is released for research / non-commercial use; check the VisDrone terms before any other use. Images are **not** committed to this repository. |
| Model | `yolov8n.pt` (COCO-pretrained, class `person`), SHA-256 `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36` |
| Software | Ultralytics 8.4.184, CPU only |
| Held-out? | Yes. The model was trained on COCO and never saw VisDrone; no fine-tuning was done. |
| Conversion | `convert_visdrone.py` (drops ignored regions and non-person categories); evaluation by `evaluate_aerial_people.py` |
| Matching | Greedy IoU >= 0.5, confidence >= 0.25, one detection per true box |

## Results

| Inference size | True positives | False positives | Missed people (FN) | Precision | Recall | Speed (CPU) |
| --- | --- | --- | --- | --- | --- | --- |
| 640 | 1,039 | 355 | 12,930 | 74.5% | **7.4%** | 3.5 frames/s |
| 1280 | 3,015 | 808 | 10,954 | 78.9% | **21.6%** | 1.6 frames/s |

### Pretrained aerial model (no local training)

The AGPL-3.0 `RISEF/yolov11s-visdrone` checkpoint was downloaded from Hugging Face, checksum-verified, and evaluated unchanged on the same held-out validation conversion at 640 px:

| Model | True positives | False positives | Missed people | Precision | Recall | CPU speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stock COCO YOLOv8n | 1,039 | 355 | 12,930 | 74.5% | 7.4% | 3.5 FPS |
| Pretrained VisDrone YOLO11s | 5,502 | 2,797 | 8,467 | 66.3% | **39.4%** | 1.8 FPS |

The aerial checkpoint improves recall by 32 percentage points (about 5.3×), at the cost of lower precision and speed. It still misses roughly 61% of labelled people, so the operator-confirmation requirement remains. The machine-readable result is `pretrained_yolo11s_visdrone_640.json`; the full per-image CSV remains on the external data drive and is not committed.

Per-image counts are in `visdrone_val_yolov8n_640.csv` and `visdrone_val_yolov8n_1280.csv`; summaries in `summary_*.json`.

- At 1280, 78 of the 531 images that contain people had **no** correct detection at all. Of the 17 images with no labelled people, 2 produced detections.
- Seen from a drone, most people are a few pixels tall. The model finds roughly 1 in 14 people at 640 and about 1 in 5 at 1280, with a false-alarm rate of about one in four to five detections.

## What this means

- A stock COCO YOLO model **cannot be relied on to find people in aerial footage.** In this project it must stay a *candidate* generator that an operator confirms, never an automatic rescue decision. A "no detection" result says nothing about whether people are present.
- Higher resolution helps recall but halves the speed on CPU.
- Realistic next steps: fine-tune on VisDrone **train** (evaluate again on this untouched validation split), try tiled inference, and use a GPU.

## Flood scene classification (pretrained CLIP, no training)

The existing zero-shot `CLIP ViT-B-32 laion2b_s34b_b79k` classifier was evaluated unchanged on FloodNet Challenge Track 1's labelled training subset. The benchmark contains 51 flooded and 347 non-flooded aerial images. It is an external benchmark for this project, not model training and not the challenge's hidden test score.

| Images | Correct six-category predictions | Accuracy | Flood precision | Flood recall | Flood F1 | CPU speed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 398 | 318 | **79.9%** | **82.9%** | **56.9%** | **67.4%** | 1.07 images/s |

For the 51 flooded images, CLIP predicted 29 as flood, 12 as storm damage, 9 as normal and 1 as landslide. For the 347 non-flooded images, 289 were predicted normal and 6 were falsely predicted flood. The full six-label confusion matrix is in `clip_floodnet_track1_labeled.json`.

- Dataset source: FloodNet Challenge - EARTHVISION 2021, Track 1, labelled training subset.
- The full archive and extracted 2.05 GB image subset remain on the external data drive and are not committed.
- FloodNet's publisher-specific terms must be reviewed before redistribution; this repository contains only derived aggregate results.
- The data are imbalanced (51 flood vs 347 normal), so the 79.9% accuracy must be read alongside flood recall. Missing 22 of 51 floods is unacceptable for autonomous emergency decisions.
- CLIP chooses among six scene labels. A non-flooded image predicted as fire, landslide or storm is counted as incorrect even though FloodNet's source label is only non-flooded.

## Limits of these measurements

- Greedy IoU matching, not COCO mAP; the numbers are not directly comparable with published VisDrone leaderboards.
- Detections inside VisDrone "ignored regions" count as false positives, which slightly understates precision.
- CLIP was measured only for flooded vs non-flooded source labels. Fire, earthquake, landslide and storm accuracy still require appropriately labelled external datasets.
- Single run on one CPU; no confidence-threshold sweep.

## Reproduce

```powershell
py convert_visdrone.py --dataset <path>\VisDrone2019-DET-val --out <path>\visdrone_val_yolo
py evaluate_aerial_people.py --images <path>\visdrone_val_yolo\images --labels <path>\visdrone_val_yolo\labels --model yolov8n.pt --imgsz 1280
py build_floodnet_manifest.py --dataset <path>\FloodNetTrack1Labeled --output <path>\floodnet.csv
py evaluate_disaster_dataset.py --manifest <path>\floodnet.csv --image-root <path>\FloodNetTrack1Labeled --output-dir <path>\clip_floodnet
```
