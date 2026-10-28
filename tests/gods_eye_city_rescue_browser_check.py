"""Real city renderer: explicit movement and simulated loading/delivery/return."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=browser_path())
        page = browser.new_page(viewport={'width': 1400, 'height': 1000})
        errors, commands = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: commands.append(r.url) if '/__rescue/backend/api/' in r.url and r.method == 'POST' else None)
        page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(content_type='text/css', body=''))
        page.route('**/eonet.gsfc.nasa.gov/api/v3/events*', lambda r: r.fulfill(json={'events': []}))
        page.route('**/earthquake.usgs.gov/**/2.5_day.geojson', lambda r: r.fulfill(json={'features': []}))
        try:
            page.goto('http://127.0.0.1:4173/?nyc=1&drone=1&flightLat=40.7075&flightLon=-74.0113&v=rescue-v4', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_function('window.RescueCityFlight?.getState().modelReady && !RescueCityFlight.getState().planning', timeout=120000)
            chooser = page.get_by_text('EXPLORE MANUALLY', exact=True)
            if chooser.count() and chooser.is_visible():
                chooser.click()
            page.locator('#droneRescueBridge #citySpeed').select_option('16')
            page.locator('#cityFlyForward').click()
            page.wait_for_function('RescueCityFlight.getState().running && !RescueCityFlight.getState().planning', timeout=45000)
            before = page.evaluate('RescueCityFlight.getState().position')
            page.wait_for_timeout(1200)
            assert before != page.evaluate('RescueCityFlight.getState().position'), 'Fly forward did not move the drone'
            page.wait_for_function('RescueCityFlight.getState().arrived', timeout=90000)
            base = page.evaluate('RescueCityFlight.getState().position')
            page.locator('#cityRescue').click()
            page.wait_for_function('RescueCityFlight.getState().rescue.stage === "loading"')
            page.locator('#cityQuickPause').click()
            elapsed = page.evaluate('RescueCityFlight.getState().rescue.elapsed')
            page.wait_for_timeout(700)
            assert page.evaluate('RescueCityFlight.getState().rescue.elapsed') == elapsed
            page.locator('#cityQuickPause').click()
            page.wait_for_function('RescueCityFlight.getState().rescue.stage === "outbound" && RescueCityFlight.getState().running && !RescueCityFlight.getState().planning', timeout=45000)
            assert page.evaluate('RescueCityFlight.getState().rescue.onboard') == 3
            assert page.evaluate('RescueCityFlight.getState().cameraTilt') == 55
            page.locator('#cityQuickPause').click()
            paused_position = page.evaluate('RescueCityFlight.getState().position')
            page.locator('#cityCameraTilt').evaluate('e=>{e.value="60";e.dispatchEvent(new Event("input",{bubbles:true}));}')
            page.locator('#cityCameraOrbit').click()
            assert page.evaluate('RescueCityFlight.getState().cameraTilt') == 60
            pitch = page.evaluate('window.__godsEyeView.viewer.camera.pitch * 180 / Math.PI')
            assert abs(pitch + 60) < 1, ('Camera must remain tilted during rescue', pitch)
            assert page.evaluate('RescueCityFlight.getState().position') == paused_position
            page.locator('#cityQuickPause').click()
            page.wait_for_function('RescueCityFlight.getState().rescue.stage === "unloading"', timeout=90000)
            page.wait_for_timeout(300)
            print('Unloading state:', page.evaluate('RescueCityFlight.getState()'))
            visible = page.evaluate('''() => {
                const v=window.__godsEyeView.viewer;
                // Route lines and markers may overlay the aircraft at its
                // exact destination. Ignore these, but keep opaque city
                // geometry: a building in front must still fail this test.
                const hits=v.scene.drillPick({x:v.canvas.clientWidth/2,y:v.canvas.clientHeight/2},10);
                return hits.find(h=>!h.id?.polyline&&!h.id?.point&&!h.id?.box)?.id?.name;
            }''')
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/new_york_rescue_unloading.png')
            assert visible == 'Rescue quadcopter · simulation', ('Drone hidden at drop zone', visible)
            page.wait_for_function('RescueCityFlight.getState().rescue.stage === "complete"', timeout=120000)
            state = page.evaluate('RescueCityFlight.getState()')
            assert state['rescue']['delivered'] == 3 and state['rescue']['onboard'] == 0, state
            assert sum((state['position'][k] - base[k]) ** 2 for k in ('x', 'y', 'z')) < 1, state
            assert not state['running'] and not state['hardware_commands']
            page.screenshot(path='inspection_reports/new_york_rescue_complete.png')
            # A custom map drop works even when ordinary click-to-fly is off.
            page.locator('#cityDirectToggle').uncheck()
            page.locator('#cityRescueDrop').click()
            page.mouse.click(1050, 700)
            page.wait_for_function('RescueCityFlight.getState().rescue.stage === "loading"')
            page.locator('#cityAbortRescue').click()
            aborted = page.evaluate('RescueCityFlight.getState()')
            page.wait_for_timeout(2500)
            assert page.evaluate('RescueCityFlight.getState().rescue.stage') == 'aborted'
            assert page.evaluate('RescueCityFlight.getState().position') == aborted['position']
            assert page.evaluate('RescueCityFlight.getState().rescue.delivered') == 0
            page.locator('#cityQuickReset').click()
            assert page.evaluate('RescueCityFlight.getState().rescue.stage') == 'idle'
            assert not commands, commands
            assert not errors, errors
            print('New York: tilted 3D follow, live tilt/orbit controls, forward movement, loading pause/resume, 3-package unload animation, exact return to base, custom drop, abort, reset, no hardware calls: PASS')
        finally:
            if page.locator('#cityQuickStatus').count():
                print('Status:', page.locator('#cityQuickStatus').inner_text())
                print('Inventory:', page.locator('#cityRescueInventory').inner_text())
            print('Browser errors:', errors)
            browser.close()


if __name__ == '__main__':
    main()
