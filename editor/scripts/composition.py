"""A composition: the 3D component instances placed in a recording (src/components.mjs), autosaved by the editor to
spaces/<scene>/scenarios/<take>/composition.json, and those that belong to the scene itself (scope 'scene', in every recording: digital
twins of its objects) in spaces/<scene>/composition.json as {version: 2, revision, components: [spec, ...]}. Imported .glb files arrive as data
URLs and are stored next to it in assets/<instance id>.glb (src becomes that relative path). The library is components/<id>/component.json.
Saves carry the revision the editor loaded; a stale one (another window saved since) is refused.

Opportunistic objects are digital twins of a scene's small, movable things (a cup, a box of tea). Each is an entry in the scene's own
library, spaces/<scene>/components/<id>/component.json (category "opportunistic"): kind "box" (a unit box sized by defaultScale [w, h, d])
or kind "gltf" (model.glb). A recording places some of them in its composition (scope 'recording'), each where it is in that take.
The shape (defaultScale: a box's size, a model's scale) belongs to the object: the same in every recording. Position and rotation belong
to the recording; the library keeps the pose from the recording it was made in (origin, pose), where other recordings first place it."""
import base64, json, math, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]; LIBRARY = ROOT/'components'
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$')

class Conflict(ValueError): pass

def _rel(d):   # a library folder as the editor fetches it (relative to the editor root when under it)
    return (d.relative_to(ROOT) if d.is_relative_to(ROOT) else d).as_posix()+'/'

def library(scene_dir=None):
    """Components available: components/<id>/ (everywhere) and, for a scene, spaces/<scene>/components/<id>/ (its own, e.g. digital
    twins of its objects): [{id, path}] with path relative to the editor root."""
    out = []
    for base in [LIBRARY]+([Path(scene_dir)/'components'] if scene_dir else []):
        if base.is_dir(): out += [dict(id=d.name, path=_rel(d)) for d in sorted(base.iterdir()) if (d/'component.json').is_file() and ID.match(d.name)]
    return out

def _num(v, n=None):
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if n is None: return ok
    return isinstance(v, list) and len(v) == n and all(_num(x) for x in v)

def _spec(s, d, known):
    if not (isinstance(s, dict) and ID.match(str(s.get('id', ''))) and (s.get('component') == 'file' or s.get('component') in known)):
        raise ValueError('Bad component: '+str(s)[:120])
    def transform_ok(t):
        sc = t.get('scale', 1); rot = t.get('rotation', [0, 0, 0])
        return _num(t.get('position'), 3) and _num(rot, 3) and ((_num(sc) and sc > 0) or (_num(sc, 3) and min(sc) > 0))
    if not (transform_ok(s) and _num(s.get('yaw', 0))): raise ValueError('Bad transform: '+s['id'])
    out = {k: s[k] for k in ('id', 'component', 'position', 'rotation', 'yaw', 'scale') if k in s}
    if isinstance(s.get('initial'), dict) and transform_ok(s['initial']): out['initial'] = {k: s['initial'][k] for k in ('position', 'rotation', 'scale') if k in s['initial']}
    out.update(name=str(s.get('name') or s['component'])[:80], visible=s.get('visible') is not False, mount='wall' if s.get('mount') == 'wall' else 'floor',
               params=s.get('params') if isinstance(s.get('params'), dict) else {}, scope='scene' if s.get('scope') == 'scene' else 'recording')
    category = s.get('category')
    if category == 'digital twin': category = 'persistent'
    if category in ('persistent', 'opportunistic', 'widget'):
        out['category'] = category
        if category != 'widget': out['scope'] = 'scene' if category == 'persistent' else 'recording'
    for k in ('start', 'end'):
        if _num(s.get(k)): out[k] = s[k]
    if s['component'] == 'file':
        src = str(s.get('src') or '')
        if src.startswith('data:'):
            (d/'assets').mkdir(exist_ok=True); (d/'assets'/f"{s['id']}.glb").write_bytes(base64.b64decode(src.split(',', 1)[1])); src = f"assets/{s['id']}.glb"
        if not re.match(r'^assets/[A-Za-z0-9_.-]+\.glb$', src) or not (d/src).is_file(): raise ValueError('Missing file for '+s['id'])
        out['src'] = src
    return out

def save(d, components, revision=None, scene_dir=None):
    """d: a recording's folder (its own components) or a scene's (scope 'scene': in every recording). scene_dir: the scene, for its
    library."""
    p = d/'composition.json'; current = json.loads(p.read_text()) if p.is_file() else {}
    if revision is not None and revision != current.get('revision', 0): raise Conflict('The components were changed in another window. Reload to get them.')
    known = {c['id'] for c in library(scene_dir or (d if (d/'space.json').is_file() else d.parent.parent))}
    specs = [_spec(s, d, known) for s in components or []]
    if len({s['id'] for s in specs}) != len(specs): raise ValueError('Component ids must be unique.')
    doc = dict(version=2, revision=current.get('revision', 0)+1, components=specs); p.write_text(json.dumps(doc, indent=1))
    used = {s.get('src') for s in specs}
    for f in (d/'assets').glob('*.glb') if (d/'assets').is_dir() else []:
        if f'assets/{f.name}' not in used: f.unlink()
    return dict(revision=doc['revision'], components=len(specs), srcs={s['id']: s['src'] for s in specs if 'src' in s})

def _slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:48] or 'object'

def _pose(pose):
    if not (isinstance(pose, dict) and _num(pose.get('position'), 3) and _num(pose.get('rotation', [0, 0, 0]), 3)): raise ValueError('Bad pose.')
    return dict(position=[round(v, 4) for v in pose['position']], rotation=[round(v, 2) for v in pose.get('rotation', [0, 0, 0])])

def _shape(kind, v):
    if kind == 'box':
        if not (_num(v, 3) and min(v) > 0 and max(v) <= 5): raise ValueError('Box size must be three lengths up to 5 m.')
        return [round(x, 4) for x in v]
    if _num(v) and 0 < v <= 100: return round(v, 4)
    if _num(v, 3) and min(v) > 0 and max(v) <= 100: return [round(x, 4) for x in v]
    raise ValueError('Bad scale.')

def add_object(scene_dir, name, kind, size=None, src=None, origin=None, pose=None):
    """A new opportunistic object in the scene's library: kind 'box' (size [w, h, d] m) or 'gltf' (src: a .glb data URL). origin: the
    recording it is made in; pose {position, rotation}: where it is there."""
    name = str(name or '').strip()[:80]
    if not name: raise ValueError('Give the object a name.')
    if kind == 'box':
        entry = dict(name=name, kind='box', category='opportunistic', scope='recording', defaultScale=_shape('box', size))
    elif kind == 'gltf':
        if not (isinstance(src, str) and src.startswith('data:')): raise ValueError('A 3D model must be an embedded .glb.')
        entry = dict(name=name, kind='gltf', entry='model.glb', category='opportunistic', scope='recording', defaultScale=1)
    else: raise ValueError('An object is a box or a 3D model.')
    if origin is not None: entry['origin'] = str(origin)[:120]
    if pose is not None: entry['pose'] = _pose(pose)
    base = Path(scene_dir)/'components'; base.mkdir(exist_ok=True); slug = _slug(name); oid = slug; n = 1
    while (base/oid).exists() or (LIBRARY/oid).exists(): n += 1; oid = f'{slug}-{n}'
    (base/oid).mkdir()
    if kind == 'gltf': (base/oid/'model.glb').write_bytes(base64.b64decode(src.split(',', 1)[1]))
    (base/oid/'component.json').write_text(json.dumps(entry, indent=1))
    return dict(id=oid, path=_rel(base/oid), component=entry)

def _object(scene_dir, oid):
    d = Path(scene_dir)/'components'/str(oid)
    if not (ID.match(str(oid)) and (d/'component.json').is_file()): raise ValueError('Unknown object.')
    entry = json.loads((d/'component.json').read_text())
    if entry.get('category') != 'opportunistic': raise ValueError('Only opportunistic objects can be changed here.')
    return d, entry

def update_object(scene_dir, oid, name=None, shape=None, pose=None, origin=None):
    """Rename an object, change its shape (in every recording) or the pose kept for placing it in more recordings."""
    d, entry = _object(scene_dir, oid)
    if name is not None:
        name = str(name).strip()[:80]
        if not name: raise ValueError('Give the object a name.')
        entry['name'] = name
    if shape is not None: entry['defaultScale'] = _shape(entry.get('kind'), shape)
    if pose is not None: entry['pose'] = _pose(pose)
    if origin is not None and not entry.get('origin'): entry['origin'] = str(origin)[:120]   # an object made before origins were kept
    (d/'component.json').write_text(json.dumps(entry, indent=1)); return dict(id=oid, component=entry)

def replace_object(scene_dir, oid, src, size, pivot):
    """A box object becomes a 3D model (src: a .glb data URL; size and pivot: the model's bounding box size and centre, in its own
    units), in the same place: the pivot sits where the box's centre was, and each placement's box size becomes the uniform scale that
    fits the model in that box (here, in every recording of the scene and in the baseline)."""
    d, entry = _object(scene_dir, oid)
    if entry.get('kind') != 'box': raise ValueError('Only a box object can be replaced by a model.')
    if not (isinstance(src, str) and src.startswith('data:')): raise ValueError('A 3D model must be an embedded .glb.')
    if not (_num(size, 3) and min(size) > 0 and _num(pivot, 3)): raise ValueError('Bad model bounds.')
    fit = lambda sc: max(.0001, round(min(v/s for v, s in zip(sc, size)), 4)) if _num(sc, 3) else sc
    (d/'model.glb').write_bytes(base64.b64decode(src.split(',', 1)[1]))
    entry.update(kind='gltf', entry='model.glb', pivot=[round(v, 5) for v in pivot], defaultScale=fit(entry.get('defaultScale')))
    (d/'component.json').write_text(json.dumps(entry, indent=1)); revisions = {}
    for p in Path(scene_dir).glob('scenarios/*/composition.json'):
        doc = json.loads(p.read_text()); changed = False
        for c in doc.get('components', []):
            if c.get('component') != oid: continue
            c['scale'] = fit(c.get('scale', 1)); changed = True
            if isinstance(c.get('initial'), dict) and 'scale' in c['initial']: c['initial']['scale'] = fit(c['initial']['scale'])
        if changed: doc['revision'] = doc.get('revision', 0)+1; p.write_text(json.dumps(doc, indent=1)); revisions[p.parent.name] = doc['revision']
    return dict(id=oid, component=entry, revisions=revisions)

def remove_object(scene_dir, oid):
    """Drop an opportunistic object from the scene's library, once no recording of the scene places it."""
    d, _ = _object(scene_dir, oid)
    for p in Path(scene_dir).glob('scenarios/*/composition.json'):
        if any(c.get('component') == oid for c in json.loads(p.read_text()).get('components', [])):
            raise ValueError(f'Still placed in recording {p.parent.name}; remove it there first.')
    shutil.rmtree(d); return dict(removed=oid)
