"""ModOS digital twin: one entity view over everything the space holds (modos-system-design.md 3.6).

The source files stay as they are, because the scan pipeline and the layout editor write them:
  scan/semantic.json       rooms (zone:<id>), boxes (layout:<id>), doors and windows (layout:<id>)
  composition.json         scene objects (comp:<id>), for the space and for a recording
  the user context         registered belongings (stored_items), until they are authored in the twin
On top, spaces/<space>/modos/entities.json holds what ModOS adds and what people author in the editor's Space tab (Entities):

    {"version": 1,
     "entities": {<id>: {kind?, category?, traits?, parent?, place?, device?, name?}},   overrides of the derived view
     "added":    [{id, kind, name, ...}]}                                               entities with no source file (items, devices)

Every ModOS module reads entities from here, never from the source files:

    {id, kind, category, traits, parent, place, name, aliases?, device?, info?, source}

kind     layout: place · fixture: structure (walls, ceilings), opening (doors, windows), furniture (large, static) ·
         object: item, artifact (a poster, a booklet, a book), device
traits   what representations can attach to: container, surface, window, door, display, iot, content (carries something to read)
device   only for connected devices (trait iot): {protocol, class?, inputs: {name: typed value}, outputs: {name: typed value}}, value types
         toggle, level, choice, color, command, time, reading, task, queue, alert, media (modos-system-design.md 3.7)
No dependencies beyond the other scripts: used by the server and tests."""
import json, math, re
from pathlib import Path
import user_context

VALUE_TYPES = ('toggle', 'level', 'choice', 'color', 'command', 'time', 'reading', 'task', 'queue', 'alert', 'media')
KINDS = ('place', 'structure', 'opening', 'furniture', 'item', 'artifact', 'device')
# Three layers: the layout (places), the fixtures (walls and ceilings, doors and windows, large static furniture) and the objects
# (things that move or are added: items, artifacts, devices).
LAYER = {'place': 'layout', 'structure': 'fixture', 'opening': 'fixture', 'furniture': 'fixture', 'item': 'object', 'artifact': 'object', 'device': 'object'}
LAYOUT_KINDS = ('place',)
TRAITS = ('container', 'surface', 'window', 'door', 'display', 'iot', 'content')
# content: the thing carries something the user reads (a poster, a book, a screen), so a cue marks it without covering it (Corner
# Brackets, modos-system-design.md 4.4). Derived from its name and scan category by default; set or cleared in the editor.
CONTENT = re.compile(r'poster|flyer|booklet|book|paper|document|sign|notice|board|screen|monitor|tv|television|display|menu|map', re.I)
ID = re.compile(r'^(zone|layout|comp|item|device):[A-Za-z0-9][A-Za-z0-9 _.\-/]{0,95}$')

# Scan categories → (kind, category, traits). The first matching prefix wins.
CATEGORY_MAP = [
    ('storage_cabinet', ('furniture', 'cabinet', ['container'])),
    ('storage_shelf', ('furniture', 'shelf', ['container', 'surface'])),
    ('table', ('furniture', 'table', ['surface'])),
    ('desk', ('furniture', 'desk', ['surface'])),
    ('sofa', ('furniture', 'sofa', ['surface'])),
    ('bed', ('furniture', 'bed', ['surface'])),
    ('refrigerator', ('furniture', 'refrigerator', ['container'])),
    ('sink', ('furniture', 'sink', [])),
    ('stove', ('furniture', 'stove', ['surface'])),
    ('oven', ('furniture', 'oven', ['container'])),
    ('television', ('device', 'television', ['display'])),
    ('printer', ('device', 'printer', [])),
    ('lamp', ('device', 'lamp', [])),
    ('coffee_machine', ('device', 'coffee machine', [])),
    ('door', ('opening', 'door', ['door'])),
    ('window', ('opening', 'window', ['window', 'surface'])),
    ('opening', ('opening', 'opening', [])),
    ('custom', ('artifact', 'artifact', ['display'])),
]

def _json(p, default):
    try: return json.loads(Path(p).read_text())
    except (OSError, ValueError): return default

def space_root(d):
    d = Path(d)
    return d if (d/'space.json').is_file() else d.parent.parent

def _path(space):
    return Path(space)/'modos'/'entities.json'

def _store(space):
    s = _json(_path(space), {})
    return dict(version=1, entities=s.get('entities', {}), added=s.get('added', []))

def _save(space, store):
    p = _path(space); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(store, indent=1, ensure_ascii=False))

def infer(category, label=''):
    """(kind, category, traits) for a scan category; label decides for the generic ones."""
    c = str(category or '').lower()
    for prefix, value in CATEGORY_MAP:
        if c.startswith(prefix): return value[0], value[1], list(value[2])
    return 'furniture', c or 'object', []

def _semantic(space):
    m = _json(space/'space.json', {})
    return _json(space/(m.get('semantic') or 'scan/semantic.json'), {})

def _inside(pt, ring):
    x, z, hit = pt[0], pt[1], False
    for (x1, z1), (x2, z2) in zip(ring, ring[1:]+ring[:1]):
        if (z1 > z) != (z2 > z) and x < (x2-x1)*(z-z1)/((z2-z1) or 1e-12)+x1: hit = not hit
    return hit

def _edge_distance(pt, ring):
    best = 1e9
    for (x1, z1), (x2, z2) in zip(ring, ring[1:]+ring[:1]):
        dx, dz = x2-x1, z2-z1; t = max(0, min(1, ((pt[0]-x1)*dx+(pt[1]-z1)*dz)/((dx*dx+dz*dz) or 1e-12)))
        best = min(best, ((pt[0]-x1-t*dx)**2+(pt[1]-z1-t*dz)**2)**.5)
    return best

def room_at(sem, position, tolerance=.8):
    """The room whose floor polygon holds a 3D point (between its floor and ceiling); for a thing on a wall or in a doorway, the
    nearest room within `tolerance` metres. None when there is none."""
    x, y, z = position; near, best = None, tolerance
    for r in sem.get('rooms', []):
        if not (r.get('floorY', -1e9)-.5 <= y <= r.get('ceilingY', 1e9)+.5): continue
        for poly in r.get('polygon', []):
            if not poly: continue
            if _inside((x, z), poly[0]) and not any(_inside((x, z), hole) for hole in poly[1:]): return r['id']
            dist = _edge_distance((x, z), poly[0])
            if dist < best: near, best = r['id'], dist
    return near

def _derived(space, session=None):
    """Entities read from the source files, before overrides."""
    sem = _semantic(space); out = {}
    for r in sem.get('rooms', []):
        out['zone:'+r['id']] = dict(id='zone:'+r['id'], kind='place', category='room', traits=[], parent=None, place=None,
                                    name=r.get('name') or r['id'], info=r.get('info'), source='semantic')
    for key in ('objects', 'openings'):
        for b in sem.get(key, []):
            if not b.get('id'): continue
            kind, cat, traits = infer(b.get('category'), b.get('label'))
            out['layout:'+b['id']] = dict(id='layout:'+b['id'], kind=kind, category=cat, traits=traits,
                                          parent='layout:'+b['parent'] if b.get('parent') else None,
                                          place='zone:'+(b.get('room') or room_at(sem, b['center']) or '') if (b.get('room') or isinstance(b.get('center'), list) and room_at(sem, b['center'])) else None,
                                          name=b.get('label') or b['id'],
                                          info=b.get('info'), source='semantic', destination=b.get('destination'))
    for key, cat in (('walls', 'wall'), ('ceilings', 'ceiling')):
        for w in sem.get(key, []):
            if not w.get('id'): continue
            rooms = w.get('rooms') or ([w['room']] if w.get('room') else [])
            n = re.search(r'-(?:wall|ceiling)-?(\d+)$', w['id'])
            out['layout:'+w['id']] = dict(id='layout:'+w['id'], kind='structure', category=cat, traits=['surface'], parent=None,
                                          place='zone:'+rooms[0] if rooms else None, places=['zone:'+r for r in rooms],
                                          name=f'{cat} {n.group(1)}' if n else cat, info=None, source='semantic')
    for comp in [space/'composition.json'] + ([Path(session)/'composition.json'] if session else []):
        for c in _json(comp, {}).get('components', []):
            if not c.get('id'): continue
            lib = _json(space/'components'/str(c.get('component'))/'component.json', {})
            room = room_at(sem, c['position']) if isinstance(c.get('position'), list) and len(c['position']) == 3 else None
            out['comp:'+c['id']] = dict(id='comp:'+c['id'], kind='item', category=c.get('component') or 'object', traits=[], parent=None,
                                        place='zone:'+room if room else None, name=c.get('name') or c.get('label') or c.get('component') or c['id'],
                                        info=lib.get('info') or c.get('info'), source='composition')
    # Belongings still kept in the user context: items whose parent is the box they are in. The user context may be shared by several
    # spaces (agent/mock-context.json): a belonging whose box is not in this space's layout is in another space, not here.
    try: stored = user_context.read(session or space, ['storage']).get('stored_items', [])
    except (OSError, ValueError, StopIteration): stored = []
    boxes = {b.get('id') for b in sem.get('objects', [])}
    for i in stored:
        if not isinstance(i.get('id'), str) or (i.get('box_id') and i['box_id'] not in boxes): continue
        box = 'layout:'+i['box_id'] if i.get('box_id') else None
        out['item:'+i['id']] = dict(id='item:'+i['id'], kind='item', category='belonging', traits=[], parent=box, place=None,
                                    name=i.get('label') or i['id'], aliases=i.get('aliases', []), owner='user', source='user-context')
    return out

def entities(space, session=None):
    """{id: entity} of the space: derived from the source files, overridden and extended by modos/entities.json."""
    space = Path(space); store = _store(space); out = _derived(space, session)
    for e in out.values():
        if CONTENT.search(f"{e.get('category') or ''} {e.get('name') or ''}") and 'content' not in e['traits']: e['traits'] = [*e['traits'], 'content']
    for e in store['added']: out[e['id']] = dict(dict(traits=[], parent=None, place=None, category=e.get('kind')), **e, source='authored')
    for eid, patch in store['entities'].items():
        if eid in out: out[eid] = dict(out[eid], **patch)
    # Three layers (LAYER): layout, fixtures, objects.
    for e in out.values(): e['layer'] = LAYER.get(e['kind'], 'object')
    # An item or a nested box is where its parent is.
    for e in out.values():
        p, seen = e.get('parent'), set()
        while not e.get('place') and p in out and p not in seen:
            seen.add(p); e['place'] = out[p].get('place'); p = out[p].get('parent')
    return out

def validate(entity, known):
    eid = entity.get('id')
    if not isinstance(eid, str) or not ID.match(eid): raise ValueError('Entity ids look like item:<name> or device:<name>.')
    if entity.get('kind') not in KINDS: raise ValueError('Kind must be one of: '+', '.join(KINDS)+'.')
    bad = [t for t in entity.get('traits', []) if t not in TRAITS]
    if bad: raise ValueError('Unknown traits: '+', '.join(bad))
    if entity.get('parent') and entity['parent'] not in known: raise ValueError('Unknown parent.')
    if entity.get('parent') == eid: raise ValueError('An entity cannot be its own parent.')
    # The hierarchy. A place may lie in a larger place. Walls, ceilings, doors and windows belong to a place and to nothing else.
    # Furniture belongs to a place and may be part of larger furniture (a shelf of a bookcase). An object is in a place and may be
    # inside furniture or inside another object; never inside a wall, a door or a place through `parent` (its place says where).
    parent = known.get(entity.get('parent')) if entity.get('parent') else None
    kind, pk = entity['kind'], parent['kind'] if parent else None
    if parent:
        if kind == 'place' and pk != 'place': raise ValueError('A place can only lie in another place.')
        if kind in ('structure', 'opening'): raise ValueError('A wall, ceiling, door or window belongs to a place; set its place, not a parent.')
        if kind == 'furniture' and pk != 'furniture': raise ValueError('Furniture can only be part of other furniture.')
        if LAYER.get(kind) == 'object' and pk not in ('furniture', 'item', 'artifact', 'device'):
            raise ValueError('An object can be inside furniture or another object; its place says which place it is in.')
    p, seen = entity.get('parent'), {eid}
    while p:
        if p in seen: raise ValueError('That parent would put the entity inside itself.')
        seen.add(p); p = known.get(p, {}).get('parent')
    if entity.get('place') and known.get(entity['place'], {}).get('kind') != 'place': raise ValueError('An entity\'s place must be a place.')
    dev = entity.get('device')
    if dev is not None:
        if 'iot' not in entity.get('traits', []): raise ValueError('Only an entity with the iot trait has a device.')
        if not isinstance(dev, dict) or not all(isinstance(dev.get(k, {}), dict) for k in ('inputs', 'outputs')):
            raise ValueError('A device has inputs and outputs: {name: {type, ...}}.')
        for side in ('inputs', 'outputs'):
            for name, v in (dev.get(side) or {}).items():
                if not isinstance(v, dict) or v.get('type') not in VALUE_TYPES: raise ValueError(f'{side}.{name} needs a type: {", ".join(VALUE_TYPES)}.')
    elif 'iot' in entity.get('traits', []): raise ValueError('An iot entity needs a device (protocol, inputs, outputs).')
    return entity

EDITABLE = ('kind', 'category', 'traits', 'parent', 'name', 'aliases', 'device', 'place')

def update(space, eid, patch, session=None):
    """Override fields of an entity (derived or authored)."""
    space = Path(space); store = _store(space); current = entities(space, session)
    if eid not in current: raise ValueError('Unknown entity.')
    patch = {k: v for k, v in (patch or {}).items() if k in EDITABLE}
    if 'iot' in patch.get('traits', current[eid].get('traits', [])) and 'device' not in patch and not current[eid].get('device'):
        patch['device'] = dict(protocol='mock', inputs={'power': {'type': 'toggle', 'value': 'off'}}, outputs={})
    if 'iot' not in patch.get('traits', current[eid].get('traits', [])): patch['device'] = None
    validate(dict(current[eid], **patch), current)
    added = next((e for e in store['added'] if e['id'] == eid), None)
    if added: added.update(patch)
    else: store['entities'][eid] = dict(store['entities'].get(eid, {}), **patch)
    _save(space, store); return entities(space, session)[eid]

def add(space, entity, session=None):
    """A new entity with no source file: an item, a device, an artifact."""
    space = Path(space); store = _store(space); current = entities(space, session)
    entity = {k: v for k, v in entity.items() if k in EDITABLE+('id',)}
    entity.setdefault('traits', [])
    if 'iot' in entity['traits'] and not entity.get('device'): entity['device'] = dict(protocol='mock', inputs={'power': {'type': 'toggle', 'value': 'off'}}, outputs={})
    if entity.get('id') in current: raise ValueError('That id is taken.')
    validate(entity, current)
    store['added'].append(entity); _save(space, store); return entities(space, session)[entity['id']]

def remove(space, eid):
    """Remove an authored entity, or drop the overrides of a derived one."""
    space = Path(space); store = _store(space)
    before = len(store['added']); store['added'] = [e for e in store['added'] if e['id'] != eid]
    if len(store['added']) == before and store['entities'].pop(eid, None) is None: raise ValueError('Nothing authored for that entity.')
    _save(space, store)

def belongings(space, session=None):
    """Items and the container each one is in, for FindMy (findmy.catalog's shape)."""
    ents = entities(space, session); sem = _semantic(Path(space)); boxes = {o['id'] for o in sem.get('objects', [])}
    out = []
    for e in ents.values():
        if e['kind'] != 'item' or not e.get('parent') or e.get('source') == 'composition': continue
        box = e['parent'].split(':', 1)[1] if e['parent'].startswith('layout:') else None
        out.append(dict(item_id=e['id'].split(':', 1)[1], label=e['name'], aliases=e.get('aliases', []), box_id=box,
                        box_label=ents.get(e['parent'], {}).get('name', box), available=box in boxes))
    return out


# ——— the scene's boxes and the recorded camera (used by modos_parts and location) ———
ROOT = Path(__file__).resolve().parents[1]

def _vec(v): return isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)

def _library_entry(scene, cid):
    for base in (scene/'components'/cid, ROOT/'components'/cid):
        if (base/'component.json').is_file(): return _json(base/'component.json', {})
    return None

def boxes(d):
    """d: the recording folder (spaces/<scene>/scenarios/<take>). Every box of the scene a part can point at: layout furniture and
    openings (`layout:<id>`) and placed scene objects (`comp:<id>`), as [{id, kind, label, zone, has_model, center, size, yaw}]."""
    d = Path(d); scene = d.parent.parent; m = _json(scene/'space.json', {}); sem = _json(scene/(m.get('semantic') or 'scan/semantic.json'), {})
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
        size = scale if box and _vec(scale) else [.3, .3, .3]   # a model's bounds are the editor's to measure
        out.append(dict(id='comp:'+c['id'], kind='object', label=str(c.get('name') or entry.get('name') or c['component']), zone=None,
                        has_model=not box, center=c['position'], size=size, yaw=(c.get('rotation') or [0, c.get('yaw', 0), 0])[1]))
    return out

def _rot(q):
    x, y, z, w = q
    return [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]

def camera_pose(session, frame):
    """World (scene) rotation rows and position of the recorded camera at a frame (toSpace applied)."""
    f = session['frames'][frame]; R = _rot(f['quaternion']); p = list(f['position'])
    M = session.get('toSpace')
    if M:
        A = [M[0:3], M[4:7], M[8:11]]; t = [M[3], M[7], M[11]]
        R = [[sum(A[i][k]*R[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        p = [sum(A[i][k]*p[k] for k in range(3))+t[i] for i in range(3)]
    return R, p
