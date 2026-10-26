"""Synthetic report fixtures + actual 3D world + incident-local rescue mission."""
import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    now=datetime.datetime.now(datetime.timezone.utc)
    def event(id,title,category,lat,lon,age=0):
        return {'id':id,'title':title,'categories':[{'title':category}],
                'sources':[{'id':'test','url':'https://example.org/report/'+id}],
                'geometry':[{'date':(now-datetime.timedelta(days=age)).isoformat(),'type':'Point','coordinates':[lon,lat]}]}
    eonet={'events':[event('fixture-flood','Fixture flood — not a real report','Floods',12.973,77.61),
                     event('fixture-fire','Fixture wildfire — not a real report','Wildfires',27.9881,86.925),
                     event('fixture-old','Old fixture report','Volcanoes',25.1972,55.2744,100)]}
    usgs={'features':[{'id':'fixture-quake','properties':{'type':'earthquake','title':'Fixture quake','time':int(now.timestamp()*1000),'url':'https://example.org/quake'},
                       'geometry':{'type':'Point','coordinates':[55.2744,25.1972,10]}}]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        page=browser.new_page(viewport={'width':1600,'height':1000})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/eonet.gsfc.nasa.gov/api/v3/events*',lambda route:route.fulfill(json=eonet))
        page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda route:route.fulfill(json=usgs))
        page.goto('http://127.0.0.1:8877/earth_rescue.html?incidents=1',wait_until='domcontentloaded')
        page.wait_for_function('window.RescueWorld?.getState().incidentMarkers === 3 && hazards.length===4')
        assert page.locator('#eventList .event').count()==3
        page.select_option('#incidentAge','all')
        page.wait_for_function('RescueWorld.getState().incidentMarkers===4')
        page.select_option('#incidentAge','30')
        page.locator('#showQuake').uncheck()
        page.wait_for_function('RescueWorld.getState().incidentMarkers===2')
        page.locator('#showQuake').check()
        page.wait_for_function('RescueWorld.getState().incidentMarkers===3')
        marker=page.evaluate('RescueWorld.incidentScreens().find(p=>p.id==="fixture-flood")')
        assert marker['visible'] and marker['x']>430,marker
        page.mouse.click(marker['x'],marker['y'])
        page.wait_for_function('selected?.incident?.id === "fixture-flood"')
        assert page.locator('#incidentContext').is_visible()
        assert page.locator('#incidentSource').get_attribute('href')=='https://example.org/report/fixture-flood'
        page.wait_for_function('RescueWorld.getState().groundKnown && !document.getElementById("rescueIncident").disabled',timeout=90000)
        assert page.evaluate('selected.incident.location.lat===12.973 && Math.abs(targetFor().lat-12.973)<1e-8')
        page.select_option('#missionSpeed','4')
        page.locator('#rescueIncident').click()
        page.wait_for_function('mission && running && mission.incident?.id === "fixture-flood"')
        assert page.evaluate('Math.abs(mission.target.lat-12.973)<1e-8 && Math.abs(mission.target.lon-77.61)<1e-8 && mission.autoDemo')
        assert page.evaluate('mission.terrain.sampled && mission.terrain.heights[0]>600 && mission.hoverAltitude>mission.dropAltitude+20')
        page.wait_for_function('mission.delivered>0',timeout=30000)
        Path('inspection_reports').mkdir(exist_ok=True)
        page.screenshot(path='inspection_reports/incident_aid_delivery.png')
        page.wait_for_function('mission.phase==="complete" && !running',timeout=30000)
        assert page.evaluate('mission.delivered===3 && mission.outcome==="delivered"')
        payload=page.evaluate('fetch("/api/state").then(r=>r.json())')['state']
        assert payload['incident_id']=='fixture-flood' and payload['automatic_demo'] and not payload['operator_release_approved'],payload
        page.select_option('#incidentOutcome','abort')
        page.locator('#rescueIncident').click()
        page.wait_for_function('running && mission.scenario==="abort"',timeout=30000)
        page.wait_for_function('mission.phase==="complete" && !running',timeout=35000)
        assert page.evaluate('mission.delivered===0 && mission.outcome==="aborted"')
        page.unroute('**/earthquake.usgs.gov/**/2.5_day.geojson')
        page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda route:route.abort())
        page.locator('#refresh').click()
        page.wait_for_function('document.getElementById("feedStatus").textContent.includes("USGS unavailable")')
        assert page.evaluate('hazards.some(e=>e.id==="usgs-fixture-quake")')
        assert not errors,errors
        print('Globe marker selection, report filters, source provenance, incident-local delivery/abort, hardware gate and partial feed outage: PASS')
        browser.close()


if __name__=='__main__':main()
