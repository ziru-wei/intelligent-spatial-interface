"""Where the user is, for the agent: the zone they stand in, and a zone they face without being in it (from a corridor, looking or
pointing at its door or window, or standing right by its door). Sent by the headset with a question (`location`), checked against the scene's zones, and given to the
agent as context: words such as "here", "this place", "this room", "this lab", "where am I" refer to the zone the user is in, or, when
they stand outside facing one, may refer to that one; a zone may carry info (scripts/info_context.py), its key named here.

    {in: <zone id> | null, facing: {zone: <zone id>, via: door | window | opening | pointing | near (standing by its door)} | null}

A recording asked about in the editor has no headset to send it: from_camera() derives it from the recorded camera at the question's
frame (the room it stands in, and the first other room its gaze enters through a door, window or opening).
"""
import json
from pathlib import Path
import info_context

VIA = ('door', 'window', 'opening', 'pointing', 'near')

def _rooms(session_dir):
    sem = Path(session_dir).parent.parent/'scan'/'semantic.json'
    return {r['id']: r for r in json.loads(sem.read_text()).get('rooms', [])} if sem.is_file() else {}

def check(session_dir, value):
    """The location as sent, kept to known zones (None when there is nothing)."""
    if value is None: return None
    if not isinstance(value, dict): raise ValueError('Bad location.')
    rooms = _rooms(session_dir)
    inside = value.get('in') if value.get('in') in rooms else None
    facing = value.get('facing')
    if isinstance(facing, dict) and facing.get('zone') in rooms and facing.get('zone') != inside:
        facing = dict(zone=facing['zone'], via=facing.get('via') if facing.get('via') in VIA else 'door')
    else: facing = None
    return dict(**({'in': inside} if inside else {}), **({'facing': facing} if facing else {})) or None

def context(session_dir, value):
    """The agent's view of it: each zone's name and info key, and how deictic words resolve."""
    if not value: return None
    rooms = _rooms(session_dir)
    space = Path(session_dir).parent.parent
    def zone(zid):
        r = rooms.get(zid, {}); out = dict(id=zid, name=r.get('name') or zid)
        if r.get('info'):
            out['info_key'] = r['info']
            v = info_context.lookup(space, r['info'])   # a short text carried by the zone (its full and short names): given as it is
            if v and v.get('text') and len(v['text']) <= 800: out['info'] = v['text']
        return out
    out = {}
    if value.get('in'): out['in'] = zone(value['in'])
    if value.get('facing'): out['facing'] = dict(zone(value['facing']['zone']), via=value['facing']['via'])
    here = out.get('in'); there = out.get('facing')
    out['deixis'] = ('"here", "this place", "this room", "this lab", "where am I" mean the zone the user is in'
                     + (f' ({here["name"]})' if here else '')
                     + (f'; standing outside {there["name"]}, ' + ('right by its door, about to go in' if there["via"] == 'near' else f'facing its {there["via"]}') + f', "this lab"/"this room"/"in there" may mean {there["name"]}' if there else '')
                     + '. A zone carrying an info key names it (e.g. its full and short names). Answer about that zone; ask which place only when it is still unclear.')
    return out

def _openings(sem):
    """(center, half-width direction, via) of each door, window and opening, for a distance to its width, not just its centre."""
    import math
    for b in sem.get('openings', []):
        c, size = b.get('center'), b.get('size') or [1, 1, .1]
        if isinstance(c, list) and len(c) == 3:
            cat = str(b.get('category') or '').lower(); y = b.get('yaw', 0) or 0; h = size[0]/2
            via = 'window' if 'window' in cat or 'sidelight' in str(b.get('id')) else 'door' if 'door' in cat else 'opening'
            yield (c[0], c[2]), (math.cos(y)*h, -math.sin(y)*h), via

def _to_opening(q, o):
    (cx, cz), (dx, dz), _ = o
    L = dx*dx+dz*dz or 1e-9; t = max(-1, min(1, ((q[0]-cx)*dx+(q[2]-cz)*dz)/L))
    return ((q[0]-cx-t*dx)**2+(q[2]-cz-t*dz)**2)**.5

def from_camera(session_dir, session, frame, reach=10.0, step=.1, near=.6, wall=.6):
    """The location of a recorded frame's camera: {in, facing?}, or None outside every room. The gaze (the camera's horizontal
    heading) is followed out of the room: leaving through a door, window or opening, the first room it reaches is the one faced;
    leaving through a wall, nothing is; across an open boundary (one corridor into the next) it goes on."""
    import ego, modos_twin, math
    space = Path(session_dir).parent.parent; m = json.loads((space/'space.json').read_text())
    sem_path = space/(m.get('semantic') or 'scan/semantic.json')
    if not sem_path.is_file(): return None
    sem = json.loads(sem_path.read_text())
    R, p = ego._camera(session, frame)
    fx, fz = -R[0][2], -R[2][2]; n = math.hypot(fx, fz)
    inside = modos_twin.room_at(sem, p)
    out = {'in': inside} if inside else {}
    if n < 1e-6: return out or None
    fx, fz = fx/n, fz/n; openings = list(_openings(sem)); seen, exit_at = inside, None
    for k in range(1, int(reach/step)+1):
        q = (p[0]+fx*k*step, p[1], p[2]+fz*k*step)
        r = modos_twin.room_at(sem, q, tolerance=0)
        if r == seen: exit_at = None; continue
        if r is None:
            exit_at = exit_at or q; continue
        where = exit_at or q
        # Past a wall's thickness the gaze was in space the twin has no room for (another, unmapped room): nothing known is faced.
        if exit_at and ((q[0]-exit_at[0])**2+(q[2]-exit_at[2])**2)**.5 > wall: break
        via = min(((_to_opening(where, o), o[2]) for o in openings), default=(None, None))
        if via[0] is not None and via[0] <= near:
            if r != inside: out['facing'] = dict(zone=r, via=via[1])
            break
        if exit_at: break                     # through a wall
        seen = r                              # an open boundary
    return out or None
