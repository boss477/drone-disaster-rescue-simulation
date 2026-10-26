"""Manual Cesium render regression check; run while the local dashboard server is up.

    py tests/earth_render_browser_check.py http://127.0.0.1:8877/earth_rescue.html

Requires Playwright and an installed Chromium/Chrome browser.
"""

import shutil
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def browser_path():
    paths = [
        shutil.which("chrome"),
        shutil.which("chromium"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    ]
    return next((path for path in paths if path and Path(path).is_file()), None)


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8877/earth_rescue.html"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=browser_path())
        try:
            page = browser.new_page()
            page.goto(url + ('&' if '?' in url else '?') + 'renderer=cesium', wait_until="domcontentloaded")
            page.wait_for_function("typeof viewer !== 'undefined' && viewer !== null")
            page.evaluate("viewer.camera.frustum.near = 0")
            page.wait_for_timeout(2000)
            assert page.locator(".cesium-widget-errorPanel").count() == 0, (
                "Cesium stopped rendering after a zero near-plane"
            )
            assert page.evaluate("viewer.camera.frustum.near") > 0
            print("Cesium camera near-plane regression: PASS")
            page.evaluate("viewer.scene.renderError.raiseEvent(viewer.scene, new Error('test render failure'))")
            page.wait_for_function(
                "document.getElementById('earthStatus').textContent.includes('Safe OpenStreetMap globe ready')"
            )
            assert page.evaluate("viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider")
            print("Cesium safe-map recovery: PASS")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
