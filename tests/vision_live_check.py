"""Optional actual-model HTTP smoke test and repeated-image latency measurement."""
import json
import sys
import time
import urllib.request
from pathlib import Path

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8877'
for attempt in range(2):
    start = time.monotonic()
    request = urllib.request.Request(base + '/api/vision',
                                    data=Path('samples/flood_street.jpg').read_bytes(), method='POST')
    urllib.request.urlopen(request, timeout=10).close()
    while True:
        with urllib.request.urlopen(base + '/api/vision', timeout=10) as response:
            job = json.load(response)
        if job['status'] == 'complete':
            break
        if time.monotonic() - start > 180:
            raise RuntimeError('Actual inference exceeded 180 seconds: ' + job.get('message', ''))
        time.sleep(.2)
    result = job['result']
    assert not result['errors'], result['errors']
    assert len(result['disaster']['scores']) == 6
    assert result['people_count'] == len(result['boxes'])
    print(json.dumps({'attempt': attempt + 1, 'wall_seconds': round(time.monotonic() - start, 3),
                      'category': result['disaster']['category'], 'people': result['people_count']}), flush=True)
