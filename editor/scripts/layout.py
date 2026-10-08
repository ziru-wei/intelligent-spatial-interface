"""Scene layout: labelled boxes (a label path with '/' nests a box in its parent: "fridge/shelf 1"; `parent` is the parent's id,
resolved by the editor, src/layout-tree.mjs) (furniture and appliances in `objects`, doors and windows in `openings`) and rooms (floor triangles),
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
def _box(o):
    num = lambda v: isinstance(v, (int, float)) and math.isfinite(v)
    if not (isinstance(o, dict) and ID.match(str(o.get('id', ''))) and isinstance(o.get('center'), list) and isinstance(o.get('size'), list)
            and len(o['center']) == 3 and len(o['size']) == 3 and all(map(num, o['center']+o['size'])) and num(o.get('yaw', 0))):
        raise ValueError('Bad box: '+str(o)[:120])
    label = str(o.get('label') or '').strip()[:48] or o['id']
    parent = o.get('parent') if isinstance(o.get('parent'), str) and ID.match(o['parent']) else None
    return dict(id=o['id'], label=label, category=str(o.get('category') or 'custom')[:48], center=[round(float(v), 3) for v in o['center']],
        size=[round(max(.02, float(v)), 3) for v in o['size']], yaw=round(float(o.get('yaw', 0)), 1), parent=parent)

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

def update(current, objects, openings):
    """New boxes for a layout (rooms unchanged); each box's room is recomputed from its center."""
    rooms = current.get('rooms', [])
    objects, openings = [_box(o) for o in objects or []], [_box(o) for o in openings or []]
    ids = [o['id'] for o in objects+openings]
    if len(ids) != len(set(ids)): raise ValueError('Box ids must be unique.')
    for o in objects+openings:
        o['room'] = room_of(rooms, o['center'])
        if o['parent'] not in ids or o['parent'] == o['id']: o['parent'] = None
    return dict(current, objects=objects, openings=openings, edited=True)
