"""Recording-local derived hand data. No cloud calls; only successful detections persist."""
import gzip
import fcntl
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import threading

VERSION = 'mediapipe-grabcut-clean-768-v2'
_lock = threading.RLock()
_sources = {}


def _source(d, refresh=False):
    d = Path(d).resolve()
    stat = (d/'session.json').stat()
    root = Path(__file__).resolve().parents[1]
    pipeline = []
    for p in [root/'src/hand-perception/worker.js', root/'src/hand-perception/segmentation.js', root/'assets/models/hand_landmarker.task']:
        ps = p.stat()
        pipeline.append([p.name, ps.st_size, ps.st_mtime_ns])
    stamp = (stat.st_size, stat.st_mtime_ns, json.dumps(pipeline), VERSION)
    old = _sources.get(d)
    if old and old['stamp'] == stamp and not refresh:
        return old
    session = json.loads((d/'session.json').read_text())
    paths, signatures = [], []
    for f in session['frames']:
        p = (d/f['image']).resolve()
        if not p.is_relative_to(d):
            raise ValueError('Frame image is outside this recording')
        st = p.stat()
        paths.append(p)
        signatures.append([f['image'], st.st_size, st.st_mtime_ns])
    token = hashlib.sha256(json.dumps([VERSION, pipeline, signatures]).encode()).hexdigest()[:24]
    out = dict(stamp=stamp, paths=paths, signatures=signatures, token=token,
               folder=d/'.hand-cache'/VERSION/token)
    _sources[d] = out
    return out


def _manifest(source):
    p = source['folder']/'index.json'
    return json.loads(p.read_text()) if p.exists() else {}


def _frame(source, frame, token):
    if token != source['token'] or type(frame) is not int or not 0 <= frame < len(source['paths']):
        raise ValueError('Hand cache source changed; refresh the recording')
    st = source['paths'][frame].stat()
    if [st.st_size, st.st_mtime_ns] != source['signatures'][frame][1:]:
        raise ValueError('Frame image changed; refresh the recording')


def describe(d):
    with _lock:
        source = _source(d, refresh=True)
        entries = _manifest(source)
        return dict(version=VERSION, token=source['token'], total=len(source['paths']), entries=entries)


def read(d, frame, token):
    with _lock:
        source = _source(d)
        _frame(source, frame, token)
        entry = _manifest(source).get(str(frame))
        if entry is None:
            return None
        if entry['empty']:
            return dict(width=entry['width'], height=entry['height'], landmarks=[], worldLandmarks=[], handedness=[], runs=[])
        return json.loads(gzip.decompress((source['folder']/f'{frame}.json.gz').read_bytes()))


@contextmanager
def _disk_lock(d):
    folder = Path(d)/'.hand-cache'; folder.mkdir(exist_ok=True)
    with (folder/'.write.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(lock, fcntl.LOCK_UN)


def write(d, frame, token, value):
    with _lock, _disk_lock(d):
        source = _source(d)
        _frame(source, frame, token)
        w, h = value.get('width'), value.get('height')
        if any(type(v) is not int or not 1 <= v <= 768 for v in (w, h)):
            raise ValueError('Invalid hand mask dimensions')
        landmarks = value.get('landmarks')
        if not isinstance(landmarks, list) or len(landmarks) > 2:
            raise ValueError('Invalid hand landmarks')
        for hand in landmarks:
            if not isinstance(hand, list) or len(hand) != 21:
                raise ValueError('Invalid hand landmarks')
            for point in hand:
                if not isinstance(point, dict) or any(not isinstance(point.get(k), (int, float)) or not math.isfinite(point[k]) for k in ('x', 'y', 'z')):
                    raise ValueError('Invalid landmark coordinate')
        runs = value.get('runs', [])
        if landmarks and (not isinstance(runs, list) or not runs or any(type(n) is not int or n < 0 for n in runs) or sum(runs) != w*h or len(runs) > w*h+1):
            raise ValueError('Invalid mask run lengths')
        record = dict(width=w, height=h, landmarks=landmarks, runs=runs if landmarks else [],
                      worldLandmarks=value.get('worldLandmarks', []), handedness=value.get('handedness', []))
        encoded = json.dumps(record, allow_nan=False).encode()
        if len(encoded) > 2_000_000:
            raise ValueError('Hand record is too large')
        folder = source['folder']; folder.mkdir(parents=True, exist_ok=True)
        if landmarks:
            tmp = folder/f'{frame}.tmp'
            tmp.write_bytes(gzip.compress(encoded)); os.replace(tmp, folder/f'{frame}.json.gz')
        entries = _manifest(source)
        entries[str(frame)] = dict(empty=not bool(landmarks), width=w, height=h)
        tmp = folder/'index.tmp'; tmp.write_text(json.dumps(entries, separators=(',', ':'))); os.replace(tmp, folder/'index.json')
        return entries[str(frame)]
