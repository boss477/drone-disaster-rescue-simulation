"""Live global-layer check: automatic 3D at cities and camera-safe mountain exploration.

Needs the configured Cesium ion token and internet; asserts actual geometry, not fixtures.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        page=browser.new_page(viewport={'width':1600,'height':1000})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://127.0.0.1:8877/earth_rescue.html',wait_until='domcontentloaded')
        page.wait_for_function('window.RescueWorld?.getState().active')
        assert page.is_checked('#detailedEarth')
        assert page.evaluate('viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider'), 'Hidden reference must not duplicate terrain downloads'
        Path('inspection_reports').mkdir(exist_ok=True)
        for name,lat,lon,mountain in [('bengaluru',12.973,77.61,False),('everest',27.9881,86.925,True),('dubai',25.1972,55.2744,False)]:
            page.locator('#exploreLat').fill(str(lat))
            page.locator('#exploreLon').fill(str(lon))
            page.locator('#exploreWorld').click()
            page.wait_for_function('RescueWorld.getState().groundKnown && RescueWorld.getState().terrainVisible > 0',timeout=90000)
            if mountain:
                page.wait_for_function('RescueWorld.getState().groundHeight > 6000',timeout=90000)
            else:
                page.wait_for_function('RescueWorld.getState().buildingVisible > 0',timeout=90000)
            page.wait_for_timeout(5000)
            state=page.evaluate('RescueWorld.getState()')
            assert state['detailed'] and abs(state['origin']['lat']-lat)<1e-6
            if name=='bengaluru': assert state['groundHeight']>600, 'Bengaluru cannot be below sea level'
            assert state['terrainVisible']>0, state
            assert state['cameraAltitude']>state['groundHeight']+25, state
            assert 'visible tiles' in page.locator('#worldCoverage').inner_text()
            page.screenshot(path=f'inspection_reports/global_3d_{name}.png')
            print(name+': '+json.dumps(state),flush=True)
        page.locator('#exploreLat').fill('91')
        page.locator('#exploreWorld').click()
        assert '−90 to 90' in page.locator('#exploreStatus').inner_text()
        assert not errors,errors
        print('Default global 3D, city buildings, mountain terrain, terrain-aware camera and coordinate validation: PASS')
        browser.close()


if __name__=='__main__':
    main()
