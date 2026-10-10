"""Object-egocentric mod: an answer carried by things in the scene (src/ego.mjs draws it; scripts/jev-pipeline.mjs decides).

Candidates (catalog) are what the scene knows as objects, each with a stable id:
  layout:<box id>   furniture and appliances, doors and windows (scan/semantic.json; has_model when it has a furniture model)
  comp:<instance>   the scene's persistent objects (spaces/<scene>/composition.json) and the opportunistic objects placed in this recording
                    (scenarios/<take>/composition.json); has_model unless the object is kept as a box
Jev selects ids only (never geometry); resolve() checks them and returns what the editor needs. visibility() says whether each object is
in the recorded view at a frame and not hidden by what the recording's depth saw in front of it (used to decide between this mod and
another one that also fits the question)."""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_OBJECTS = 6

def _json(p, default):
    try: return json.loads(Path(p).read_text())
    except (OSError, ValueError): return default

def _library_entry(scene, cid):
    for base in (scene/'components'/cid, ROOT/'components'/cid):
        if (base/'component.json').is_file(): return _json(base/'component.json', {})
    return None

def catalog(d):
    """d: the recording folder (spaces/<scene>/scenarios/<take>). [{id, kind, label, zone, has_model, center, size, yaw}]."""
    scene = d.parent.parent; m = _json(scene/'space.json', {}); sem = _json(scene/(m.get('semantic') or 'scan/semantic.json'), {})
    rooms = {r.get('id'): r.get('name', r.get('id')) for r in sem.get('rooms', [])}; models = sem.get('models', {}); out = []
    for kind, key in (('furniture', 'objects'), ('opening', 'openings')):
        for b in sem.get(key, []):
            if not (b.get('id') and _vec(b.get('center')) and _vec(b.get('size'))): continue
            out.append(dict(id='layout:'+b['id'], kind=kind, label=str(b.get('label') or b['id']).split('/')[-1].strip(), zone=rooms.get(b.get('room')),
                            has_model=b['id'] in models, center=b['center'], size=b['size'], yaw=b.get('yaw', 0) or 0))
    specs = [c for c in _json(scene/'composition.json', {}).get('components', []) if c.get('category') == 'persistent']
    specs += [c for c in _json(d/'composition.json', {}).get('components', []) if c.get('category') == 'opportunistic']
    for c in specs:
        if not (c.get('id') and _vec(c.get('position'))): continue
        entry = _library_entry(scene, str(c.get('component'))) or {}
        box = entry.get('kind') == 'box'; scale = c.get('scale', 1)
        size = scale if box and _vec(scale) else [.3, .3, .3]   # a model's bounds are the editor's to measure; this is for visibility only
        out.append(dict(id='comp:'+c['id'], kind='object', label=str(c.get('name') or entry.get('name') or c['component']), zone=None,
                        has_model=not box, center=c['position'], size=size, yaw=(c.get('rotation') or [0, c.get('yaw', 0), 0])[1]))
    return out

def _vec(v): return isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)

def for_jev(items):
    """The catalog as Jev sees it: names, kinds and zones; no geometry."""
    return [dict(id=i['id'], label=i['label'], kind=i['kind'], zone=i['zone'], has_model=i['has_model']) for i in items]

EFFECTS = ('bounce', 'grow', 'color'); COLORS = ('calm', 'attention', 'warning')

def resolve(d, selection):
    """selection: {objects: [ids], main: id, effect: {type, color?}}: the ids must be in the catalog; main among objects."""
    if not isinstance(selection, dict) or set(selection)-{'objects', 'main', 'effect'}: raise ValueError('Ego accepts objects, main and effect.')
    ids = selection.get('objects')
    if not (isinstance(ids, list) and 0 < len(ids) <= MAX_OBJECTS and all(isinstance(i, str) for i in ids) and len(set(ids)) == len(ids)): raise ValueError('Ego needs 1-6 object ids.')
    known = {i['id']: i for i in catalog(d)}
    if any(i not in known for i in ids): raise ValueError('Ego object not in the scene.')
    main = selection.get('main')
    if main not in ids: raise ValueError('Ego main object must be one of its objects.')
    effect = selection.get('effect') or {}
    if not isinstance(effect, dict) or effect.get('type') not in EFFECTS or effect.get('color', 'attention') not in COLORS: raise ValueError('Invalid ego effect.')
    return dict(version=1, mod='ego', main=main, effect=dict(type=effect['type'], color=effect.get('color', 'attention')),
                objects=[dict(id=i, label=known[i]['label'], kind=known[i]['kind'], has_model=known[i]['has_model']) for i in ids])

def _rot(q):
    x, y, z, w = q
    return [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]

def _camera(session, frame):
    """World (scene) rotation rows and position of the recorded camera at a frame (toSpace applied)."""
    f = session['frames'][frame]; R = _rot(f['quaternion']); p = list(f['position'])
    M = session.get('toSpace')
    if M:
        A = [M[0:3], M[4:7], M[8:11]]; t = [M[3], M[7], M[11]]
        R = [[sum(A[i][k]*R[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        p = [sum(A[i][k]*p[k] for k in range(3))+t[i] for i in range(3)]
    return R, p

def _samples(item):
    """The box's centre and its corners pulled in to 80%, in the scene."""
    c, s, a = item['center'], item['size'], math.radians(item.get('yaw', 0) or 0)
    pts = [(0, 0, 0)]+[(x, y, z) for x in (-.4, .4) for y in (-.4, .4) for z in (-.4, .4)]
    return [[c[0]+math.cos(a)*x*s[0]+math.sin(a)*z*s[2], c[1]+y*s[1], c[2]-math.sin(a)*x*s[0]+math.cos(a)*z*s[2]] for x, y, z in pts]

def visibility(d, frame, ids, hidden_by=.25):
    """{id: share of its samples in the recorded view at a frame and not behind something the depth saw more than hidden_by m nearer}."""
    session = _json(d/'session.json', {}); k = session.get('intrinsics') or {}
    if not 0 <= frame < len(session.get('frames', [])): raise ValueError('Frame out of range.')
    R, p = _camera(session, frame); depth = None; f = session['frames'][frame]
    if f.get('depth') and (d/f['depth']).is_file():
        from PIL import Image
        im = Image.open(d/f['depth']).convert('RGB'); depth = (im.size, im.load())
    known = {i['id']: i for i in catalog(d)}; out = {}
    for oid in ids:
        item = known.get(oid)
        if not item: out[oid] = 0.0; continue
        seen = 0; pts = _samples(item)
        for w in pts:
            v = [w[i]-p[i] for i in range(3)]; c = [sum(R[j][i]*v[j] for j in range(3)) for i in range(3)]   # camera coordinates (R transposed)
            z = -c[2]
            if z <= .05: continue
            u, vv = k['fx']*c[0]/z+k['cx'], -k['fy']*c[1]/z+k['cy']
            if not (0 <= u < k['width'] and 0 <= vv < k['height']): continue
            if depth:
                (W, H), px = depth; r, g, _ = px[min(W-1, int(u/k['width']*W)), min(H-1, int(vv/k['height']*H))]; mm = r*256+g
                if 0 < mm/1000 < z-hidden_by: continue
            seen += 1
        out[oid] = round(seen/len(pts), 3)
    return out
