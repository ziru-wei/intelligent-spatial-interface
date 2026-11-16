"""ModOS external data cache: data from outside the space (weather, ...) is fetched ahead of time, never while answering.

When a MOD that needs a feed is installed (scripts/modos_registry.py install), the feed's fetcher fills
spaces/<space>/modos/cache/<feed>.json; a background refresher keeps it fresh (TODO: real fetchers and refresh); the pipeline
only reads what is cached. Each fetcher turns its source into one of the system's item types, so swapping the mock for a real
source changes neither the cache format nor the pipeline.

    {"feed": "weather", "type": "timeseries", "fetcher": "mock", "fetched_at": <unix s>, "summary": "...", "data": {...}}

Fetchers today are mocks: weather copies the recorded forecast in agent/context/weather.json."""
import json, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _mock_weather():
    w = json.loads((ROOT/'agent'/'context'/'weather.json').read_text())['weather']
    dates = sorted({e['date'] for e in w.get('forecast', [])})
    span = f'{dates[0]} to {dates[-1]}' if dates else 'no dates'
    return dict(type='timeseries', fetcher='mock', summary=f'Weather forecast by day and period (morning, afternoon, evening) with hourly samples, {span}.', data=w)

FETCHERS = {'weather': _mock_weather}

def path(space, feed):
    return Path(space)/'modos'/'cache'/f'{feed}.json'

def fetch(space, feed):
    """Run the feed's fetcher now and store the result."""
    if feed not in FETCHERS: raise ValueError(f'No fetcher for feed {feed}.')
    entry = dict(feed=feed, fetched_at=time.time(), **FETCHERS[feed]())
    p = path(space, feed); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(entry))
    return entry

def ensure(space, mods):
    """Make sure every feed the MODs need has a cache entry (fetch it if missing)."""
    import modos_registry
    for feed in modos_registry.feeds(mods):
        if not path(space, feed).is_file(): fetch(space, feed)

def read(space, feed):
    """The cached entry, or None when the feed was never fetched."""
    p = path(space, feed)
    return json.loads(p.read_text()) if p.is_file() else None
