"""Optional live-source smoke check. Does not replace deterministic mission tests."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=browser_path())
    page=browser.new_page(viewport={'width':1600,'height':1000})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:8877/earth_rescue.html?incidents=1',wait_until='domcontentloaded')
    page.wait_for_function('window.RescueWorld?.getState().incidentMarkers>0 && !refreshingIncidents',timeout=45000)
    stats=page.evaluate('({feeds:Object.fromEntries(Object.entries(incidentFeeds).map(([k,v])=>[k,{records:v.events.length,error:v.error,time:v.time}])),markers:RescueWorld.getState().incidentMarkers})')
    assert not any(feed['error'] for feed in stats['feeds'].values()),stats
    page.wait_for_timeout(2000)
    Path('inspection_reports').mkdir(exist_ok=True)
    page.screenshot(path='inspection_reports/live_incident_globe.png')
    chosen=page.evaluate('visibleIncidents().find(e=>e.feed==="NASA EONET" && ["fire","flood","volcano","landslide"].includes(kindFor(e)))?.id || visibleIncidents()[0].id')
    page.evaluate('id=>selectIncident(id)',chosen)
    page.wait_for_function('selected?.incident && RescueWorld.getState().groundKnown && RescueWorld.getState().terrainVisible>0',timeout=90000)
    page.wait_for_timeout(3000)
    stats['selected']=page.evaluate('selected.incident')
    page.screenshot(path='inspection_reports/live_incident_3d_area.png')
    if '--mission' in sys.argv:
        page.select_option('#missionSpeed','4')
        page.locator('#rescueIncident').click()
        page.wait_for_function('mission?.incident && mission.delivered>0',timeout=60000)
        page.screenshot(path='inspection_reports/live_report_simulated_delivery.png')
        page.wait_for_function('mission.phase==="complete" && !running',timeout=30000)
        assert page.evaluate('mission.delivered===3 && mission.incident.id===selected.incident.id')
        stats['simulated_mission']=page.evaluate('({incident:mission.incident.id,delivered:mission.delivered,outcome:mission.outcome})')
    assert not errors,errors
    print(json.dumps(stats),flush=True)
    print('Live NASA EONET + USGS feeds, visible globe reports and selected-area 3D terrain: PASS')
    browser.close()
