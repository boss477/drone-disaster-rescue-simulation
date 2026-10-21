"""Rescue Drone prototype - laptop camera, person detection, and Nano control.

Simulation/hardware demo only. Set PORT before running. The program will not
open a serial connection until a real Nano is connected at that port.
"""
import threading
import time

import cv2
import serial
from ultralytics import YOLO

PORT = "COM3"
BAUD = 9600
CONFIRM_FRAMES = 15
CONF = 0.6


def main():
    ser = serial.Serial(PORT, BAUD, timeout=1)
    time.sleep(2)
    gps = {"lat": None, "lon": None, "sats": 0}
    stop = threading.Event()

    def read_serial():
        while not stop.is_set():
            try:
                line = ser.readline().decode(errors="ignore").strip()
            except (serial.SerialException, OSError):
                continue
            if line.startswith("GPS,") and "NOFIX" not in line:
                _, lat, lon, sats = line.split(",")
                gps.update(lat=float(lat), lon=float(lon), sats=int(sats))
            elif line.startswith("GPS,NOFIX"):
                gps.update(lat=None, lon=None)

    threading.Thread(target=read_serial, daemon=True).start()
    model = YOLO("yolov8n.pt")
    cap = cv2.VideoCapture(0)
    streak, released = 0, False
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            result = model(frame, classes=[0], conf=CONF, verbose=False)[0]
            found = len(result.boxes) > 0
            for box in result.boxes.xyxy:
                x1, y1, x2, y2 = map(int, box)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            streak = streak + 1 if found else 0
            if streak >= CONFIRM_FRAMES and not released:
                ser.write(b"R")
                released = True
                print("PERSON CONFIRMED -> PAYLOAD RELEASED at", gps)
            gtxt = (f"GPS {gps['lat']:.6f}, {gps['lon']:.6f} ({gps['sats']} sats)"
                    if gps["lat"] is not None else "GPS: no fix")
            status = "PAYLOAD RELEASED" if released else ("PERSON" if found else "SEARCHING")
            cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, .9, (0, 0, 255), 2)
            cv2.putText(frame, gtxt, (10, 65), cv2.FONT_HERSHEY_SIMPLEX, .7, (255, 255, 0), 2)
            cv2.imshow("Rescue Drone", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("r"):
                ser.write(b"R")
                released = True
            if key == ord("l"):
                ser.write(b"L")
                released, streak = False, 0
    finally:
        stop.set()
        cap.release()
        cv2.destroyAllWindows()
        ser.close()


if __name__ == "__main__":
    main()
