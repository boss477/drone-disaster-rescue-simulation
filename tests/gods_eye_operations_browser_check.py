"""Full upstream globe -> report -> image review -> inline fictional mission.

Reports and model outputs are fixtures, not emergency or model-accuracy evidence.
"""
import datetime
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    now=datetime.datetime.now(datetime.timezone.utc)
    def event(id,kind,days=0):
        return {'id':id,'title':f'Fixture {id} (not a real incident)','categories':[{'title':kind}],
                'sources':[{'id':'fixture','url':'https://example.org/'+id}],
                'geometry':[{'type':'Point','date':(now-datetime.timedelta(days=days)).isoformat(),'coordinates':[-97.7431,30.2672]}]}
    fixtures={'events':[event('flood','Floods'),event('fire','Wildfires'),event('old','Volcanoes',100)]}
    usgs={'features':[{'id':'quake','properties':{'type':'earthquake','title':'Fixture quake','time':now.timestamp()*1000,'url':'https://example.org/quake'},'geometry':{'type':'Point','coordinates':[-97.74,30.26]}}]}
    model={'status':'complete','result':{'width':640,'height':480,'boxes':[{'xyxy':[10,20,80,150],'confidence':.8}],
      'people_count':2,'disaster':{'category':'flood scene','confidence':.8,'scores':{'flood scene':.8,'normal scene':.2}},
      'errors':{},'elapsed_seconds':.5,'timestamp':now.isoformat()}}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=browser_path())
        try:
            page=browser.new_page(viewport={'width':1600,'height':1050})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            # This is a workflow test. External font CSS must not hold up module
            # startup when Google's font endpoint is slow/unreachable.
            page.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(content_type='text/css',body=''))
            page.add_init_script('''if(location.pathname.endsWith('fictional_rescue.html')){
                window.__frames=[];window.requestAnimationFrame=cb=>{window.__frames.push(cb);return 1};
                window.__time=null;window.__step=n=>{if(window.__time===null)window.__time=performance.now();for(let i=0;i<n;i++){window.__time+=100;window.__frames.shift()(window.__time)}};
            }''')
            page.route('**/eonet.gsfc.nasa.gov/api/v3/events*',lambda r:r.fulfill(json=fixtures))
            page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda r:r.fulfill(json=usgs))
            page.route('**/api.open-meteo.com/**',lambda r:r.fulfill(json={'current':{'temperature_2m':27,'wind_speed_10m':11,'rain':1,'time':now.isoformat()},'timezone_abbreviation':'UTC'}))
            page.route('**/__rescue/backend/api/vision',lambda r:r.fulfill(status=202 if r.request.method=='POST' else 200,json={'accepted':True} if r.request.method=='POST' else model))
            page.goto('http://127.0.0.1:4173',wait_until='domcontentloaded',timeout=90000)
            page.wait_for_function('window.RescueOperations?.getState().records===4 && window.__godsEyeView?.viewer',timeout=45000)
            page.wait_for_function('getComputedStyle(document.getElementById("loading-screen")).visibility === "hidden"',timeout=45000)
            # Dismiss upstream's first-run chooser without changing keys or provider settings.
            chooser=page.get_by_text('EXPLORE MANUALLY',exact=True)
            if chooser.count() and chooser.is_visible():chooser.click()
            root=page.locator('#droneRescueBridge')
            assert len(page.evaluate('RescueOperations.getState().visible'))==3
            root.locator('#age').select_option('all')
            assert len(page.evaluate('RescueOperations.getState().visible'))==4
            root.locator('#age').select_option('30');root.locator('#kind').select_option('flood')
            assert len(page.evaluate('RescueOperations.getState().visible'))==1
            root.locator('[data-report-id="flood"]').click()
            page.wait_for_function('RescueOperations.getState().report?.weather?.wind===11')
            # Exercise the actual Cesium marker picking path, not just the list.
            page.evaluate('RescueOperations.selectReport("fire")')
            page.wait_for_timeout(1800)
            # Terrain-clamped points may become pickable after the camera flight
            # has ended; wait for the real pick target, rather than a fixed delay.
            page.wait_for_function('''()=>{const p=RescueOperations.markerScreens().find(p=>p.id==='flood');return p && __godsEyeView.viewer.scene.drillPick(p).some(x=>x.id?.rescueReportId==='flood')}''',timeout=15000,polling=100)
            point=page.evaluate('RescueOperations.markerScreens().find(p=>p.id==="flood")')
            assert 0<point['x']<1600 and 0<point['y']<1050,point
            assert page.evaluate('(p)=>__godsEyeView.viewer.scene.drillPick(p).some(x=>x.id?.rescueReportId==="flood")',point)
            page.mouse.click(point['x'],point['y'])
            page.wait_for_function('RescueOperations.getState().report?.id==="flood"')
            root.locator('#aiTab').click()
            root.locator('#image').set_input_files(str(Path('samples/flood_street.jpg').resolve()))
            root.locator('#analyse').click()
            root.locator('#useReview').wait_for()
            page.wait_for_function('!document.getElementById("droneRescueBridge").shadowRoot.getElementById("useReview").disabled')
            assert 'Possible people: 2' in root.locator('#result').inner_text()
            root.locator('#useReview').click()
            assert page.evaluate('RescueOperations.getState().report.review.people_count')==2
            root.locator('#contextTab').click()
            assert root.locator('#source').get_attribute('href')=='https://example.org/flood'
            assert '11 km/h' in root.locator('#weather').inner_text()
            root.locator('#launch').click()
            frame=page.frame_locator('#rescueTrainingFrame')
            frame.locator('#start').wait_for()
            child=page.locator('#rescueTrainingFrame').element_handle().content_frame()
            child.wait_for_function('window.FictionalRescue',polling=100)
            assert child.evaluate('fictionalMissionContext.id')=='flood'
            assert child.evaluate('fictionalMissionContext.review.people_count')==2
            assert page.evaluate('__godsEyeView.viewer.useDefaultRenderLoop') is False
            frame.locator('#speed').select_option('4');frame.locator('#start').click()
            child.evaluate('__step(200)')
            log=child.evaluate('FictionalRescue.getLog()')
            assert log['outcome']=='delivered' and log['delivered']==3 and log['hardware_commands'] is False
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/gods_eye_inline_rescue_complete.png')
            page.locator('#closeRescueTraining').click()
            assert page.locator('#rescueTrainingFrame').count()==0
            assert page.evaluate('__godsEyeView.viewer.useDefaultRenderLoop') is True
            root.locator('#launch').click()
            frame=page.frame_locator('#rescueTrainingFrame')
            frame.locator('#start').wait_for()
            child=page.locator('#rescueTrainingFrame').element_handle().content_frame()
            child.wait_for_function('window.FictionalRescue',polling=100)
            frame.locator('.context summary').click()
            frame.locator('#outcome').select_option('abort')
            frame.locator('#speed').select_option('4');frame.locator('#start').click()
            child.evaluate('__step(140)')
            assert child.evaluate('FictionalRescue.getLog().outcome')=='aborted'
            assert child.evaluate('FictionalRescue.getState().delivered')==0
            page.locator('#closeRescueTraining').click()
            root.locator('#reportsTab').click()
            page.unroute('**/earthquake.usgs.gov/**/2.5_day.geojson')
            page.route('**/earthquake.usgs.gov/**/2.5_day.geojson',lambda r:r.abort())
            root.locator('#refresh').click()
            page.wait_for_function('!RescueOperations.getState().refreshBusy')
            assert 'USGS unavailable' in root.locator('#feedStatus').inner_text()
            assert page.evaluate('RescueOperations.getState().records')==4
            assert not errors,errors
            print('Native globe, report markers/filters, weather, image AI UI, inline success, preserved context, renderer restore and feed outage: PASS')
        finally:browser.close()


if __name__=='__main__':main()
