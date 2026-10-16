"""Where the user is, for the agent: the zone they stand in, and a zone they face without being in it (from a corridor, looking or
pointing at its door or window, or standing right by its door). Sent by the headset with a question (`location`), checked against the scene's zones, and given to the
agent as context: words such as "here", "this place", "this room", "this lab", "where am I" refer to the zone the user is in, or, when
they stand outside facing one, may refer to that one; a zone may carry info (scripts/info_context.py), its key named here.

    {in: <zone id> | null, facing: {zone: <zone id>, via: door | window | opening | pointing | near (standing by its door)} | null}
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
