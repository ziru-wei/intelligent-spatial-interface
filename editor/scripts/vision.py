"""Live data for the Vision Pro app (visionos/), so a space edited in this editor (its layout boxes, info) reaches the headset without
a rebuild, and the app's settings are edited here too (editor/vision.html).

  space(name, known)   the space as the app uses it: {revision, semantic, surfaces, scan, colors}. When the layout changed since the last
                       export (scan/semantic.json), the surfaces are made again by the editor's own code (visionos/tools/export-space.mjs,
                       into visionos/SpaceData/<space>/) and the scan's colours are baked again in the background
                       (bake_surface_colors.py; a few seconds). `known`: the revision the app has: then only {revision, unchanged}.
  colors(name)         the baked colour index ({revision, files}); color_file(name, file): one colour grid (PNG bytes).
  room(name) / save_room(name, body) / set_alignment(name, body)   the headset's room and alignment, tuned in the editor (below)
  settings(name) / save_settings(name, value)   the app's settings (spaces/<space>/vision/settings.json): what its window's labeled
                       controls set (DEFAULTS: Room view, the zone, the mods and theirs, the answer text's behaviour, info selection
                       and placement), and when the headset last read them.
"""
import json, os, re, subprocess, sys, threading, time
from pathlib import Path
import spaces

ROOT = Path(__file__).resolve().parents[1]
VISION = ROOT.parent/'visionos'
DEFAULTS = dict(roomView=False, zone=None, weatherMod=True, weatherLock=False, bodySize=1.0,
                headingSize=1.0, showHeading=True, writing=True, writingStrokes=True, writingSpeed=30.0, stability=0.0, occlusion=True,
                selectionMode='jev', infoMinShrink=0.55, floatParallel=80.0, arrowWidth=1.0,
                findmyMod=True, findmyRemoveOnApproach=False, findmyApproach=0.25, followMode='lazy')
# Ranges of the numbers; the rest are true/false but zone (a zone id or none) and selectionMode (jev or score).
RANGES = dict(bodySize=(0.6, 2.5), headingSize=(0.5, 2), writingSpeed=(5, 120), stability=(0, 1), infoMinShrink=(0.25, 1), floatParallel=(0, 90),
              arrowWidth=(0.5, 3), findmyApproach=(0.05, 0.5))
_lock = threading.Lock(); _baking = set()
_seen = {}   # space → when the headset last read its settings

def _out(name): return VISION/'SpaceData'/name

def _revision(name):
    d = spaces.space_dir(name); m = spaces.manifest(d)
    sem = d/(m.get('scan', {}).get('semantic') or m.get('semantic') or 'scan/semantic.json')
    # The live session's scene objects (their info boxes go with the layout) change it too.
    comp = d/'scenarios'/'vision-live'/'composition.json'
    return (str(sem.stat().st_mtime_ns) if sem.is_file() else '0') + ('-' + str(comp.stat().st_mtime_ns) if comp.is_file() else '')

def _bake(name):
    try:
        subprocess.run([str(ROOT/'.venv-mesh'/'bin'/'python'), str(VISION/'tools'/'bake_surface_colors.py'), name], cwd=ROOT.parent, check=True, capture_output=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as e: print('vision: colour bake failed:', e, file=sys.stderr)
    finally:
        with _lock: _baking.discard(name)

def space(name, known=None):
    rev = _revision(name); out = _out(name); stamp = out/'.revision'
    with _lock:
        if not (stamp.is_file() and stamp.read_text() == rev and (out/'surfaces.json').is_file()):
            subprocess.run(['node', str(VISION/'tools'/'export-space.mjs'), name], cwd=ROOT.parent, check=True, capture_output=True, timeout=120)
            stamp.write_text(rev)
            if name not in _baking:
                _baking.add(name); threading.Thread(target=_bake, args=(name,), daemon=True).start()
    if known == rev: return dict(revision=rev, unchanged=True)
    surfaces = json.loads((out/'surfaces.json').read_text())
    return dict(revision=rev, semantic=json.loads((out/'semantic.json').read_text()), surfaces=surfaces['surfaces'], scan=surfaces.get('scan'), colors=colors(name)['revision'])

# The headset's room for tuning its alignment in the editor (Vision Pro tab › Tune): the room's mesh as it sees it (points, world) and
# the alignment it has (worldFromSpace, row-major 4 × 4), sent by the headset now and then; and an alignment set in the editor, which
# the headset takes up (with its settings: `alignment`, numbered so it is taken once). Kept in memory: the headset sends them again.
_room = {}; _alignment = {}
def _matrix(m):
    if not (isinstance(m, list) and len(m) == 16 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in m)): raise ValueError('A 4 × 4 matrix (16 numbers, row-major).')
    return [float(v) for v in m]
def save_room(name, body):
    pts = body.get('points')
    if not (isinstance(pts, list) and len(pts) % 3 == 0 and len(pts) <= 3*60000): raise ValueError('Points: x, y, z, … (at most 60000).')
    with _lock: _room[name] = dict(worldFromSpace=_matrix(body.get('worldFromSpace')), points=pts, at=time.time())
    return dict(ok=True)
def room(name):
    with _lock: r = _room.get(name)
    if not r: raise ValueError('The headset has not sent its room yet: open the room on the headset, align it, and wait a few seconds.')
    return r
def set_alignment(name, body):
    with _lock:
        seq = _alignment.get(name, {}).get('seq', 0) + 1
        _alignment[name] = dict(seq=seq, worldFromSpace=_matrix(body.get('worldFromSpace')), at=time.time())
        if name in _room: _room[name]['worldFromSpace'] = _alignment[name]['worldFromSpace']
    return dict(ok=True, seq=seq)

def colors(name):
    """The colour index, or no revision while a bake runs (the app keeps what it has meanwhile)."""
    path = _out(name)/'colors.json'
    with _lock: baking = name in _baking
    if baking or not path.is_file(): return dict(revision=None, files={})
    return dict(revision=str(path.stat().st_mtime_ns), files=json.loads(path.read_text())['files'])

def color_file(name, file):
    if not re.fullmatch(r'\d{4}\.png', str(file)): raise ValueError('Bad colour file.')
    path = _out(name)/'colors'/file
    if not path.is_file(): raise ValueError('No such colour file.')
    return path.read_bytes()

def _settings_path(name): return spaces.space_dir(name)/'vision'/'settings.json'

def settings(name, headset=False):
    path = _settings_path(name); saved = json.loads(path.read_text()) if path.is_file() else {}
    if headset: _seen[name] = time.time()
    return dict(DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}, headsetSeen=_seen.get(name), alignment=_alignment.get(name))

_settings_lock = threading.Lock()

def save_settings(name, value):
    if not isinstance(value, dict): raise ValueError('Settings must be an object.')
    # The headset and the editor may save at once (the server is threaded): one at a time, each written whole and swapped in, so the
    # file is never left half written.
    with _settings_lock: return _save_settings(name, value)

def _save_settings(name, value):
    current = {k: v for k, v in settings(name).items() if k in DEFAULTS}
    for k, v in value.items():
        if k not in DEFAULTS: continue
        if k == 'zone':
            if not (v is None or isinstance(v, str) and len(v) < 100): raise ValueError('Bad zone.')
        elif k == 'selectionMode':
            if v not in ('jev', 'score'): raise ValueError('selectionMode is jev or score.')
        elif k == 'followMode':
            if v not in ('lazy', 'realtime'): raise ValueError('followMode is lazy or realtime.')
        elif k in RANGES:
            lo, hi = RANGES[k]
            if isinstance(v, bool) or not (isinstance(v, (int, float)) and lo <= v <= hi): raise ValueError(f'{k} must be {lo}–{hi}.')
        elif not isinstance(v, bool): raise ValueError(f'{k} must be true or false.')
        current[k] = v
    path = _settings_path(name); path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.json.tmp'); tmp.write_text(json.dumps(current, indent=2)); os.replace(tmp, path)
    return settings(name)
