"""Live streamed NYC buildings: verify geometry, camera, provenance and controls."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        try:
            page=browser.new_page(viewport={'width':1600,'height':1050})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:4173/?nyc=1',wait_until='domcontentloaded')
            page.wait_for_function('window.RescueNewYork && !RescueNewYork.getState().loading',timeout=90000)
            root=page.locator('#droneRescueBridge')
            state=page.evaluate('RescueNewYork.getState()')
            assert state['source'] in ['nyc','osm'],root.locator('#nycStatus').inner_text()
            page.wait_for_function('RescueNewYork.getState().featuresLoaded>0',timeout=60000)
            page.wait_for_function('getComputedStyle(document.getElementById("loading-screen")).visibility === "hidden"',timeout=45000)
            chooser=page.get_by_text('EXPLORE MANUALLY',exact=True)
            if chooser.count() and chooser.is_visible():chooser.click()
            if state['source']=='osm':
                assert 'unavailable to this token' in root.locator('#nycNotice').inner_text()
                assert root.locator('#nycSource').input_value()=='osm'
            for view in ['midtown','city','downtown']:
                root.locator('#nycView').select_option(view)
                page.wait_for_timeout(2000)
                coords=page.evaluate('''()=>{const p=__godsEyeView.viewer.camera.positionCartographic;return {lat:p.latitude*180/Math.PI,lon:p.longitude*180/Math.PI}}''')
                assert abs(coords['lat']-40.73)<.6 and abs(coords['lon']+74)<.6,coords
            root.locator('#nycHide').click()
            assert page.evaluate('RescueNewYork.getState().visible') is False
            root.locator('#nycHide').click()
            assert page.evaluate('RescueNewYork.getState().visible') is True
            page.evaluate("dispatchEvent(new CustomEvent('gev:map-stack-changed',{detail:{activeId:'photoreal'}}))")
            assert page.evaluate('RescueNewYork.getState().visible') is False
            root.locator('#nycHide').click()
            assert page.evaluate('RescueNewYork.getState().visible') is True
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/new_york_buildings_live.png')
            final=page.evaluate('RescueNewYork.getState()')
            assert final['featuresLoaded']>0 and final['tileLoads']>0,final
            root.locator('#nycAsset').fill('0');root.locator('#nycSource').select_option('nyc')
            page.wait_for_function('!RescueNewYork.getState().loading')
            assert 'positive numeric asset ID' in root.locator('#nycStatus').inner_text()
            assert not errors,errors
            print('Real NYC-view geometry, source/fallback labels, three camera presets, show/hide and invalid asset ID: PASS',final)
        finally:browser.close()


if __name__=='__main__':main()
