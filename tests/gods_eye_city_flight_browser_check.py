"""Actual GLB drone, streamed city geometry, movement and operator controls."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        page=browser.new_page(viewport={'width':1600,'height':1050})
        errors=[];commands=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:commands.append(r.url) if '/__rescue/backend/api/' in r.url and r.method=='POST' else None)
        page.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(content_type='text/css',body=''))
        page.route('**/eonet.gsfc.nasa.gov/api/v3/events*',lambda r:r.fulfill(json={'events':[]}))
        page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda r:r.fulfill(json={'features':[]}))
        try:
            page.goto('http://127.0.0.1:4173/?drone=1&flightLat=40.6937&flightLon=-73.7814',wait_until='domcontentloaded',timeout=90000)
            page.wait_for_function('window.RescueCityFlight?.getState().running',timeout=90000)
            page.wait_for_function('RescueCityFlight.getState().modelReady && RescueNewYork.getState().featuresLoaded>0',timeout=60000)
            chooser=page.get_by_text('EXPLORE MANUALLY',exact=True)
            if chooser.count() and chooser.is_visible():chooser.click()
            before=page.evaluate('RescueCityFlight.getState()')
            assert abs(before['centre']['lat']-40.6937)<1e-6
            assert abs(before['centre']['lon']+73.7814)<1e-6
            page.wait_for_timeout(2500)
            after=page.evaluate('RescueCityFlight.getState()')
            assert after['distance']>before['distance']+1,(before,after)
            assert after['cruiseHeight']>=after['groundHeight']+25
            assert after['hardware_commands'] is False
            root=page.locator('#droneRescueBridge')
            root.locator('#cityPause').click()
            paused=page.evaluate('RescueCityFlight.getState()')
            page.wait_for_timeout(700)
            assert page.evaluate('RescueCityFlight.getState().position')==paused['position']
            assert page.evaluate('RescueCityFlight.getState().paused') is True
            root.locator('#cityPause').click();root.locator('#citySpeed').select_option('16')
            page.wait_for_timeout(700)
            assert page.evaluate('RescueCityFlight.getState().distance')>paused['distance']
            root.locator('#cityFollow').click()
            assert page.evaluate('RescueCityFlight.getState().following') is False
            root.locator('#cityFollow').click()
            assert page.evaluate('RescueCityFlight.getState().following') is True
            root.locator('#cityPause').click()
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/new_york_drone_city_flight.png')
            root.locator('#cityReset').click()
            assert not page.evaluate('RescueCityFlight.getState().running')
            assert page.evaluate('RescueCityFlight.getState().distance')==0
            assert page.evaluate('RescueNewYork.getState().visible') is True
            assert not commands,commands
            assert not errors,errors
            print('Real animated drone GLB + actual city buildings, current-area route, movement, model-height clearance, pause/resume, follow/free camera, speed, reset and no hardware calls: PASS',after)
        finally:
            if page.locator('#droneRescueBridge').count():
                print('Flight status:',page.locator('#droneRescueBridge #cityFlightStatus').inner_text())
                print('Browser errors:',errors)
            browser.close()


if __name__=='__main__':main()
