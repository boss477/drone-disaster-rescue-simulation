# Technical Audit of the Original Project

## Overall assessment

The dual-stage idea is suitable for an Autonomous Drones subject as a low-cost perception payload demonstration: first confirm the target is a wall, then inspect that region for a crack. The existing weights and sample outputs are useful, but the original code should not be described as flight-ready or as crack localization.

## Evidence found in the supplied archive

- Stage 1 is a ResNet18 wall/not-wall image classifier with a custom 128-unit head.
- Stage 2 is a ResNet50 uncracked/cracked image classifier with a custom 256-unit head.
- The wall confusion matrix is `[[24896, 11], [12, 1744]]`, which is approximately 99.91% accuracy on that validation set.
- The crack confusion matrix is `[[9063, 460], [756, 942]]`, approximately 89.16% accuracy.
- Crack-class precision is approximately 67.2%; recall is approximately 55.5%; F1 is approximately 60.8%.
- The original UI draws a fixed central scan rectangle. It does not output a learned crack bounding box or pixel mask.

## Important issues

### Crack recall is the main risk

The system misses 756 of 1,698 actual cracked samples in the supplied crack confusion matrix. Overall accuracy looks stronger because the validation set has many more negative than positive samples. For structural inspection, crack recall and false negatives matter more than accuracy alone.

### Wall evaluation may not represent exhibition conditions

The wall validation set is heavily imbalanced: 24,907 not-wall examples versus 1,756 wall examples. Near-perfect holdout performance should be checked against fresh Pi Camera images from the actual room, wall materials, lighting, distance, and viewing angles.

### Classification is not localization

Both custom networks classify the complete central region after resizing it to 224 x 224. The application can state “crack likely in this scan area,” but it cannot truthfully identify the precise crack location, length, width, or severity.

### Camera quality is only part of the problem

More pixels and better focus can make thin cracks visible, but a new camera cannot correct missed classes, dataset imbalance, domain shift, or a crack that occupies too little of the 224 x 224 input. Lighting, working distance, focus, and Pi-specific validation are equally important.

### Original deployment risks

- Camera capture was hard-coded to Windows DirectShow.
- Dataset and model paths were hard-coded to Windows drives/desktops.
- The Torchvision object detector attempted to download weights when first launched.
- “Person” was inferred mainly from a face cascade, which can miss a full body turned away from the camera.
- Several scripts forced a binary label on every frame without a stable/uncertain state.
- “Severity” derived from Canny edge pixels was not a validated crack measurement.
- The report described near-zero latency and edge readiness without a Raspberry Pi benchmark.

## Changes in this payload edition

The new application adds native Picamera2 support, USB fallback, local SSDLite weights, person priority, screen rejection, frame-quality gates, temporal smoothing, uncertainty states, evidence logging, optional indicators, relative paths, a single configuration file, and automated state-machine tests.

## Recommended work after the exhibition

1. Capture a dedicated Raspberry Pi Camera test set without reusing training scenes.
2. Report crack precision, recall, F1, confusion matrix, and inference latency on the Pi.
3. Adjust the classification threshold from a precision-recall curve rather than choosing it by eye.
4. Retrain a small backbone such as MobileNetV3 using Pi-like augmentations and balanced sampling.
5. If the project must mark the crack itself, annotate masks/boxes and train a detection or segmentation model.
