"""Smoke test the optional upstream globe plus our source-preserving handoff."""
import json
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    packet={'title':'Fixture report, not an actual incident','id':'fixture-upstream','feed':'test fixture',
            'kind':'flood','location':{'lat':30.2672,'lon':-97.7431},
            'sources':[{'id':'fixture','url':'https://example.org/report'}]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        try:
            page=browser.new_page(viewport={'width':1440,'height':1000})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:4173/?'+urlencode({'context':json.dumps(packet)}),wait_until='domcontentloaded')
            page.locator('#droneRescueBridge').wait_for(timeout=45000)
            page.wait_for_function('window.__godsEyeView?.viewer',timeout=45000)
            page.wait_for_function('getComputedStyle(document.getElementById("loading-screen")).visibility === "hidden"',timeout=45000)
            assert packet['title'] in page.locator('#droneRescueBridge #context').inner_text()
            assert page.request.get('http://127.0.0.1:4173/cesium/Assets/approximateTerrainHeights.json').headers['content-type'].startswith('application/json')
            # Open only the rescue handoff. Provider and credential settings stay untouched.
            page.locator('#droneRescueBridge #train').click()
            page.wait_for_url('**/fictional_rescue.html?context=*')
            page.wait_for_function('window.FictionalRescue')
            assert page.evaluate('fictionalMissionContext.id')=='fixture-upstream'
            assert page.evaluate('fictionalMissionContext.sources[0].url')=='https://example.org/report'
            assert not errors,errors
            print('Upstream app loaded, Cesium static assets served, report/source retained into fictional scene: PASS')
        finally:browser.close()


if __name__=='__main__':main()
