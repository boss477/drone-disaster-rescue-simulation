"""NASA integration: actual renderer, synthetic georeferenced glTF tile and full mission.

The tiny fixture is generated in memory; it is not an Earth survey or AI evidence.
"""
import base64
import json
import math
import struct
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def fixture_files():
    lat, lon = map(math.radians, (12.2958, 76.6394))
    c, s = math.cos, math.sin
    radius = 6378137 / math.sqrt(1 - .00669437999014 * s(lat)**2)
    matrix = [-s(lon),c(lon),0,0, -s(lat)*c(lon),-s(lat)*s(lon),c(lat),0,
              c(lat)*c(lon),c(lat)*s(lon),s(lat),0,
              radius*c(lat)*c(lon),radius*c(lat)*s(lon),radius*(1-.00669437999014)*s(lat),1]
    data = base64.b64encode(struct.pack('<9f', -20,0,0, 20,0,0, 0,40,0)).decode()
    tile = {'asset': {'version': '1.1'}, 'geometricError': 0, 'root': {
        'boundingVolume': {'box': [0,0,20, 30,0,0, 0,30,0, 0,0,30]},
        'transform': matrix, 'geometricError': 0, 'content': {'uri': 'triangle.gltf'}}}
    gltf = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
            'nodes': [{'mesh': 0}], 'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
            'materials': [{'doubleSided': True, 'pbrMetallicRoughness': {'baseColorFactor': [1,.4,.1,1]}}],
            'buffers': [{'byteLength': 36, 'uri': 'data:application/octet-stream;base64,' + data}],
            'bufferViews': [{'buffer': 0, 'byteLength': 36, 'target': 34962}],
            'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3',
                           'min': [-20,0,0], 'max': [20,40,0]}]}
    return {'/tileset.json': json.dumps(tile).encode(), '/triangle.gltf': json.dumps(gltf).encode(),
            '/manifest.json': json.dumps({'texturedMesh': {'url': 'tileset.json'}}).encode()}


def main():
    files = fixture_files()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = files.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body or b'not found')
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=browser_path())
            page = browser.new_page(viewport={'width': 1600, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:8877/earth_rescue.html?demo=1', wait_until='domcontentloaded')
            page.wait_for_function('window.RescueWorld?.getState().active && mission && running', timeout=30000)
            page.wait_for_function('RescueWorld.getState().actorCount > 20 && RescueWorld.getState().drawCalls > 5')
            assert page.evaluate('!viewer.useDefaultRenderLoop'), 'Reference view should not consume a second render loop'
            page.select_option('#missionSpeed', '4')
            page.wait_for_function('mission.phase === "complete" && !running', timeout=35000)
            assert page.evaluate('mission.delivered === 3 && mission.climate === "elnino-india"')
            page.locator('#worldMission').click()
            page.wait_for_timeout(1000)
            Path('inspection_reports').mkdir(exist_ok=True)
            page.screenshot(path='inspection_reports/nasa_india_world.png')
            page.locator('#nasaTilesUrl').fill(f'http://127.0.0.1:{server.server_address[1]}/tileset.json')
            page.locator('#loadNasaTiles').click()
            page.wait_for_function('RescueWorld.getState().customVisible > 0', timeout=15000)
            assert 'content loaded' in page.locator('#nasaTileStatus').inner_text()
            page.locator('#clearNasaTiles').click()
            page.wait_for_function('RescueWorld.getState().customVisible === 0')
            page.locator('#odmManifest').fill(f'http://127.0.0.1:{server.server_address[1]}/manifest.json')
            page.locator('#loadOdm').click()
            page.wait_for_function('RescueWorld.getState().customVisible > 0', timeout=15000)
            page.locator('#clearOdm').click()
            page.wait_for_function('RescueWorld.getState().customVisible === 0')
            page.locator('#worldOverview').click()
            page.wait_for_timeout(1000)
            page.screenshot(path='inspection_reports/nasa_whole_earth.png')
            page.locator('#worldMission').click()
            page.select_option('#worldRenderer', 'cesium')
            assert page.evaluate('viewer.useDefaultRenderLoop && !RescueWorld.getState().active')
            page.select_option('#worldRenderer', 'nasa')
            page.wait_for_function('RescueWorld.getState().active')
            if '--details' in sys.argv:
                page.locator('[data-preset="dubai"]').click()
                page.locator('#detailedEarth').check()
                page.wait_for_function('RescueWorld.getState().terrainVisible > 0 && RescueWorld.getState().buildingVisible > 0', timeout=90000)
                page.evaluate('RescueWorld.selectArea({lat:25.1972,lon:55.2744}); RescueWorld.missionView()')
                page.wait_for_timeout(2000)
                page.screenshot(path='inspection_reports/nasa_streamed_terrain_buildings.png')
                print('Live Cesium terrain and building tiles parsed and rendered by NASA: PASS')
            assert not errors, errors
            print('NASA world, actor synchronization, complete India mission, real glTF tile decode, clear and renderer switching: PASS')
            print(json.dumps(page.evaluate('RescueWorld.getState()')))
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
