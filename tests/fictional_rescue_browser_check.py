"""Exercise the bundled fictional district against a local static/demo server."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from earth_render_browser_check import browser_path


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8877/fictional_rescue.html'
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=browser_path())
        try:
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors, external, commands = [], [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: external.append(r.url) if not r.url.startswith(url.rsplit('/', 1)[0]) else None)
            page.on('request', lambda r: commands.append(r.url) if '/api/' in r.url else None)
            # Test-controlled animation timestamps: exercise the real frame/update/render
            # path without waiting an entire cinematic mission in wall-clock time.
            page.add_init_script('''
                window.__frames=[];
                window.requestAnimationFrame=cb=>{window.__frames.push(cb);return window.__frames.length};
                window.__time=performance.now();
                window.__step=n=>{for(let i=0;i<n;i++){window.__time+=100;window.__frames.shift()(window.__time)}};
            ''')
            page.goto(url, wait_until='networkidle')
            page.wait_for_function('window.FictionalRescue !== undefined')
            step = lambda n: page.evaluate('(n)=>window.__step(n)', n)
            state = lambda: page.evaluate('FictionalRescue.getState()')
            step(2)
            assert state()['delivered'] == 0 and state()['onboard'] == 0
            page.locator('#speed').select_option('4')
            page.locator('#start').click()
            step(16)
            assert state()['onboard'] == 3, state()
            page.locator('#pause').click()
            paused = state()
            step(5)
            assert state()['position'] == paused['position'] and state()['elapsed'] == paused['elapsed']
            page.locator('#pause').click()
            step(72)
            assert state()['delivered'] == 1 and state()['onboard'] == 1, state()
            page.locator('[data-view="roof"]').click()
            step(1)
            out = Path('inspection_reports'); out.mkdir(exist_ok=True)
            page.screenshot(path=str(out / 'fictional_rooftop_delivery.png'))
            step(110)
            final = state()
            assert final['delivered'] == 3 and final['onboard'] == 0 and not final['running'], final
            assert page.locator('#phase').inner_text() == 'Mission complete'
            assert final['position'][1] < 3, final
            for view in ['street', 'follow', 'overview']:
                page.locator(f'[data-view="{view}"]').click()
                step(2)
                assert state()['view'] == view
            page.screenshot(path=str(out / 'fictional_district_overview.png'))
            page.locator('#reset').click()
            step(1)
            assert not state()['started'] and state()['delivered'] == 0 and state()['onboard'] == 0
            page.set_viewport_size({'width': 390, 'height': 844})
            step(2)
            assert page.locator('#start').is_visible()
            assert not errors, errors
            assert not external, external
            assert not commands, commands
            print(json.dumps({'result': 'PASS', 'checks': ['load', 'inventory', 'pause/resume', 'sequential delivery', 'return/land', 'cameras', 'reset', 'mobile', 'no external assets or hardware calls'], 'mission': final}))
        finally:
            browser.close()


if __name__ == '__main__':
    main()
