"""A composition: the 3D component instances placed in a recording (src/components.mjs), autosaved by the editor to
spaces/<scene>/scenarios/<take>/composition.json, and those that belong to the scene itself (scope 'scene', in every recording: digital
twins of its objects) in spaces/<scene>/composition.json as {version: 2, revision, components: [spec, ...]}. Imported .glb files arrive as data
URLs and are stored next to it in assets/<instance id>.glb (src becomes that relative path). The library is components/<id>/component.json.
Saves carry the revision the editor loaded; a stale one (another window saved since) is refused."""
import base64, json, math, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]; LIBRARY = ROOT/'components'
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$')

class Conflict(ValueError): pass

def library(scene_dir=None):
    """Components available: components/<id>/ (everywhere) and, for a scene, spaces/<scene>/components/<id>/ (its own, e.g. digital
    twins of its objects): [{id, path}] with path relative to the editor root."""
    out = []
    for base in [LIBRARY]+([Path(scene_dir)/'components'] if scene_dir else []):
        if base.is_dir(): out += [dict(id=d.name, path=d.relative_to(ROOT).as_posix()+'/') for d in sorted(base.iterdir()) if (d/'component.json').is_file() and ID.match(d.name)]
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
