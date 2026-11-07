# Contributing

Thanks for helping. This is a **simulation-only** research and demo project. Changes must never add
code that commands real vehicles, motors or flight controllers.

## Ground rules

- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Open an issue before a large change so we can agree on the approach.
- Keep pull requests focused: one change, one reason.
- Keep the honesty of the docs: say what is simulated, what is measured, and what is an estimate.
- Large files (model weights, datasets, PX4 or ODM checkouts) stay out of Git; record source,
  license and checksum in `pretrained_assets.json` instead.

## Setup

Requires Windows 10/11 for the PowerShell launchers, Python 3.12, and Node.js 20+ for the 3D
build scripts.

```powershell
git clone https://github.com/boss477/drone-disaster-rescue-simulation.git
cd drone-disaster-rescue-simulation
./setup.ps1
./run_rescue_simulation.ps1
```

See the [README](README.md) for each part (classifier, 3D simulation, live operations map,
QGroundControl telemetry, payload).

## Before you open a pull request

```powershell
py -m unittest discover -s tests            # Python tests
node --test tests/city_route_math.test.mjs   # route math
```

- Add or update a test for behavior changes. Files named `*_browser_check.py` are manual browser
  checks and are not run by CI; run the relevant one if you touch the renderer.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
- Update the README or [PROJECT_STATUS.md](PROJECT_STATUS.md) if the change affects the
  documented status.

## Commit messages

Short, imperative, with a type prefix: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`,
`refactor:`.
