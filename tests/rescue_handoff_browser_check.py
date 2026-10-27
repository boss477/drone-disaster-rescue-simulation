"""Report/AI metadata, safe URL handling and failed-delivery exercise checks."""
import datetime
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    incident={'id':'fixture-fire','title':'Fixture fire — fictional test report','kind':'fire','feed':'NASA EONET',
              'reported_at':now,'retrieved_at':now,'location':{'lat':12.97,'lon':77.61},
              'sources':[{'url':'https://example.org/report','id':'fixture'}]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        try:
            page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.add_init_script('''if(location.pathname.endsWith('fictional_rescue.html')){
              window.__frames=[];window.requestAnimationFrame=cb=>{window.__frames.push(cb);return 1};
              window.__time=null;window.__step=n=>{if(window.__time===null)window.__time=performance.now();for(let i=0;i<n;i++){window.__time+=100;window.__frames.shift()(window.__time)}};
            }''')
            root='http://127.0.0.1:8877/'
            fixture={'events':[{'id':incident['id'],'title':incident['title'],'categories':[{'title':'Wildfires'}],
              'sources':incident['sources'],'geometry':[{'date':now,'type':'Point','coordinates':[77.61,12.97]}]}]}
            page.route('**/eonet.gsfc.nasa.gov/api/v3/events*',lambda route:route.fulfill(json=fixture))
            page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda route:route.fulfill(json={'features':[]}))
            page.route('**/api.open-meteo.com/**',lambda route:route.fulfill(json={'current':{'temperature_2m':28,'wind_speed_10m':13,'rain':0,'time':now},'timezone_abbreviation':'UTC'}))
            page.goto(root+'earth_rescue.html?incidents=1',wait_until='domcontentloaded')
            page.wait_for_function('typeof viewer !== "undefined" && viewer && hazards.some(e=>e.id==="fixture-fire")',timeout=45000)
            page.evaluate('selectIncident("fixture-fire")')
            page.wait_for_function('selected.weather?.temperature===28')
            assert '4173' in page.locator('#godsEyeIncident').get_attribute('href')
            page.locator('#fictionalIncident').click()
            page.wait_for_url('**/fictional_rescue.html?context=*')
            page.wait_for_function('window.FictionalRescue',polling=100)
            assert page.evaluate('fictionalMissionContext.id')==incident['id']
            assert page.evaluate('fictionalMissionContext.weather.wind')==13
            page.goto(root+'fictional_rescue.html',wait_until='networkidle')
            page.wait_for_function('window.FictionalRescue')
            packet={'incident':incident,'weather':{'temperature':28,'wind':13,'rain':0,'time':now,'retrieved_at':now},
                    'review':{'disaster':{'category':'fire','confidence':.8},'people_count':7,'timestamp':now}}
            url=page.evaluate('(data)=>RescueHandoff.sceneURL(data)',packet)
            assert page.evaluate('RescueHandoff.fromURL("?context=bad-json")') is None
            assert page.evaluate('RescueHandoff.clean({location:{lat:999,lon:0}})') is None
            assert page.evaluate('RescueHandoff.clean({location:{lat:0,lon:0},sources:[{url:"javascript:alert(1)"}]}).sources.length')==0
            assert page.evaluate('RescueHandoff.clean({location:{lat:null,lon:0}})') is None
            page.goto(root+url,wait_until='networkidle')
            page.wait_for_function('window.FictionalRescue')
            page.locator('.context summary').click()
            text=page.locator('#reportContext').inner_text()
            assert incident['title'] in text and 'possible people 7' in text and 'three fictional recipients' in text
            assert 'Open-Meteo' in text and 'not the reported location' in text
            assert page.locator('#hazard').input_value()=='fire'
            assert '4173' in page.locator('#godView').get_attribute('href')
            page.select_option('#outcome','abort');page.select_option('#speed','4')
            page.locator('#start').click()
            page.evaluate('__step(140)')
            final=page.evaluate('FictionalRescue.getState()');log=page.evaluate('FictionalRescue.getLog()')
            assert not final['running'] and final['delivered']==0 and final['onboard']==3,final
            assert final['position'][1]<3 and log['outcome']=='aborted'
            assert log['hardware_commands'] is False and log['context']['id']==incident['id']
            assert any(e['type']=='ABORT' for e in log['events'])
            with page.expect_download() as download:
                page.locator('#download').click()
            saved=json.loads(Path(download.value.path()).read_text())
            assert saved['outcome']=='aborted' and saved['context']['review']['people_count']==7
            page.locator('#reset').click();page.select_option('#outcome','success')
            page.locator('#start').click();page.evaluate('__step(5)')
            loaded=page.evaluate('FictionalRescue.getState().onboard')
            page.locator('#abort').click();page.evaluate('__step(55)')
            assert page.evaluate('FictionalRescue.getState().onboard')==loaded
            assert page.evaluate('FictionalRescue.getLog().outcome')=='aborted'
            for hazard in ['storm','flood','fire']:
                page.select_option('#hazard',hazard);page.evaluate('__step(1)')
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/fictional_report_abort.png')
            assert not errors,errors
            print('Report/AI/weather handoff, source URLs, unsafe-zone abort, early abort inventory, mission JSON and hazard effects: PASS')
        finally:browser.close()


if __name__=='__main__':main()
