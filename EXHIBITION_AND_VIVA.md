# Exhibition Demonstration and Viva Notes

## One-minute project explanation

“This is a low-cost autonomous perception payload for structural inspection. A Raspberry Pi and camera process the scene locally. A person-and-screen detector runs first for safety and context. The system checks image quality, then a ResNet18 confirms that the scan area is a wall. Only a confirmed wall is sent to the heavier ResNet50 crack classifier, which saves computation. The program reports crack, no crack, or uncertain and logs the result. This prototype demonstrates onboard perception without requiring an expensive drone.”

## Demonstration sequence

1. Power the payload and start the full-screen program.
2. Stand in front of the camera: show `PERSON DETECTED - INSPECTION PAUSED`.
3. Hold a phone/laptop image in the central box: show object rejection.
4. Cover the lens or move the sample too close: show the quality gate.
5. Present your pre-tested clean-wall print: show wall confirmation and no-crack result.
6. Present the supplied obvious cracked-wall sample: show the crack alert and red indicator/buzzer if connected.
7. Show the saved CSV log and crack evidence image.

Use known, pre-tested samples for the formal demo, then invite one live test. Real-time machine-learning systems are affected by lighting, focus, angle, and domain shift.

## Likely viva questions

**Why call it an autonomous drone project if there is no drone?**

The payload autonomously performs perception, safety gating, sequential decision-making, and logging. The exhibition prototype excludes flight hardware because the assessment is focused on the payload function and cost. A flight controller could later consume the payload states to hold, reposition, or avoid a person.

**Why use two models?**

The smaller wall model acts as a context gate. The heavier crack model runs only for a likely wall, reducing unnecessary work and false crack alarms from unrelated scenes.

**What is the input to the models?**

The central camera region is resized to 224 x 224 RGB pixels and normalized with ImageNet mean and standard deviation.

**Does the red rectangle locate the crack?**

No. It shows the region being classified. Exact localization would require a detector or segmentation model trained with crack boxes or masks.

**Why is there an uncertain result?**

A safety-oriented system should not force an ambiguous score into “safe.” The payload asks for a better angle, focus, or lighting when the score lies between the safe and alert thresholds.

**What happens when a person appears?**

The COCO SSDLite detector identifies a person anywhere in the frame. Person detection overrides the wall/crack pipeline, clears previous temporal scores, displays a pause state, and can flash the red indicator.

**Why use Raspberry Pi?**

It is low-cost, compact, supports CSI cameras and GPIO, and can run the complete inference pipeline locally without a network connection after setup.

**What are the current measured model results?**

The supplied crack confusion matrix gives about 89.16% overall accuracy, but the more important cracked-class recall is about 55.5%. Therefore this is an academic prototype, not a certified structural safety instrument.

**Will a better webcam solve the crack errors?**

It may improve focus and visibility, but not dataset bias or model generalization. Pi Camera test data, balanced training, threshold calibration, and possibly a smaller retrained model are also required.

**How would it connect to a real drone later?**

The Raspberry Pi would be mounted as a companion computer. It could send compact states such as PERSON, NO_WALL, WALL_SAFE, CRACK, and RESCAN to a Pixhawk-class flight controller over UART/USB using MAVLink. Flight integration needs separate failsafes, vibration isolation, power regulation, and permission for safe testing.

## Claims to avoid

- Do not say the system measures crack width or severity.
- Do not say it has 100% real-world accuracy.
- Do not say it performs autonomous flight.
- Do not say a “safe” result guarantees structural safety.
- Do not call the fixed scan box a crack bounding box.

## Final checklist

- Camera ribbon is secure and lens is clean.
- Model checksums pass.
- Program starts without internet.
- Lighting and sample distance are marked on the table.
- Clean, cracked, and uncertain samples were tested on the same Pi.
- HDMI/VNC display and keyboard work.
- Power supply is stable and ventilation is unobstructed.
- Optional GPIO wiring was checked before enabling `--gpio`.
- A backup USB drive contains this complete folder.
- The demo script and honest limitations are memorized.
