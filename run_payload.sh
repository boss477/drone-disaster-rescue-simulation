#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${SCRIPT_DIR}/.venv/bin/python"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Virtual environment not found. Run ./install_pi.sh first." >&2
  exit 1
fi

cd "${SCRIPT_DIR}"
exec "${PYTHON}" payload_app.py --camera auto --fullscreen "$@"
