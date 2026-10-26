"""Exercise the real Cesium mission UI against a running local server.

    py tests/earth_rescue_mission_browser_check.py [dashboard URL] [screenshot path]

Requires Playwright and Chrome (or Playwright's Chromium). Flight time is advanced
between assertions so success, abort and manual approval can be checked quickly.
"""
import sys

from playwright.sync_api import sync_playwright

from earth_render_browser_check import browser_path


def advance(page, seconds, expected):
    page.evaluate("seconds => { missionClock = mission.phaseStart + seconds; }", seconds)
    page.wait_for_function("phase => mission.phase === phase", arg=expected)


def freeze_for_checks(page):
    page.wait_for_function("""() => {
        if (!mission || !running) return false;
        paused = true;
        document.getElementById('pause').textContent = 'Resume';
        return true;
    }""", timeout=30000)


def approach(page):
    advance(page, 3.1, "takeoff")
    advance(page, 4.1, "outbound")
    advance(page, 10.1, "descending")
    advance(page, 4.1, "awaiting_approval")


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8877/earth_rescue.html"
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=browser_path())
        try:
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url + ('&' if '?' in url else '?') + 'renderer=cesium&quality=fast', wait_until="domcontentloaded")
            page.wait_for_function("typeof viewer !== 'undefined' && viewer && !document.getElementById('runDemo').disabled", timeout=45000)
            page.locator("#runDemo").click()
            freeze_for_checks(page)
            assert page.evaluate("mission.autoDemo && mission.packageCount === 3 && mission.people === 3")
            advance(page, 3.1, "takeoff")
            advance(page, 4.1, "outbound")
            page.wait_for_function("mission.current.alt === 75")
            assert page.evaluate("Cesium.Cartographic.fromCartesian(drone.position.getValue()).height > RescueScene.groundHeight(mission.terrain, mission.current) + 74")
            page.locator("#pause").click()
            page.wait_for_timeout(100)
            page.locator("#pause").click()
            clock = page.evaluate("missionClock")
            page.wait_for_timeout(300)
            assert page.evaluate("missionClock") == clock
            page.locator('#followDrone').check()
            assert page.evaluate('viewer.trackedEntity === drone')
            page.locator('#followDrone').uncheck()
            assert page.evaluate('!viewer.trackedEntity')
            if len(sys.argv) > 2:
                page.locator('#panel').evaluate('panel => { panel.scrollTop = 0; }')
                page.screenshot(path=sys.argv[2])
            advance(page, 10.1, "descending")
            advance(page, 4.1, "awaiting_approval")
            advance(page, 2.1, "releasing")
            page.evaluate("missionClock = mission.phaseStart + 3.5")
            page.wait_for_function("mission.delivered === 1")
            assert page.evaluate("Cesium.Cartographic.fromCartesian(packages[0].position.getValue()).height > RescueScene.groundHeight(mission.terrain, mission.target) + 11")
            advance(page, 9.1, "ascending")
            advance(page, 4.1, "returning")
            advance(page, 10.1, "landing")
            advance(page, 4.1, "complete")
            assert page.evaluate("!running && mission.outcome === 'delivered' && mission.delivered === 3")
            assert page.locator("#hudDelivered").inner_text() == "3"
            state = page.request.get(url.split('/earth_rescue.html')[0] + '/api/state').json()['state']
            assert state['complete'] and state['packages_delivered'] == 3 and state['automatic_demo']
            assert not state['operator_release_approved'] and state['simulated_release_approved']
            page.evaluate("window.completedDemoRecord = JSON.parse(JSON.stringify({simulation_only:true,mission,events:evidence}))")
            print("Success, three sequential deliveries, landing, terrain clearance and pause: PASS")

            page.locator("#demoOutcome").select_option("abort")
            page.locator("#runDemo").click()
            freeze_for_checks(page)
            approach(page)
            advance(page, 2.1, "aborted_return")
            assert page.evaluate("mission.delivered === 0 && !mission.operatorApproved")
            advance(page, 10.1, "landing")
            advance(page, 4.1, "complete")
            assert page.evaluate("mission.outcome === 'aborted' && mission.delivered === 0")
            print("Unsafe-zone abort, retained packages and landing: PASS")

            page.evaluate("resetMission(); setLocation(46.8421,-91.994,'Manual test','browser test','simulated')")
            page.locator("#scenario").select_option("success")
            page.locator("#confirmTarget").click()
            page.locator("#start").click()
            freeze_for_checks(page)
            assert page.evaluate("!mission.autoDemo")
            approach(page)
            page.evaluate("missionClock = mission.phaseStart + 20")
            page.wait_for_timeout(300)
            assert page.evaluate("mission.phase === 'awaiting_approval' && mission.delivered === 0 && !mission.operatorApproved")
            page.locator("#approveRelease").click()
            page.wait_for_function("mission.phase === 'releasing'")
            print("Manual mode holds until explicit release approval: PASS")
            page.evaluate("resetMission(); startReplay(window.completedDemoRecord)")
            page.wait_for_function("document.getElementById('phase').textContent.startsWith('REPLAY')")
            assert page.evaluate("Cesium.Cartographic.fromCartesian(drone.position.getValue()).height >= mission.terrain.heights[0]")
            print("Recorded mission replay preserves terrain-relative placement: PASS")
            assert page.locator(".cesium-widget-errorPanel").count() == 0
            assert not errors, errors
        except Exception:
            print("Browser errors:", errors)
            print("Map:", page.locator('#earthStatus').inner_text())
            print("Demo:", page.locator('#demoStatus').inner_text())
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
