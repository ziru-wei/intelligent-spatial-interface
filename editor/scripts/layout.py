"""Scene layout: labelled boxes (a label path with '/' nests a box in its parent: "fridge/shelf 1"; `parent` is the parent's id,
resolved by the editor, src/layout-tree.mjs) (furniture and appliances in `objects`, doors and windows in `openings`; any of them may
carry an `info` key of the space's info context, scripts/info_context.py, as may a zone) and rooms (floor triangles),
in the scene's coordinates. Seeded from a RoomPlan export (scripts/semantic_from_roomplan.py), then corrected by hand in the editor
(Layout → Edit), so it is metadata laid over whichever scan is chosen, not a scan. scan/semantic.json is the working copy;
scan/semantic.roomplan.json keeps what RoomPlan produced.
No dependencies: used by the server and by the RoomPlan extraction."""
import json, math, re

def in_triangle(p, tri):
    (x, z), (a, b, c) = p, tri
    def s(p1, p2, p3): return (p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1])
    d1, d2, d3 = s((x, z), a, b), s((x, z), b, c), s((x, z), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

def room_of(rooms, center):
    """The zone a point is in: zones added by hand (kind 'zone', usually small: a laundry nook) before RoomPlan's rooms."""
    ordered = [r for r in rooms if r.get('kind') == 'zone']+[r for r in rooms if r.get('kind') != 'zone']
    return next((r['id'] for r in ordered if any(in_triangle((center[0], center[2]), t) for t in r['triangles'])), None)

def zone_around(zid, name, boxes, margin=.1, floor_y=0.0):
    """A zone (a room RoomPlan did not capture, e.g. a laundry closet) as the floor rectangle around some boxes: aligned with the first
    box's yaw, grown by margin on every side."""
    a = math.radians(boxes[0].get('yaw', 0)); ux, uz = (math.cos(a), -math.sin(a)), (math.sin(a), math.cos(a))
    pts = []
    for b in boxes:
        ba = math.radians(b.get('yaw', 0)); bx, bz = (math.cos(ba), -math.sin(ba)), (math.sin(ba), math.cos(ba))
        for sx in (-.5, .5):
            for sz in (-.5, .5):
                x, z = b['center'][0]+bx[0]*sx*b['size'][0]+bz[0]*sz*b['size'][2], b['center'][2]+bx[1]*sx*b['size'][0]+bz[1]*sz*b['size'][2]
                pts.append((x*ux[0]+z*ux[1], x*uz[0]+z*uz[1]))
    lo = [min(p[i] for p in pts)-margin for i in (0, 1)]; hi = [max(p[i] for p in pts)+margin for i in (0, 1)]
    corner = lambda u, w: [round(u*ux[0]+w*uz[0], 3), round(u*ux[1]+w*uz[1], 3)]
    c = [corner(lo[0], lo[1]), corner(hi[0], lo[1]), corner(hi[0], hi[1]), corner(lo[0], hi[1])]
    center = [round(sum(p[i] for p in c)/4, 3) for i in (0, 1)]
    return dict(id=zid, name=name, kind='zone', floorY=floor_y, center=center, triangles=[[c[0], c[1], c[2]], [c[0], c[2], c[3]]])

ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$')
def _shape(value):
    """Normalized local x/z footprint, retained through edits and undo/redo."""
    if value is None: return {}
    if not isinstance(value, dict) or value.get('type') not in ('prism', 'cylinder'):
        raise ValueError('Bad layout shape.')
    out = dict(type=value['type'])
    if 'surfaceOnly' in value:
        if not isinstance(value['surfaceOnly'], bool): raise ValueError('Bad surfaceOnly flag.')
        out['surfaceOnly'] = value['surfaceOnly']
    if value['type'] == 'prism':
        p = value.get('footprint')
        if not (isinstance(p, list) and 3 <= len(p) <= 64 and all(isinstance(q, list) and len(q) == 2 and
                all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= .5 for v in q) for q in p)):
            raise ValueError('Bad layout footprint.')
        p = [[round(float(v), 6) for v in q] for q in p]
        if len(set(map(tuple, p))) != len(p): raise ValueError('Repeated footprint vertex.')
        cross = lambda a, b, c: (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        edges = list(zip(p, p[1:]+p[:1]))
        if abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in edges)) < 1e-8: raise ValueError('Empty footprint.')
        for i, (a, b) in enumerate(edges):
            for j, (c, d) in enumerate(edges[i+1:], i+1):
                if j == i+1 or i == 0 and j == len(edges)-1: continue
                if (max(min(a[0],b[0]),min(c[0],d[0])) <= min(max(a[0],b[0]),max(c[0],d[0])) and
                    max(min(a[1],b[1]),min(c[1],d[1])) <= min(max(a[1],b[1]),max(c[1],d[1])) and
                    cross(a,b,c)*cross(a,b,d) <= 0 and cross(c,d,a)*cross(c,d,b) <= 0):
                    raise ValueError('Self-intersecting footprint.')
        out['footprint'] = p
    return dict(shape=out)

def _box(o):
    num = lambda v: isinstance(v, (int, float)) and math.isfinite(v)
    if not (isinstance(o, dict) and ID.match(str(o.get('id', ''))) and isinstance(o.get('center'), list) and isinstance(o.get('size'), list)
            and len(o['center']) == 3 and len(o['size']) == 3 and all(map(num, o['center']+o['size'])) and num(o.get('yaw', 0))):
        raise ValueError('Bad box: '+str(o)[:120])
    label = str(o.get('label') or '').strip()[:48] or o['id']
    parent = o.get('parent') if isinstance(o.get('parent'), str) and ID.match(o['parent']) else None
    destination = o.get('destination')
    if destination is not None and (not isinstance(destination, str) or len(destination) > 80):
        raise ValueError('Bad door destination.')
    extra = dict(destination=destination.strip()) if str(o.get('category', '')).lower() == 'door' and destination and destination.strip() else {}
    info = o.get('info')
    if info is not None and (not isinstance(info, str) or len(info.strip()) > 48 or '/' in info): raise ValueError('Bad info key.')
    if info and info.strip(): extra['info'] = info.strip()
    return dict(id=o['id'], label=label, category=str(o.get('category') or 'custom')[:48], center=[round(float(v), 3) for v in o['center']],
        size=[round(max(.02, float(v)), 3) for v in o['size']], yaw=round(float(o.get('yaw', 0)), 1), parent=parent, **_shape(o.get('shape')), **extra)

def info_key(label):
    """The info key an old information box stood for: the last part of its label."""
    parts = [p.strip() for p in str(label or '').split('/') if p.strip()]
    return parts[-1][:48] if parts else None

def migrate_information(sem):
    """Old layouts kept info as boxes of their own (`information`, their name the key). They become furniture carrying that key.
    Returns sem (changed in place)."""
    for b in sem.pop('information', None) or []:
        sem.setdefault('objects', []).append(dict(b, category=b.get('category') if b.get('category') not in (None, 'information') else 'custom', info=b.get('info') or info_key(b.get('label')) or b['id']))
    return sem

def relate(sem):
    """Everything that depends on the zones, recomputed after they change: each box's zone, the zones on either side of each wall
    (sampled 25 cm out from both faces along its length) and the zones under each ceiling piece (its centre and outline pulled 15%
    inward; `room` is the one under its centre). Geometry is never touched."""
    rooms = sem.get('rooms', [])
    for b in sem.get('objects', [])+sem.get('openings', []): b['room'] = room_of(rooms, b['center'])
    for w in sem.get('walls', []):
        a = math.radians(w['yaw']); along, normal = (math.cos(a), -math.sin(a)), (math.sin(a), math.cos(a)); near = {}
        for t in (-.4, -.2, 0, .2, .4):
            for side in (-1, 1):
                off = side*(w['size'][2]/2+.25)
                r = room_of(rooms, [w['center'][0]+along[0]*t*w['size'][0]+normal[0]*off, 0, w['center'][2]+along[1]*t*w['size'][0]+normal[1]*off])
                if r: near[r] = near.get(r, 0)+1
        # The zone the wall faces most comes first (its colour in the editor), then the others.
        w['rooms'] = sorted(near, key=lambda r: (-near[r], r))
    for c in sem.get('ceilings', []):
        pts = [c['center']]+[[c['center'][i]+.85*(p[i]-c['center'][i]) for i in range(3)] for p in c.get('outline', [])]
        under = [r for r in (room_of(rooms, p) for p in pts) if r]
        c['room'] = room_of(rooms, c['center']); c['rooms'] = sorted(set(under), key=lambda r: (-under.count(r), r))
    return sem

def update(current, objects, openings, information=None):
    """New boxes for a layout (rooms unchanged); each box's room is recomputed from its center. information: old information boxes
    (migrate_information: they become furniture carrying their name as info key)."""
    rooms = current.get('rooms', [])
    objects = list(objects or [])+migrate_information(dict(information=information or []))['objects'] if information else list(objects or [])
    objects, openings = [_box(o) for o in objects], [_box(o) for o in openings or []]
    ids = [o['id'] for o in objects+openings]
    if len(ids) != len(set(ids)): raise ValueError('Box ids must be unique.')
    for o in objects+openings:
        o['room'] = room_of(rooms, o['center'])
        if o['parent'] not in ids or o['parent'] == o['id']: o['parent'] = None
    out = dict(current, objects=objects, openings=openings, edited=True);out.pop('information', None);return out
