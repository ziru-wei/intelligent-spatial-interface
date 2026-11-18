"""The main page's Gallery: examples that are questions asked in the editor, not recordings.

A gallery example is a conversation of a recording's session tagged with a hidden `gallery_example` = {name, mod} (scripts/agent_store.py).
Its example is the conversation's answered questions (usually one; several asked one after another make one example, under the
first one's MOD), the latest one's answer and still standing for it: re-asking it (demos/gallery.mjs, a queue) or asking a new one in the
Gallery's editor view replaces it. Each example has a still of the camera view at its answer, sent by the editor (`?example=`) when a
question asked there is answered. The examples are written to context/gallery/examples.json (and examples.js, for the page opened as
a file), with the stills beside them, so the page shows them without the editor running.
"""
import base64, json, re, time
from pathlib import Path
import spaces, agent_store as store

GALLERY = Path(__file__).resolve().parents[3]/'context'/'gallery'
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')

def clean_tag(value):
    """{name, mod}: the example's name (lowercase, dashes) and the MOD it shows."""
    if not isinstance(value, dict) or not NAME.match(str(value.get('name') or '')): raise ValueError('A gallery example needs a name like weather-lab.')
    mod = str(value.get('mod') or '').strip()[:40]
    return dict(name=value['name'], mod=mod)

def _text(c, q):
    r = next((r for r in reversed(c['responses']) if r.get('question_id') == q['id'] and r.get('part') == 'text'), None)
    return dict(title=r.get('title') or '', body=r.get('body') or '') if r else None

def entries():
    """The examples now in the store: per name, the newest tagged conversation's answered questions (its still: the latest's answer)."""
    out = {}
    for scenario in sorted(spaces.SPACES.glob('*/scenarios/*')):
        if not (scenario/'agent').is_dir() or not (scenario/'session.json').is_file(): continue
        for c in store._all(scenario):
            tag = c.get('gallery_example')
            if not tag: continue
            q = next((q for q in reversed(c['questions']) if q.get('status') == 'answered'), None)
            if not q: continue
            asked = [x for x in c['questions'] if x.get('status') == 'answered']
            if tag['name'] in out and out[tag['name']]['created'] > c['created']: continue
            still = GALLERY/f"{tag['name']}.jpg"
            out[tag['name']] = dict(name=tag['name'], mod=tag.get('mod', ''), question=asked[0]['text'], answer=_text(c, q),
                questions=[x['text'] for x in asked], first_question_id=asked[0]['id'], first_t=asked[0]['t'],
                session='./'+str(scenario.relative_to(spaces.SPACES.parent)/'session.json'), conversation=c['id'], question_id=q['id'],
                frame=q['frame'], t=q['t'], latency=q.get('latency'), created=c['created'],
                still=still.name if still.is_file() else None, still_at=round(still.stat().st_mtime) if still.is_file() else None)
    return sorted(out.values(), key=lambda e: (e['mod'], e['name']))

def rebuild():
    """Write the examples for the page; returns them."""
    found = entries()
    GALLERY.mkdir(parents=True, exist_ok=True)
    data = dict(examples=found, updated=round(time.time()))
    (GALLERY/'examples.json').write_text(json.dumps(data, indent=1, ensure_ascii=False))
    (GALLERY/'examples.js').write_text('window.GALLERY='+json.dumps(data, ensure_ascii=False)+';\n')
    return found

def save_still(session_dir, cid, image):
    """The camera view at an example's answer (a JPEG data URL from the editor): stored under the example's name."""
    c = store.read(session_dir, cid); tag = c.get('gallery_example')
    if not tag: raise ValueError('Not a gallery example.')
    m = re.match(r'^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$', str(image or ''))
    if not m: raise ValueError('The still must be a JPEG data URL.')
    data = base64.b64decode(m.group(1))
    if len(data) > 3_000_000: raise ValueError('Still too large.')
    GALLERY.mkdir(parents=True, exist_ok=True); (GALLERY/f"{tag['name']}.jpg").write_bytes(data)
    return next((e for e in rebuild() if e['name'] == tag['name']), None)

def replace(name, keep):
    """After a new example is answered: delete the other conversations tagged with this name, in every session."""
    gone = 0
    for scenario in sorted(spaces.SPACES.glob('*/scenarios/*')):
        for c in store._all(scenario):
            if (c.get('gallery_example') or {}).get('name') == name and c['id'] != keep:
                store.delete_conversation(scenario, c['id']); gone += 1
    rebuild(); return dict(removed=gone)

SPEC = Path(__file__).resolve().parents[1]/'demos'/'gallery-examples.json'
MODS = Path(__file__).resolve().parents[1]/'modos'/'mods'

def _mod_of(c, q, space):
    """The MOD an answer shows (its parts' MOD, else its text's), by its name: the first answer's MOD names a group."""
    rs = [r for r in c['responses'] if r.get('question_id') == q['id']]
    mid = next((r['mod']['id'] for r in rs if isinstance(r.get('mod'), dict) and r['mod'].get('id')), None) \
        or next((m.get('id') if isinstance(m, dict) else m for r in rs for m in (r.get('mods') or {}).values() if m), None) \
        or next((r['text_mod']['id'] for r in rs if isinstance(r.get('text_mod'), dict) and r['text_mod'].get('id')), None)
    if not mid: raise ValueError('That answer shows no MOD.')
    for folder in (MODS, spaces.SPACES/space/'modos'/'mods'):
        f = folder/f'{mid}.json'
        if f.is_file(): return json.loads(f.read_text()).get('name') or mid
    return mid

def _slug(text, n=28):
    """Lowercase words joined by dashes, as many whole words as fit in n letters."""
    out = ''
    for w in re.findall(r'[a-z0-9]+', text.lower()):
        if out and len(out)+1+len(w) > n: break
        out = f'{out}-{w}' if out else w[:n]
    return out or 'q'

def add(session_dir, cid, ids):
    """An example made in the editor: one answered question, or several asked one after another (ids, consecutive in the
    conversation), copied into a new conversation tagged as an example (named after the first one's MOD and words) and added to
    demos/gallery-examples.json, so `npm run gallery` asks them again like the others (in order, in one conversation)."""
    c = store.read(session_dir, cid)
    order = [q['id'] for q in c['questions']]
    ids = sorted({int(i) for i in ids or []}, key=lambda i: order.index(i) if i in order else -1)
    if not ids or any(i not in order for i in ids): raise ValueError('Pick questions of this conversation.')
    at = [order.index(i) for i in ids]
    if at != list(range(at[0], at[0]+len(at))): raise ValueError('The questions must follow one another.')
    qs = [c['questions'][i] for i in at]
    if any(q.get('status') != 'answered' for q in qs): raise ValueError('Every question must be answered.')
    space, recording = session_dir.parents[1].name, session_dir.name
    spec = json.loads(SPEC.read_text())
    mod = _mod_of(c, qs[0], space)
    taken = {e['name'] for e in spec['examples']} | {e['name'] for e in entries()}
    base = f"{_slug(mod, 16)}-{_slug(qs[0]['text'])}"; name = base; n = 2
    while name in taken: name = f'{base}-{n}'; n += 1
    tag = clean_tag(dict(name=name, mod=mod))
    keep = {q['id'] for q in qs}   # copied as an import is: question ids stay unique in the scene
    data = dict(name=f'Gallery · {name}', questions=qs, responses=[r for r in c['responses'] if r.get('question_id') in keep])
    copy = store.import_conversation(session_dir, data)
    copy['gallery_example'] = tag; store._write(session_dir, copy)
    entry = dict(name=name, mod=mod, recording=recording)
    if len(qs) == 1: entry.update(ask_at=round(qs[0]['t'], 2), question=qs[0]['text'])
    else: entry['questions'] = [dict(ask_at=round(q['t'], 2), question=q['text']) for q in qs]
    spec['examples'].append(entry)
    SPEC.write_text(json.dumps(spec, indent=2, ensure_ascii=False)+'\n')
    rebuild()
    return dict(example=entry, conversation=copy['id'])
