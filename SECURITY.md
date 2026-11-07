# Security Policy

## Supported versions

Security fixes go into the `master` branch.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/boss477/drone-disaster-rescue-simulation/security/advisories/new).
Include steps to reproduce and the impact.

You will get an acknowledgment within a week. Once a fix lands, you will be credited in the
changelog unless you prefer to stay anonymous.

## Simulation only

This project **never controls a real drone, motor or flight controller.** The MAVLink bridge only
streams simulated telemetry (SITL). All people, packages and deliveries in the 3D scenes are
simulated, and image-classifier output is an AI estimate, not a verified emergency decision. The
physical payload-release gate stays blocked from automatic demo approval.

## Threat model

| Area                | Behavior                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local servers       | `sim_server.py` binds to `127.0.0.1` only and serves files from this repository; path traversal is covered by tests (`tests/test_sim_server.py`).             |
| Image upload        | The vision service rejects oversized images and runs models locally; nothing is uploaded to a third party.                                                    |
| External data       | The live-operations views fetch public NASA EONET, USGS, weather and map-tile data. Respect each provider's terms and rate limits.                            |
| Model weights, data | Weights, datasets and PX4/ODM checkouts stay outside Git. `pretrained_assets.json` records source, license and expected checksum for each download.          |
| Map tokens          | The browser-side Cesium ion token is a client-side token and is visible to anyone who loads the page. Restrict its allowed URLs and scopes in your Cesium account, and use your own token for any public deployment. |

### Known limitations

- A default Cesium ion token is committed in `earth_rescue.js` for the out-of-the-box demo. Treat
  it as public; rotate or restrict it in your Cesium ion account if it is abused.
- Do not expose the local servers beyond `127.0.0.1`; they have no authentication.
- Do not rely on this software for any real emergency or flight decision.
