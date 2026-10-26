"""Browser UI contract check; model outputs are fixtures, not accuracy evidence."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=browser_path())
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        fixture = {'status': 'complete', 'result': {
            'width': 640, 'height': 480, 'boxes': [{'xyxy': [10, 20, 80, 150], 'confidence': .8}],
            'people_count': 1, 'disaster': {'category': 'flood scene', 'confidence': .8,
                                           'scores': {'flood scene': .8, 'normal scene': .2}},
            'errors': {}, 'elapsed_seconds': .5, 'timestamp': '2026-10-26T00:00:00Z'}}
        page.route('**/api/vision', lambda route: route.fulfill(
            status=202 if route.request.method == 'POST' else 200,
            content_type='application/json', body=json.dumps(
                {'accepted': True} if route.request.method == 'POST' else fixture)))
        page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8877/earth_rescue.html')
        page.locator('#visionFile').set_input_files(str(Path('samples/flood_street.jpg').resolve()))
        page.locator('#analyseImage').click()
        page.wait_for_function("document.getElementById('visionResults').textContent.includes('Possible people: 1')")
        assert 'flood scene' in page.locator('#visionResults').inner_text()
        assert page.locator('#visionPreview').is_visible()
        page.wait_for_function('viewer && !document.getElementById("runDemo").disabled', timeout=60000)
        page.evaluate("setLocation(46.8421,-91.994,'Review area','operator','unknown')")
        page.locator('#useVisionArea').click()
        assert page.evaluate("!targetConfirmed && selected.source === 'operator-placed image review'")
        assert 'IMAGE_AI_REVIEW' in page.locator('#missionLog').inner_text()
        page.locator('#restore3d').click()
        page.wait_for_function('mission && mission.phase === "loading"', timeout=30000)
        page.evaluate('paused = true; missionClock = mission.phaseStart + 3.1')
        page.wait_for_function('mission.phase === "takeoff"')
        page.evaluate('missionClock = mission.phaseStart + 4.1')
        page.wait_for_function('mission.phase === "outbound"')
        assert page.evaluate('viewer.scene.mode === Cesium.SceneMode.SCENE3D && viewer.camera.pitch > -1.3')
        assert page.evaluate('viewer.entities.values.filter(e => e.box).length >= 10')
        assert page.locator('.cesium-widget-errorPanel').count() == 0
        page.wait_for_timeout(2000)
        Path('inspection_reports').mkdir(exist_ok=True)
        page.locator('#panel').evaluate('element => element.scrollTop = 0')
        page.screenshot(path='inspection_reports/unified_rescue_dashboard.png')
        page.evaluate("running = false; setLocation(25.2,55.3,'New area','operator','unknown')")
        assert page.evaluate('mission === null && document.getElementById("missionHud").hidden')
        assert not errors, errors
        print('Unified upload, both result panels, review attachment, 3D restore and stale mission reset: PASS')
        browser.close()


if __name__ == '__main__':
    main()
