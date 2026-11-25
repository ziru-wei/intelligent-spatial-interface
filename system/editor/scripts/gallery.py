"""The main page's Gallery: examples that are questions asked in the editor, not recordings.

A gallery example is answered questions of a conversation, tagged where they are with `gallery` = {name, mod} (scripts/agent_store.py;
the conversation shows a star): usually one; several asked one after another make one example, under the first one's MOD. Asking it
again (demos/gallery.mjs, a queue) asks it in a conversation of its own, tagged `gallery_example`; once answered, those questions take
the example's place in its conversation (replace), as a Rerun takes its question's. Each example has a still of the camera view at its answer, sent by the editor (`?example=`) when a
question asked there is answered. The examples are written to media/gallery/examples.json (the site's media; and examples.js, for the page opened as
a file), with the stills beside them, so the page shows them without the editor running.
"""
import base64, json, re, time
from pathlib import Path
import spaces, agent_store as store

GALLERY = Path(__file__).resolve().parents[3]/'media'/'gallery'
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')

def clean_tag(value):
    """{name, mod}: the example's name (lowercase, dashes) and the MOD it shows."""
    if not isinstance(value, dict) or not NAME.match(str(value.get('name') or '')): raise ValueError('A gallery example needs a name like weather-lab.')
    mod = str(value.get('mod') or '').strip()[:40]
    return dict(name=value['name'], mod=mod)

def _text(c, q):
    r = next((r for r in reversed(c['responses']) if r.get('question_id') == q['id'] and r.get('part') == 'text'), None)
    return dict(title=r.get('title') or '', body=r.get('body') or '') if r else None

def _groups(c):
    """{name: (tag, answered questions, since)}: the examples a conversation holds (a re-ask's conversation: all its answered questions)."""
    out = {}
    if c.get('gallery_example'):
        qs = [q for q in c['questions'] if q.get('status') == 'answered']
        if qs: out[c['gallery_example']['name']] = (c['gallery_example'], qs, c['created'])
        return out
    for q in c['questions']:
        tag = q.get('gallery')
        if tag and q.get('status') == 'answered':
            t, qs, since = out.get(tag['name'], (tag, [], 0)); out[tag['name']] = (t, qs+[q], max(since, q.get('created', 0)))
    return out

def entries():
    """The examples now in the store: per name, its answered questions (its still: the latest's answer); a re-ask being answered
    stands for its example once newer."""
    out = {}
    for scenario in sorted(spaces.SPACES.glob('*/scenarios/*')):
        if not (scenario/'agent').is_dir() or not (scenario/'session.json').is_file(): continue
        for c in store._all(scenario):
            for name, (tag, asked, since) in _groups(c).items():
                if name in out and out[name]['since'] > since: continue
                q = asked[-1]; still = GALLERY/f"{name}.jpg"
                out[name] = dict(name=name, mod=tag.get('mod', ''), question=asked[0]['text'], answer=_text(c, q),
                    questions=[x['text'] for x in asked], first_question_id=asked[0]['id'], first_t=min([asked[0]['t']]+[r['t'] for r in asked[0].get('revisions', [])[:1]]),   # typed: where typing began
                    session='./'+str(scenario.relative_to(spaces.SPACES.parent)/'session.json'), conversation=c['id'], question_id=q['id'],
                    question_ids=[x['id'] for x in asked], frame=q['frame'], t=q['t'], latency=q.get('latency'), since=since,
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

def save_still(session_dir, cid, image, name=None):
    """The camera view at an example's answer (a JPEG data URL from the editor, its example view ?example=name): stored under the
    example's name."""
    held = _groups(store.read(session_dir, cid))
    tag = held[name][0] if name in held else next(iter(held.values()))[0] if len(held) == 1 else None
    if not tag: raise ValueError('Not a gallery example.')
    m = re.match(r'^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$', str(image or ''))
    if not m: raise ValueError('The still must be a JPEG data URL.')
    data = base64.b64decode(m.group(1))
    if len(data) > 3_000_000: raise ValueError('Still too large.')
    GALLERY.mkdir(parents=True, exist_ok=True); (GALLERY/f"{tag['name']}.jpg").write_bytes(data)
    return next((e for e in rebuild() if e['name'] == tag['name']), None)

def replace(name, keep):
    """An example asked again (conversation keep, tagged `gallery_example`) and answered: its questions take the example's place in the
    conversation holding it, and that conversation's time is now; keep is then gone. With no such conversation (the example is new, or
    its conversation was deleted), keep becomes the example's: its questions tagged, itself an ordinary conversation."""
    for scenario in sorted(spaces.SPACES.glob('*/scenarios/*')):
        mine = next((c for c in store._all(scenario) if c['id'] == keep), None)
        if mine: break
    else: raise ValueError('Unknown session: '+str(keep))
    tag = mine.get('gallery_example') or {}
    if tag.get('name') != name: raise ValueError('Not this example being asked again.')
    ids = [q['id'] for q in mine['questions'] if q.get('status') == 'answered']
    home = [(c, [q['id'] for q in qs]) for c in store._all(scenario) if c['id'] != keep for n, (t, qs, since) in _groups(c).items() if n == name]
    if home:
        c, old = max(home, key=lambda h: store.when(h[0]))
        store.transplant(scenario, keep, c['id'], ids, old); out = dict(conversation=c['id'], replaced=len(old))
    else:
        mine.pop('gallery_example'); mine['questions'] = [dict(q, gallery=tag) if q['id'] in ids else q for q in mine['questions']]
        store._write(scenario, mine); out = dict(conversation=keep, replaced=0)
    rebuild(); return out

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

TYPED = 'Answer while typing'   # the Gallery's category of examples typed in that mode (design doc 12)

def _slug(text, n=28):
    """Lowercase words joined by dashes, as many whole words as fit in n letters."""
    out = ''
    for w in re.findall(r'[a-z0-9]+', text.lower()):
        if out and len(out)+1+len(w) > n: break
        out = f'{out}-{w}' if out else w[:n]
    return out or 'q'

def add(session_dir, cid, ids):
    """An example made in the editor: one answered question, or several asked one after another (ids, consecutive in the
    conversation), tagged where they are as an example (named after the first one's MOD and words) and added to
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
    # a question typed in Answer while typing (its revisions kept) is an example of that mode: its own category, typed again on re-asking
    typed = any(q.get('revisions') for q in qs)
    mod = TYPED if typed else _mod_of(c, qs[0], space)
    taken = {e['name'] for e in spec['examples']} | {e['name'] for e in entries()}
    base = f"{_slug(mod, 16)}-{_slug(qs[0]['text'])}"; name = base; n = 2
    while name in taken: name = f'{base}-{n}'; n += 1
    tag = clean_tag(dict(name=name, mod=mod))
    for q in qs: q['gallery'] = tag
    store._write(session_dir, c)
    entry = dict(name=name, mod=mod, recording=recording)
    def asked(q):
        one = dict(ask_at=round(q['t'], 2), question=q['text'])
        if q.get('revisions'):   # typed: each revision's text at its moment in the recording and in the typing (pause: the user stopped)
            revs = [r for r in q['revisions'] if not r.get('final')]
            one.update(ask_at=round(revs[0]['t'], 2) if revs else one['ask_at'],
                       typed=[dict(at=round(r['at'], 2), t=round(r['t'], 2), text=r['text'], **({'pause': True} if r.get('pause') else {})) for r in revs])
        return one
    if len(qs) == 1: entry.update(asked(qs[0]))
    else: entry['questions'] = [asked(q) for q in qs]
    spec['examples'].append(entry)
    SPEC.write_text(json.dumps(spec, indent=2, ensure_ascii=False)+'\n')
    rebuild()
    return dict(example=entry, conversation=cid)
