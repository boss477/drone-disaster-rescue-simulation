"""Real map clicks drive local and intercontinental simulated drone routes."""
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
            page.wait_for_function('window.RescueCityFlight?.getState().running && RescueCityFlight.getState().modelReady',timeout=90000)
            c=page.get_by_text('EXPLORE MANUALLY',exact=True)
            if c.count() and c.is_visible():c.click()
            root=page.locator('#droneRescueBridge')
            page.mouse.move(1050,650);page.mouse.wheel(0,-100)
            page.wait_for_function('!RescueCityFlight.getState().following')
            root.locator('#cityFollow').click()
            assert page.evaluate('RescueCityFlight.getState().following')
            # Selection must free the camera and must be cancellable without
            # changing the old route or leaving the vehicle permanently paused.
            root.locator('#cityDestination').click()
            assert page.evaluate('RescueCityFlight.getState().picking')
            assert not page.evaluate('RescueCityFlight.getState().following')
            page.keyboard.press('Escape')
            assert not page.evaluate('RescueCityFlight.getState().picking')
            assert not page.evaluate('RescueCityFlight.getState().paused')
            root.locator('#citySpeed').select_option('16')
            root.locator('#cityDestination').click()
            page.mouse.click(1050,700)
            page.wait_for_function('RescueCityFlight.getState().mode==="destination" && !RescueCityFlight.getState().planning',timeout=45000)
            local=page.evaluate('RescueCityFlight.getState()')
            assert local['destination'] and local['routeLength']>1,local
            page.wait_for_function('RescueCityFlight.getState().arrived',timeout=90000)
            arrived=page.evaluate('RescueCityFlight.getState()')
            assert not arrived['running'] and arrived['distance']==arrived['routeLength'],arrived
            def actual():
                return page.evaluate('''()=>{const v=__godsEyeView.viewer,e=v.entities.values.find(e=>e.name==='Rescue quadcopter · simulation');const c=v.scene.globe.ellipsoid.cartesianToCartographic(e.position.getValue(v.clock.currentTime));return {lon:c.longitude*180/Math.PI,lat:c.latitude*180/Math.PI}}''')
            assert abs(actual()['lon']-arrived['destination']['lon'])<1e-5
            assert abs(actual()['lat']-arrived['destination']['lat'])<1e-5
            assert 'flightLat=' not in page.url and 'flightLon=' not in page.url
            # Choose another continent on the actual globe. Do not move the
            # simulated vehicle to it through a test hook or an API shortcut.
            root.locator('#citySpeed').select_option('4')
            root.locator('#cityDestination').click()
            root.locator('#reportsTab').click();root.locator('#global').click()
            page.wait_for_timeout(2200)
            page.mouse.click(800,525)
            page.wait_for_function('RescueCityFlight.getState().mode==="destination" && !RescueCityFlight.getState().planning && RescueCityFlight.getState().timeScale>1',timeout=45000)
            far=page.evaluate('RescueCityFlight.getState()')
            assert far['routeLength']>1000000 and far['timeScale']>1,far
            assert abs(far['destination']['lon']+73.78)>10,far
            page.wait_for_function('document.getElementById("droneRescueBridge").shadowRoot.getElementById("cityFlightStatus").textContent.includes("DEMO time")')
            root.locator('#citySpeed').select_option('16')
            page.wait_for_function('RescueCityFlight.getState().arrived',timeout=90000)
            final=page.evaluate('RescueCityFlight.getState()')
            assert not final['running'] and final['arrived'] and final['hardware_commands'] is False
            assert abs(actual()['lon']-final['destination']['lon'])<1e-5
            assert abs(actual()['lat']-final['destination']['lat'])<1e-5
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/drone_selected_destination.png')
            root.locator('#cityReset').click()
            assert page.evaluate('RescueCityFlight.getState().destination') is None
            assert not commands,commands
            assert not errors,errors
            print('Map-click selection/cancel, local arrival, global great-circle flight, labelled demo acceleration, exact coordinates, hover, reset and no hardware commands: PASS',{'local_m':local['routeLength'],'global_m':far['routeLength'],'global_destination':far['destination']})
        finally:
            if page.locator('#droneRescueBridge').count():print('Flight status:',page.locator('#droneRescueBridge #cityFlightStatus').inner_text())
            print('Browser errors:',errors);browser.close()


if __name__=='__main__':main()
