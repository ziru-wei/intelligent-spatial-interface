"""A space back to its initial state (spaces/<space>/modos/initial.json), so every recording of a benchmark starts the same: its devices
as initial.json has them (a mock device's state changes when a question operates it: the lamp dimmed, a print paused) and its mock
outbox emptied (the messages Send sent, and their photos). MOD settings (custom.json) and conversations are not touched.
The system resets every space that has an initial state when it starts (server.py) and when a session is made; a question keeps the
space as it was asked (snapshot) and a replay starts from it (restore)."""
import json
from pathlib import Path
import spaces

def reset(space):
    """→ [what changed]."""
    d = spaces.space_dir(space)/'modos'; init = json.loads((d/'initial.json').read_text())
    changed = []
    ents_f = d/'entities.json'; ents = json.loads(ents_f.read_text()) if ents_f.is_file() else dict(version=1, entities={})
    for eid, dev in init.get('devices', {}).items():
        e = ents['entities'].setdefault(eid, {})
        if e.get('device') != dev:
            was, now = e.get('device') or {}, dev
            for side in ('inputs', 'outputs'):
                for k in sorted(set(was.get(side, {}))|set(now.get(side, {}))):
                    if was.get(side, {}).get(k) != now.get(side, {}).get(k): changed.append(f'{eid} {side}.{k}: {json.dumps(was.get(side, {}).get(k))} → {json.dumps(now.get(side, {}).get(k))}')
            e['device'] = dev
    if changed: ents_f.write_text(json.dumps(ents, indent=2, ensure_ascii=False)+'\n')
    out = d/'outbox.json'
    sent = json.loads(out.read_text()).get('sent', []) if out.is_file() else []
    photos = sorted(d.glob('outbox-photo-*.jpg'))
    if sent or photos:
        out.write_text(json.dumps(dict(sent=[]), indent=2)+'\n')
        for p in photos: p.unlink()
        changed.append(f'outbox: {len(sent)} message(s) and {len(photos)} photo(s) cleared')
    return changed

def snapshot(space_dir):
    """The space's state now, as a question is asked (kept with its input: `state`): its devices and its mock outbox."""
    d = Path(space_dir)/'modos'
    ents = json.loads((d/'entities.json').read_text()).get('entities', {}) if (d/'entities.json').is_file() else {}
    out = json.loads((d/'outbox.json').read_text()).get('sent', []) if (d/'outbox.json').is_file() else []
    return dict(devices={k: e['device'] for k, e in ents.items() if e.get('device')}, outbox=out)

def restore(space_dir, state):
    """The space back to a state (a question's snapshot; None: its initial state, the devices of initial.json and no message sent)."""
    d = Path(space_dir)/'modos'
    if state is None:
        if not (d/'initial.json').is_file(): return
        state = dict(devices=json.loads((d/'initial.json').read_text()).get('devices', {}), outbox=[])
    ents_f = d/'entities.json'; ents = json.loads(ents_f.read_text()) if ents_f.is_file() else dict(version=1, entities={})
    for eid, dev in state.get('devices', {}).items(): ents['entities'].setdefault(eid, {})['device'] = dev
    ents_f.write_text(json.dumps(ents, indent=2, ensure_ascii=False)+'\n')
    (d/'outbox.json').write_text(json.dumps(dict(sent=state.get('outbox', [])), indent=2, ensure_ascii=False)+'\n')

def reset_all():
    """Every space with an initial state reset → {space: [what changed]}."""
    return {d.name: reset(d.name) for d in sorted(spaces.SPACES.iterdir()) if (d/'modos'/'initial.json').is_file()}
