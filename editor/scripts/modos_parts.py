"""ModOS response parts that point at things of the twin, resolved into what the editor and the headset draw (scripts/agent_store.py):

  highlight  {targets: [entity ids], tones?: {id: neutral|attention|warning}, states?: {id: text}, door?: true, guidance?: bool, label?: bool}
             each target's box (center, size, yaw, label); with door, a target place becomes its door: the door or opening on the place's
             boundary nearest to where the question was asked (Wayfinding)
  control    {device: entity id, action?: one of its actions}
             the device's box, states and actions; the action is applied first (IoTControl)

Devices are the twin's connected devices (traits iot, `device`: protocol, states, actions, and what the states are). The panel that shows
them is built from the kinds of state, not per device (src/device-panel.mjs):
  power            "on" / "off"                                   a switch
  a level          a number with `ranges: {name: [min, max]}`       a slider (brightness, volume, temperature)
  a choice         a value with `options: {name: [...]}`            segments (input, mode)
  a task           {title, total, done?, unit, total_s, elapsed_s}  progress with the time left, live (a print job, a cycle)
  a queue          [{title, total, unit}]                           what comes next
  other actions    momentary buttons (cancel job)
The only protocol so far is `mock`: an action changes the stored state; a task's progress runs from elapsed_s at the moment it is read.
No dependencies beyond the other scripts."""
import json, math, re
from pathlib import Path
import ego, modos_twin

TONES = ('neutral', 'attention', 'warning')
MAX_TARGETS = 8

def _space(d): return Path(d).parent.parent

def _boxes(d):
    return {b['id']: b for b in ego.catalog(d)}

def _semantic(space):
    m = json.loads((space/'space.json').read_text())
    p = space/(m.get('semantic') or 'scan/semantic.json')
    return json.loads(p.read_text()) if p.is_file() else {}

def _camera(d, frame):
    try:
        s = json.loads((Path(d)/'session.json').read_text())
        return ego._camera(s, min(max(0, int(frame or 0)), len(s['frames'])-1))[1]
    except (OSError, ValueError, KeyError, IndexError): return None

def door_of(d, zone, frame=0):
    """The door (or opening) on the place's boundary nearest to the camera at `frame`: its box, or None."""
    space = _space(d); sem = _semantic(space); rid = zone.split(':', 1)[1]
    room = next((r for r in sem.get('rooms', []) if r.get('id') == rid), None)
    if not room: return None
    boxes, cam = _boxes(d), _camera(d, frame)
    doors = []
    for o in sem.get('openings', []):
        c = o.get('center')
        if not c: continue
        on = o.get('room') == rid or any(modos_twin._inside((c[0], c[2]), poly[0]) or modos_twin._edge_distance((c[0], c[2]), poly[0]) <= .6
                                         for poly in room.get('polygon', []) if poly)
        if on and 'layout:'+o['id'] in boxes: doors.append(boxes['layout:'+o['id']])
    if not doors: return None
    door_first = sorted(doors, key=lambda b: (0 if b['kind'] == 'opening' and 'door' in b['label'].lower() else 1,
                                              math.dist(cam, b['center']) if cam else 0))
    return door_first[0]

# Things whose surface carries what the user reads (a cue must not cover it: Corner Brackets instead of a box): the twin's `content` trait.
def has_content(entity, box=None):
    return 'content' in (entity.get('traits') or [])

def resolve_highlight(d, value, frame=0):
    if not isinstance(value, dict) or set(value)-{'targets', 'tones', 'states', 'door', 'guidance', 'label'}: raise ValueError('Bad highlight.')
    ids = value.get('targets')
    if not (isinstance(ids, list) and 0 < len(ids) <= MAX_TARGETS and all(isinstance(i, str) for i in ids)): raise ValueError('Highlight needs 1-8 targets.')
    tones = value.get('tones') or {}
    if not isinstance(tones, dict) or any(t not in TONES for t in tones.values()): raise ValueError('Bad highlight tone.')
    # each thing's state in a few words, from its status data (Status Pulse shows it; modos/selectors.mjs stateText)
    states = value.get('states') or {}
    if not isinstance(states, dict) or any(not isinstance(t, str) or len(t) > 60 for t in states.values()): raise ValueError('Bad highlight state.')
    boxes, ents, out = _boxes(d), modos_twin.entities(_space(d), d), []
    for i in ids:
        if value.get('door') and i.startswith('zone:'):
            b = door_of(d, i, frame)
            if not b: raise ValueError(f'No door found for {i}.')
            place = ents.get(i, {}).get('name') or i
            out.append(dict(id=b['id'], label=place, of=i, center=b['center'], size=b['size'], yaw=b['yaw'], tone='attention'))
            continue
        b = boxes.get(i)
        if not b: raise ValueError(f'{i} has no box in the scene.')
        e = ents.get(i, {})
        out.append(dict(id=i, label=e.get('name') or b['label'], center=b['center'], size=b['size'], yaw=b['yaw'], tone=tones.get(i, 'neutral'),
                        has_content=has_content(e, b), **({'state': states[i]} if states.get(i) else {})))
    return dict(version=1, targets=out, guidance=value.get('guidance') is True, label=value.get('label') is True)

def apply_action(space, entity, key, op='set', value=None):
    """Change one of a device's Inputs (mock protocol: the stored device changes). op: set (toggle, level, choice), up / down (a level,
    one step), next (a choice), command (a command input's value: start, pause, resume, cancel). Returns the device after it."""
    e = modos_twin.entities(space).get(entity)
    if not e or not e.get('device'): raise ValueError('Not a connected device.')
    dev = json.loads(json.dumps(e['device'])); ins, outs = dev.setdefault('inputs', {}), dev.setdefault('outputs', {})
    inp = ins.get(key)
    if not inp: raise ValueError(f'{e["name"]} has no input {key}.')
    t = inp['type']
    if t == 'toggle':
        v = ('off' if inp.get('value') == 'on' else 'on') if op == 'toggle' else value
        if v not in ('on', 'off'): raise ValueError(f'{key} is on or off.')
        inp['value'] = v
    elif t == 'level':
        lo, hi = inp.get('min', 0), inp.get('max', 100); step = inp.get('step') or (hi-lo)/5
        v = float(inp.get('value', lo))+(step if op == 'up' else -step) if op in ('up', 'down') else float(value)
        inp['value'] = round(max(lo, min(hi, v)), 2)
        if inp['value'] == int(inp['value']): inp['value'] = int(inp['value'])
        if 'power' in ins and ins['power'].get('type') == 'toggle' and op in ('up', 'set'): ins['power']['value'] = 'on'
    elif t == 'choice':
        opts = inp.get('options') or []
        v = opts[(opts.index(inp.get('value'))+1) % len(opts)] if op == 'next' and inp.get('value') in opts else value
        if v not in opts: raise ValueError(f'{key} is one of {", ".join(opts)}.')
        inp['value'] = v
    elif t == 'command':
        if value not in (inp.get('commands') or []): raise ValueError(f'{key} can {", ".join(inp.get("commands") or [])}.')
        task = outs.get(inp.get('for') or '')
        if value == 'cancel' and task:
            queue = outs.get('queue', {}).get('items', []) if isinstance(outs.get('queue'), dict) else []
            outs[inp['for']] = dict(type='task', **{k: v for k, v in queue[0].items() if k != 'type'}, elapsed_s=0) if queue else dict(type='task', title=None)
            if queue: outs['queue']['items'] = queue[1:]
        elif value in ('pause', 'resume') and task: task['paused'] = value == 'pause'
        inp['last'] = value
    else: raise ValueError(f'{key} cannot be changed.')
    modos_twin.update(space, entity, {'device': dev})
    return dev

def resolve_control(d, value):
    """{device, action?: {key, op, value}} → the device's box, its Inputs and Outputs before and after the action, and which input changed."""
    if not isinstance(value, dict) or set(value)-{'device', 'action', 'panel'}: raise ValueError('Bad control.')
    entity = value.get('device'); action = value.get('action')
    boxes = _boxes(d)
    if entity not in boxes: raise ValueError('The device has no box in the scene.')
    space = _space(d)
    before = (modos_twin.entities(space).get(entity) or {}).get('device')
    if not before: raise ValueError('Not a connected device.')
    if action is not None and not (isinstance(action, dict) and isinstance(action.get('key'), str)): raise ValueError('Bad device action.')
    dev = apply_action(space, entity, action['key'], action.get('op', 'set'), action.get('value')) if action else before
    b = boxes[entity]; name = modos_twin.entities(space).get(entity, {}).get('name') or b['label']
    return dict(version=2, device=dict(id=entity, label=name, center=b['center'], size=b['size'], yaw=b['yaw'], **{'class': dev.get('class')}),
                before=dict(inputs=before.get('inputs', {}), outputs=before.get('outputs', {})),
                inputs=dev.get('inputs', {}), outputs=dev.get('outputs', {}), changed=(action or {}).get('key'), op=(action or {}).get('op'),
                panel=value.get('panel') is not False)

# Delegate's action card: a pending action, run only when the user presses its confirm button (POST /api/modos/actions).
def _contacts(space):
    try: items = json.loads((space/'modos'/'items.json').read_text()).get('items', [])
    except (OSError, ValueError): items = []
    return {p['id']: p for i in items if i.get('id') == 'user:contacts' for p in i.get('data', [])}

def resolve_action(d, value):
    if not isinstance(value, dict) or set(value)-{'kind', 'to', 'attachment', 'capture'} or value.get('kind') != 'send': raise ValueError('Bad action.')
    capture = value.get('capture') or ('thing' if value.get('attachment') else 'none')
    if capture not in ('thing', 'photo', 'none'): raise ValueError('Bad capture.')
    space = _space(d); person = _contacts(space).get(value.get('to'))
    if not person: raise ValueError('Unknown contact.')
    out = dict(version=1, kind='send', to=dict(id=person['id'], name=person['name'], email=person['email']), status='draft', capture=capture)
    if value.get('attachment'):
        b = _boxes(d).get(value['attachment'])
        if not b: raise ValueError('The attachment has no box in the scene.')
        name = modos_twin.entities(space, d).get(value['attachment'], {}).get('name') or b['label']
        out['attachment'] = dict(id=value['attachment'], label=name, center=b['center'], size=b['size'], yaw=b['yaw'])
    return out

def send(space, action, message):
    """Mock: the message goes to the space's outbox (spaces/<space>/modos/outbox.json); nothing leaves the machine."""
    if not isinstance(action, dict) or action.get('kind') != 'send': raise ValueError('Bad action.')
    person = _contacts(space).get((action.get('to') or {}).get('id'))
    if not person: raise ValueError('Unknown contact.')
    if not isinstance(message, dict) or not str(message.get('body') or '').strip(): raise ValueError('The message is empty.')
    import time
    p = space/'modos'/'outbox.json'
    try: box = json.loads(p.read_text())
    except (OSError, ValueError): box = {'sent': []}
    entry = dict(to=person['email'], name=person['name'], subject=str(message.get('title') or '')[:200], body=str(message['body'])[:4000],
                 attachment=(action.get('attachment') or {}).get('label'), at=time.time())
    # A photo taken of the thing (the client's crop of the camera frame, a JPEG data URL) is kept beside the outbox.
    photo = message.get('photo')
    if action.get('capture') == 'photo' and isinstance(photo, str) and photo.startswith('data:image/jpeg;base64,') and len(photo) < 3_000_000:
        import base64
        name = f'outbox-photo-{int(entry["at"]*1000)}.jpg'; (space/'modos'/name).write_bytes(base64.b64decode(photo.split(',', 1)[1]))
        entry['photo'] = name
    box['sent'].append(entry); p.write_text(json.dumps(box, indent=1, ensure_ascii=False))
    return dict(sent=True, **entry)
