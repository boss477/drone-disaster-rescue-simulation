#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "Warning: Raspberry Pi OS 64-bit (aarch64) is recommended."
fi

sudo apt update
sudo apt install -y \
  python3-venv \
  python3-picamera2 \
  python3-opencv \
  python3-numpy \
  python3-gpiozero \
  v4l-utils

python3 -m venv --system-site-packages "${SCRIPT_DIR}/.venv"
"${SCRIPT_DIR}/.venv/bin/python" -m pip install --upgrade pip setuptools wheel
"${SCRIPT_DIR}/.venv/bin/python" -m pip install \
  --only-binary=:all: \
  -r "${SCRIPT_DIR}/requirements-pi.txt"

"${SCRIPT_DIR}/.venv/bin/python" -m unittest discover \
  -s "${SCRIPT_DIR}/tests" \
  -p "test_*.py"

"${SCRIPT_DIR}/.venv/bin/python" -c \
  "import cv2, torch, torchvision; print('Ready:', cv2.__version__, torch.__version__, torchvision.__version__)"

echo "Installation complete. Test the camera, then run ./run_payload.sh"
