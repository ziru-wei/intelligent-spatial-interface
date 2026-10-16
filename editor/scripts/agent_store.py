"""Agent conversations for one scene (the UI calls them sessions): spaces/<space>/scenarios/<take>/agent/<id>.json, each holding its own questions
and responses, so a new conversation starts with an empty timeline. Question ids are unique across a scene's conversations because
the agent only echoes the number back. All access goes through `lock`; the bridge long-polls on it."""
import json, re, threading, time
import weather, findmy, ego, conversation_context
from datetime import datetime

lock = threading.Condition()
editor_state, bridge_seen, recovered = {}, {}, set()
ID = re.compile(r'^\d{8}-\d{6}(-\d+)?$')
STUCK_S = 300

def folder(d): return d/'agent'
def _path(d, cid):
    p = folder(d)/f'{cid}.json'
    if not ID.match(str(cid or '')) or not p.is_file(): raise ValueError('Unknown session: '+str(cid))
    return p
def read(d, cid): return json.loads(_path(d, cid).read_text())
def _write(d, c): folder(d).mkdir(exist_ok=True); (folder(d)/f"{c['id']}.json").write_text(json.dumps(c, indent=2, ensure_ascii=False))
def _all(d): return [json.loads(p.read_text()) for p in sorted(folder(d).glob('*.json'))] if folder(d).is_dir() else []

def _prepare(d):
    """Once per scene per server run: move the single-file answers of earlier versions into a conversation, and fail questions
    that were mid-answer when the server stopped."""
    if str(d) in recovered: return
    recovered.add(str(d)); legacy = d/'agent-responses.json'
    if legacy.is_file():
        items = json.loads(legacy.read_text())
        if items: create(d, 'Earlier answers', responses=items)
        legacy.unlink()
    for c in _all(d):
        stale = [q for q in c['questions'] if q['status'] in ('running', 'queued')]
        for q in stale:
            q.update(status='failed', message='Interrupted: the editor server restarted.')
            for r in c['responses']:
                if r.get('question_id') == q['id'] and r.get('stream', {}).get('status') == 'streaming': _fail_stream(r, q)
        linked = _link_orphans(d, c)
        if stale or linked: _write(d, c)

def _link_orphans(d, c):
    """Answers without a question (earlier versions, or asked in the terminal) get one, so every answer has a timeline marker."""
    known = {q['id'] for q in c['questions']}
    orphans = [r for r in c['responses'] if r.get('question_id') not in known]
    first = _next_qid(d)
    for i, r in enumerate(orphans):
        q = dict(id=first+i, text=r.get('question') or r.get('title') or '(asked in the terminal)', frame=r.get('frame', 0), t=r.get('t', 0),
            status='answered', response=r['id'], created=r.get('created', time.time()))
        c['questions'].append(q); r['question_id'] = q['id']
    return bool(orphans)

def create(d, name=None, questions=(), responses=()):
    now = datetime.now(); cid = f"{now:%Y%m%d-%H%M%S}-{time.time_ns()}"; n = 1
    while (folder(d)/f'{cid}.json').exists(): cid = f"{now:%Y%m%d-%H%M%S}-{n}"; n += 1
    c = dict(id=cid, name=(name or '').strip()[:80] or now.strftime('%Y-%m-%d %H:%M:%S'), created=time.time(), questions=list(questions), responses=list(responses))
    _write(d, c); return c

def listing(d):
    _prepare(d)
    return sorted((dict(id=c['id'], name=c['name'], created=c['created'], questions=len(c['questions']), responses=len(c['responses'])) for c in _all(d)), key=lambda c: c['created'])

def rename(d, cid, name):
    c = read(d, cid); name = str(name or '').strip()[:80]
    if not name: raise ValueError('Empty name.')
    c['name'] = name; _write(d, c); return c

def import_conversation(d, data):
    """A new conversation from an exported one; question ids are renumbered for this scene and answers keep their links."""
    if not isinstance(data, dict) or not isinstance(data.get('questions', []), list) or not isinstance(data.get('responses', []), list): raise ValueError('Not an exported session.')
    first = _next_qid(d); ids = {}
    questions = []
    for i, q in enumerate(data.get('questions', [])):
        ids[q.get('id')] = first+i
        questions.append(dict(q, id=first+i, status=q.get('status') if q.get('status') in ('answered', 'failed') else 'failed'))
    responses = [dict(r, id=i+1, question_id=ids.get(r.get('question_id'))) for i, r in enumerate(data.get('responses', []))]
    return create(d, str(data.get('name') or 'Imported'), questions, responses)

def _next_qid(d):
    counter = folder(d)/'.question-high-water'
    floor = int(counter.read_text()) if counter.is_file() else 0
    return max(floor, max((q['id'] for c in _all(d) for q in c['questions']), default=0))+1

def delete_conversation(d, cid):
    p = _path(d, cid)
    # Never reuse deleted question ids: a bridge may still return an old answer.
    (folder(d)/'.question-high-water').write_text(str(_next_qid(d)-1))
    p.unlink()
    remaining = _all(d)
    next_session = max(remaining, key=lambda c: c['created']) if remaining else create(d)
    if editor_state.get(str(d), {}).get('conversation') == cid:
        editor_state[str(d)]['conversation'] = next_session['id']
    lock.notify_all()
    return dict(ok=True, conversation=next_session['id'])
def _find_question(d, qid):
    for c in _all(d):
        for q in c['questions']:
            if str(q['id']) == str(qid): return c, q
    return None, None
def running_question(d):
    """The most recently started question being answered (several bridges may run at once)."""
    running = [(q.get('started', 0), c, q) for c in _all(d) for q in c['questions'] if q['status'] == 'running']
    if not running: return None, None
    _, c, q = max(running, key=lambda x: x[0]); return c, q

def ask(d, cid, frame, t, text, live=None, weather_mod=False, text_response=None, findmy_mod=False, ego_mod=False, selection=None, pose=None, location=None):
    """live = {read_s}: asked in the editor, which held the video on the question's frame while the agent answered and for `read_s`
    real seconds after the answer appeared; replays hold the same way, using the measured latency.
    text_response = {default: bool, <mod>: bool}: whether a text answer is wanted, for answers in no mod and per mod that is on
    (src/response-settings.mjs); off skips the language model (scripts/jev-pipeline.mjs). Missing: always."""
    c = read(d, cid)
    q = dict(weather_mod=weather_mod is True, findmy_mod=findmy_mod is True, ego_mod=ego_mod is True, id=_next_qid(d), text=text[:500], frame=frame, t=t, status='queued', created=time.time())
    if isinstance(live, dict):
        read_s = float(live.get('read_s', 5))
        if not 0 <= read_s <= 30: raise ValueError('Bad live timing.')
        q['live'] = dict(read_s=read_s)
    if isinstance(text_response, dict): q['text_response'] = {str(k): v is not False for k, v in text_response.items()}
    if selection: q['selection'] = selection   # an information box the user looked at, pointed at or touched (scripts/info_context.py selection)
    if pose: q['pose'] = pose   # asked live on a headset (a live session, no recording): the user's head pose then, in scene coordinates
    if location: q['location'] = location   # the zone the user is in and one they face (scripts/location.py)
    c['questions'].append(q); _write(d, c); lock.notify_all(); return dict(q, conversation=cid)

def take_next(d):
    """Oldest queued question in any of the scene's conversations, marked running; None if there is none.
    A question still running well past the bridge's 4-minute turn limit was interrupted (bridge stopped mid-answer). Several bridges
    may serve one scene, so a question another bridge is answering right now is left alone."""
    for c in _all(d):
        stuck = [q for q in c['questions'] if q['status'] == 'running' and time.time()-q.get('started', 0) > STUCK_S]
        for q in stuck: q.update(status='failed', message='Interrupted: the agent stopped before answering.')
        if stuck: _write(d, c)
    queued = [(q['created'], c, q) for c in _all(d) for q in c['questions'] if q['status'] == 'queued']
    if not queued: return None
    _, c, q = min(queued, key=lambda x: x[0]); q.update(status='running', started=time.time()); _write(d, c)
    return dict(q, conversation=c['id'])

def set_info(d, qid, info_key, interaction_id=None, source=None):
    """The info key a question was answered with (scripts/jev-pipeline.mjs info route) and the language model's interaction id, so a
    follow-up about the same item continues from it instead of sending the info again."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if not isinstance(info_key, str) or not info_key.strip() or len(info_key) > 48: raise ValueError('Bad info key.')
    if interaction_id is not None and (not isinstance(interaction_id, str) or len(interaction_id) > 200): raise ValueError('Bad interaction id.')
    q['info'] = dict(key=info_key, source=source if source in ('selection', 'follow-up') else 'selection', **({'interaction_id': interaction_id} if interaction_id else {}))
    _write(d, c); return q['info']

def active_info(conversation, current):
    """The info item of the conversation's last answered question before this one ({key, question_id, interaction_id?}), if it used one."""
    if not conversation or not current: return None
    earlier = [q for q in conversation.get('questions', []) if q.get('created', 0) < current.get('created', 0) and q.get('status') == 'answered']
    last = earlier[-1] if earlier else None
    return dict(last['info'], question_id=last['id']) if last and last.get('info') else None

def response_info(c, q, value):
    """What an info answer is about, for placing it next to its box (src/placement.mjs): {key, box_id}. The box is the one the user
    selected when asking, else the one selected for the same key earlier in the conversation, else None (the editor takes the nearest
    box of that key)."""
    if value is None: return None
    k = value.get('key') if isinstance(value, dict) else None
    if not isinstance(k, str) or not k.strip() or len(k) > 48: raise ValueError('Bad response info.')
    asked = [x for x in c.get('questions', []) if x.get('created', 0) <= q.get('created', 0)]
    box = next((x['selection']['box_id'] for x in reversed(asked) if x.get('selection', {}).get('key') == k), None)
    return dict(key=k, box_id=box)

def log_placement(d, qid, event):
    """One placement event of a question's answer, appended to agent/placement-log/q<id>.jsonl (a debug record: where the answer was
    put, from where, what was weighed, when it locked; src/app.mjs). Kept apart from the conversations; at most 64 KB per event."""
    if type(qid) is not int or qid < 0: raise ValueError('Bad question id.')
    line = json.dumps(event, ensure_ascii=False)
    if not isinstance(event, dict) or len(line) > 65536: raise ValueError('Bad placement event.')
    f = folder(d)/'placement-log'/f'q{qid}.jsonl'; f.parent.mkdir(parents=True, exist_ok=True)
    with f.open('a') as out: out.write(line+'\n')
    return dict(ok=True)

def add_trace(d, qid, step):
    """One step of the agent's work on a question (tool call, message, error), with ms since the turn started."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if not isinstance(step, dict): raise ValueError('Bad trace step.')
    trace = q.setdefault('trace', [])
    if len(trace) < 60:
        trace.append(dict(kind=str(step.get('kind') or 'message')[:16], tool=str(step.get('tool') or '')[:60] or None,
            text=str(step.get('text') or '')[:500], at=int(step.get('at') or 0)))
        _write(d, c)
    return dict(ok=True)

def finish(d, qid, message, duration=None):
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    # Finishing without show_response means the agent answered only in the terminal, or failed.
    if q['status'] == 'running':
        responses = [r for r in c['responses'] if r.get('question_id') == q['id']]
        for r in responses:
            if r.get('stream', {}).get('status') == 'streaming': _fail_stream(r, q)
        useful = any(r.get('part') == 'ui' or r.get('stream', {}).get('status') != 'failed' for r in responses)
        q.update(status='answered' if useful else 'failed', message=str(message or 'The agent finished without showing a response.')[:300])
        if q.get('parts'): q['latency'] = round(time.time()-q.get('started', time.time()), 2)
    q['finished'] = time.time()
    q['duration'] = round(float(duration), 1) if isinstance(duration, (int, float)) else round(q['finished']-q.get('started', q['finished']), 1)
    _write(d, c); return q

def delete_question(d, cid, qid):
    c = read(d, cid); q = next((q for q in c['questions'] if str(q['id']) == str(qid)), None)
    if not q: raise ValueError('Unknown question.')
    if q['status'] == 'running': raise ValueError('The agent is answering this question right now.')
    c['questions'].remove(q); c['responses'] = [r for r in c['responses'] if str(r.get('question_id')) != str(qid)]
    _write(d, c); return dict(ok=True)

def add_response(d, body):
    if not (body.get('title') or body.get('body') or body.get('items') or (body.get('part') == 'ui' and (body.get('weather') or body.get('findmy') or body.get('ego'))) or (body.get('part') == 'animation' and body.get('animation'))): raise ValueError('A response needs a title, body or items.')
    c, q = _find_question(d, body.get('question_id')) if body.get('question_id') is not None else (None, None)
    if body.get('question_id') is not None and not q: raise ValueError('Unknown question.')
    part = body.get('part')
    if part not in (None, 'ui', 'text', 'animation'): raise ValueError('Unknown response part.')
    if part and not q: raise ValueError('Response parts need a question_id.')
    if body.get('stream') is not None:
        if part != 'text' or body.get('weather') is not None or body.get('findmy') is not None or body.get('ego') is not None: raise ValueError('Only text parts can stream.')
        return _add_stream(d, c, q, body)
    if part and any(r.get('part') == part and r.get('question_id') == q['id'] for r in c['responses']):
        return next(r for r in c['responses'] if r.get('part') == part and r.get('question_id') == q['id'])
    if part == 'ui' and (body.get('title') or body.get('body') or body.get('items')): raise ValueError('UI part cannot contain language text.')
    if part == 'text' and (body.get('weather') is not None or body.get('findmy') is not None or body.get('ego') is not None): raise ValueError('Text part cannot contain mod UI.')
    if q: at = q
    else:
        # Asked in the terminal: the conversation and frame the editor shows.
        at = editor_state.get(str(d)) or {}
        convs = _all(d); c = next((x for x in convs if x['id'] == at.get('conversation')), None) or (max(convs, key=lambda x: x['created']) if convs else create(d))
    r = dict(id=max((r['id'] for r in c['responses']), default=0)+1, created=time.time(), frame=at.get('frame', 0), t=at.get('t', 0),
        question=q['text'] if q else str(body.get('question') or ''), question_id=q['id'] if q else None, title=str(body.get('title') or ''),
        body=str(body.get('body') or ''), items=[str(i) for i in body.get('items') or []][:12], anchor=body.get('anchor') or None)
    if body.get('reserve_text') is True: r['reserve_text'] = True
    # A zone's animation (scripts/jev-pipeline.mjs ZONE_ANIMATIONS: the lab's diorama), played on the headset beside the text.
    if part == 'animation':
        a = body.get('animation')
        if not (isinstance(a, dict) and isinstance(a.get('id'), str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', a['id'])): raise ValueError('Bad animation.')
        r['animation'] = dict(id=a['id'], zone=str(a.get('zone') or '')[:64])
    elif body.get('animation') is not None: raise ValueError('Only an animation part carries an animation.')
    if body.get('info') is not None:
        if part != 'text' or not q: raise ValueError('Only a text part of a question can carry info.')
        r['info'] = response_info(c, q, body['info'])
    if sum(body.get(k) is not None for k in ('weather', 'findmy', 'ego')) > 1: raise ValueError('Only one mod per response.')
    if body.get('ego') is not None:
        if not at.get('ego_mod'): raise ValueError('Object mod was not enabled for this question.')
        r['ego'] = ego.resolve(d, body['ego'])
    if body.get('findmy') is not None:
        if not at.get('findmy_mod'): raise ValueError('FindMy mod was not enabled for this question.')
        r['findmy'] = findmy.resolve(d,body['findmy'])
    if body.get('weather') is not None:
        if not at.get('weather_mod',at.get('weather_mode')): raise ValueError('Weather mod was not enabled for this question.')
        r['weather'] = weather.resolve(d, body['weather'])
    reference_ids = body.get('referenced_item_ids', [])
    if r.get('findmy', {}).get('status') == 'found':
        reference_ids = list(dict.fromkeys(reference_ids+[r['findmy']['item_id']])) if isinstance(reference_ids, list) else reference_ids
    r['referenced_entities'] = conversation_context.validate_references(d, reference_ids)
    if part:
        r['part'] = part
        r['layout_slot'] = 1 if part == 'text' and body.get('layout_slot') == 1 else 0
        r['latency'] = round(r['created']-q.get('started', r['created']), 2)
        q.setdefault('parts', {})[part] = dict(response=r['id'], latency=r['latency'])
    c['responses'].append(r)
    # Real seconds from the agent starting on the question to its answer being shown.
    if q:
        q.update(response=r['id'], latency=round(r['created']-q.get('started', r['created']), 2))
        if not part: q['status'] = 'answered'
    else: _link_orphans(d, c)
    _write(d, c); lock.notify_all(); return r

def _fail_stream(r, q):
    now = time.time(); stream = r['stream']
    stream.update(seq=stream['seq']+1, status='failed')
    q.get('parts', {}).get('text', {})['status'] = 'failed'
    r.update(title='Answer unavailable', body='Please try again.', anchor=None, referenced_entities=[])
    stream['updates'].append(dict(seq=stream['seq'], status='failed', at=round(now-q.get('started', now), 3), created=now,
                                  title=r['title'], body=r['body'], anchor=None, referenced_entities=[]))

def _add_stream(d, c, q, body):
    stream = body['stream']
    if not isinstance(stream, dict) or type(stream.get('seq')) is not int or stream['seq'] < 1 or stream.get('status') not in ('streaming', 'complete', 'failed'):
        raise ValueError('Bad text stream update.')
    r = next((r for r in c['responses'] if r.get('question_id') == q['id'] and r.get('part') == 'text'), None)
    if r:
        previous = r.get('stream')
        if not previous: raise ValueError('Text response already completed.')
        if stream['seq'] <= previous['seq']: return r  # retries/out-of-order deliveries cannot roll text back
        if previous['status'] != 'streaming': raise ValueError('Text stream already ended.')
        if len(previous['updates']) >= 256: raise ValueError('Too many text stream updates.')
    if q['status'] != 'running': raise ValueError('Question is no longer running.')
    title, text = body.get('title', ''), body.get('body', '')
    if not isinstance(title, str) or not isinstance(text, str) or len(title) > 512 or len(text) > 4096 or body.get('items'):
        raise ValueError('Bad streaming text.')
    if stream['status'] != 'complete' and (body.get('anchor') is not None or body.get('referenced_item_ids')):
        raise ValueError('Partial text cannot supply anchors or item references.')
    anchor = body.get('anchor') if stream['status'] == 'complete' else None
    refs = conversation_context.validate_references(d, body.get('referenced_item_ids', [])) if stream['status'] == 'complete' else []
    now = time.time(); at = max(0, round(now-q.get('started', now), 3))
    if not r:
        r = dict(id=max((r['id'] for r in c['responses']), default=0)+1, created=now, frame=q['frame'], t=q['t'],
                 question=q['text'], question_id=q['id'], part='text', layout_slot=1 if body.get('layout_slot') == 1 else 0,
                 latency=at, stream=dict(updates=[]))
        c['responses'].append(r)
        q.setdefault('parts', {})['text'] = dict(response=r['id'], latency=at)
    r.update(title=title, body=text, items=[], anchor=anchor, referenced_entities=refs, reserve_text=True)
    if body.get('info') is not None: r['info'] = response_info(c, q, body['info'])
    r['stream'].update(seq=stream['seq'], status=stream['status'])
    q['parts']['text']['status'] = stream['status']
    r['stream']['updates'].append(dict(seq=stream['seq'], status=stream['status'], at=at, created=now, title=title, body=text, anchor=anchor, referenced_entities=refs))
    q.update(response=r['id'], latency=at)
    _write(d, c); lock.notify_all(); return r

def status(d, cid):
    c = read(d, cid); busy = running_question(d)[1] is not None
    # A text answer of an info question published without its item (an older bridge) still gets it from the question.
    questions = {q['id']: q for q in c['questions']}
    responses = [dict(r, info=response_info(c, questions[r['question_id']], dict(key=questions[r['question_id']]['info']['key'])))
                 if r.get('part') == 'text' and not r.get('info') and questions.get(r.get('question_id'), {}).get('info') else r for r in c['responses']]
    return dict(connected=busy or time.time()-bridge_seen.get(str(d), 0) < 40, questions=c['questions'], responses=responses)
