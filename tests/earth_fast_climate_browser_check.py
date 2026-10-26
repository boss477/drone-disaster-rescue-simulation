"""Fast startup must not wait for ion assets; climate demos remain labelled scenarios."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=browser_path())
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        # Keep hosted assets pending: the local scene must still become usable.
        page.route('**/api.cesium.com/**', lambda route: None)
        page.goto('http://127.0.0.1:8877/earth_rescue.html?renderer=cesium', wait_until='domcontentloaded')
        page.wait_for_function('typeof Cesium !== "undefined"')
        page.wait_for_function('viewer && !document.getElementById("runDemo").disabled', timeout=2000)
        assert page.evaluate('viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider')
        print('Fast startup with hosted assets stalled: PASS', flush=True)
        page.select_option('#climateScenario', 'elnino-wet')
        page.locator('#runDemo').click()
        page.wait_for_function('mission && running', timeout=3000)
        assert page.evaluate('mission.climate === "elnino-wet" && selected.lat < 0 && selected.lon < -70')
        assert page.is_checked('#rainEffect')
        page.evaluate('paused=true')
        Path('inspection_reports').mkdir(exist_ok=True)
        page.screenshot(path='inspection_reports/fast_elnino_scene.png')
        page.evaluate('running=false; resetMission()')
        page.select_option('#climateScenario', 'elnino-dry')
        page.locator('#runDemo').click()
        page.wait_for_function('mission && running', timeout=3000)
        assert page.evaluate('mission.climate === "elnino-dry" && !selected.demoScene && selected.lon > 100')
        assert not page.is_checked('#rainEffect')
        assert 'scenario' in page.locator('#climateStatus').inner_text().lower()
        page.evaluate('running=false; resetMission()')
        page.select_option('#climateScenario', 'elnino-india')
        page.select_option('#missionSpeed', '4')
        page.locator('#runDemo').click()
        page.wait_for_function('mission && running', timeout=3000)
        assert page.evaluate('mission.climate === "elnino-india" && selected.lat > 8 && selected.lat < 35 && selected.lon > 68 && selected.lon < 90 && !selected.demoScene')
        assert 'not a current weather alert' in page.locator('#climateStatus').inner_text()
        page.wait_for_function('mission.phase !== "loading"', timeout=3000)
        # Actual wall-clock mission at 4x, no manually advanced phase clocks.
        page.wait_for_function('mission.phase === "complete" && !running', timeout=30000)
        assert page.evaluate('mission.delivered === 3 && mission.outcome === "delivered"')
        page.locator('#missionView').click()
        page.wait_for_timeout(1000)
        assert page.evaluate('viewer.entities.values.filter(e => e.box).length >= 10')
        assert page.evaluate('mission.terrain.heights.every(height => height === 0)'), 'Schematic actors must sit on the ellipsoid surface'
        assert page.evaluate('viewer.camera.positionCartographic.height > 100'), 'Overview camera was pushed onto the globe'
        assert page.evaluate('(() => {const p=Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene,drone.position.getValue()); return p && p.x>0 && p.x<1600 && p.y>0 && p.y<1000;})()'), 'Drone is outside the mission overview'
        page.screenshot(path='inspection_reports/india_elnino_complete.png')
        assert page.locator('.cesium-widget-errorPanel').count() == 0
        assert not errors, errors
        print('Wet/dry regional scenes and complete India mission at 4x: PASS')
        browser.close()


if __name__ == '__main__':
    main()
