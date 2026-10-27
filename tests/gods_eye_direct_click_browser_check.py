"""Default view must hover without a circle and accept clicks without arming a mode."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        page=browser.new_page(viewport={'width':1400,'height':900})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(content_type='text/css',body=''))
        page.route('**/eonet.gsfc.nasa.gov/api/v3/events*',lambda r:r.fulfill(json={'events':[]}))
        page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda r:r.fulfill(json={'features':[]}))
        try:
            page.goto('http://127.0.0.1:4173/?drone=1&flightLat=40.6937&flightLon=-73.7814&v=direct-flight-v2',wait_until='domcontentloaded',timeout=90000)
            page.wait_for_function('window.RescueCityFlight?.getState().modelReady',timeout=90000)
            chooser=page.get_by_text('EXPLORE MANUALLY',exact=True)
            if chooser.count() and chooser.is_visible():chooser.click()
            state=page.evaluate('RescueCityFlight.getState()')
            assert state['mode']=='hover' and not state['running'] and not state['routeVisible'],state
            page.wait_for_timeout(800)
            assert page.evaluate('RescueCityFlight.getState().position')==state['position']
            assert page.locator('#cityDirectFlight').is_visible()
            assert page.locator('#cityDirectToggle').is_checked()
            # Collapse the sidebar: all essential controls must still work.
            page.locator('#droneRescueBridge details').evaluate('e=>e.open=false')
            page.mouse.click(1000,650)
            page.wait_for_function('RescueCityFlight.getState().mode==="destination" && !RescueCityFlight.getState().planning',timeout=45000)
            selected=page.evaluate('RescueCityFlight.getState()')
            assert selected['destination'] and not selected['picking'] and selected['running'],selected
            page.wait_for_timeout(600)
            page.locator('#cityQuickPause').click()
            paused=page.evaluate('RescueCityFlight.getState()')
            page.wait_for_timeout(500)
            assert page.evaluate('RescueCityFlight.getState().position')==paused['position']
            page.locator('#cityQuickPause').click()
            page.wait_for_function('RescueCityFlight.getState().arrived',timeout=90000)
            assert not page.evaluate('RescueCityFlight.getState().running')
            page.locator('#cityDirectToggle').uncheck()
            destination=page.evaluate('RescueCityFlight.getState().destination')
            page.mouse.click(1100,700);page.wait_for_timeout(300)
            assert page.evaluate('RescueCityFlight.getState().destination')==destination
            page.locator('#cityDirectToggle').check()
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/drone_direct_click_v2.png')
            page.locator('#cityQuickReset').click()
            assert not page.evaluate('RescueCityFlight.getState().routeVisible')
            assert not errors,errors
            print('Default hover/no circle, direct map click with no mode button, always-visible controls, pause/resume, arrival, click toggle and reset: PASS')
        finally:
            if page.locator('#cityDirectFlight').count():print('Visible status:',page.locator('#cityQuickStatus').inner_text())
            print('Errors:',errors);browser.close()


if __name__=='__main__':main()
