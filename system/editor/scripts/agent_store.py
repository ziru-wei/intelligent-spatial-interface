"""Agent conversations for one scene (the UI calls them sessions): spaces/<space>/scenarios/<take>/agent/<id>.json, each holding its own questions
and responses, so a new conversation starts with an empty timeline. A conversation is named for its first question's first words and its
time ("What's the weather… · 11-24 17:12"), kept up to date, unless the user named it (`named`). Its time is when it was made, or last
when a question in it was replaced by one asked again (`updated`). A Gallery example is some of its questions, tagged in place
(`gallery` = {name, mod}, scripts/gallery.py); the conversation then shows a star. A question answered again from the same input (a
Rerun, a replay, a Gallery example asked again) keeps every answer as its replay history (scripts/versions.py): the conversation then
shows the rerun icon, and the version shown is the pinned one, else the newest. Question ids are unique across a scene's conversations because
the agent only echoes the number back. All access goes through `lock`; the bridge long-polls on it."""
import json, re, threading, time
from pathlib import Path
import weather, findmy, conversation_context, modos_parts, versions, reset_space

UI_KINDS = ('weather', 'findmy', 'highlight', 'control', 'action')   # one of them per ui part
from datetime import datetime

lock = threading.Condition()
editor_state, bridge_seen, recovered, viewing = {}, {}, set(), {}   # viewing: {(scene, conversation): {root: version looked at in the history}}
ID = re.compile(r'^\d{8}-\d{6}(-\d+)?$')
STUCK_S = 300

def folder(d): return d/'agent'
def _path(d, cid):
    p = folder(d)/f'{cid}.json'
    if not ID.match(str(cid or '')) or not p.is_file(): raise ValueError('Unknown session: '+str(cid))
    return p
def read(d, cid): return json.loads(_path(d, cid).read_text())
def when(c): return c.get('updated') or c['created']
def auto_name(c):
    """The first question's first words (about 24 letters, whole words) and the conversation's time."""
    first = next((q['text'] for q in c['questions'] if str(q.get('text') or '').strip()), '')
    words, short = [], False
    for w in first.split():
        if words and len(' '.join(words+[w])) > 24: short = True; break
        words.append(w)
    head = ' '.join(words).rstrip(',.;:?!')+('…' if short else '')
    stamp = datetime.fromtimestamp(when(c)).strftime('%m-%d %H:%M')
    return f'{head} · {stamp}' if head else stamp
def _write(d, c):
    if not c.get('named'): c['name'] = auto_name(c)
    folder(d).mkdir(exist_ok=True); (folder(d)/f"{c['id']}.json").write_text(json.dumps(c, indent=2, ensure_ascii=False))
def _all(d): return [json.loads(p.read_text()) for p in sorted(folder(d).glob('*.json'))] if folder(d).is_dir() else []

def _prepare(d):
    """Once per scene per server run: move the single-file answers of earlier versions into a conversation, and fail questions
    that were mid-answer when the server stopped."""
    if str(d) in recovered: return
    recovered.add(str(d)); legacy = d/'agent-responses.json'
    if legacy.is_file():
        items = json.loads(legacy.read_text())
        if items: create(d, responses=items)
        legacy.unlink()
    for c in _all(d):
        stale = [q for q in c['questions'] if q['status'] in ('running', 'queued')]
        for q in stale:
            q.update(status='failed', message='Interrupted: the editor server restarted.')
            for r in c['responses']:
                if r.get('question_id') == q['id'] and r.get('stream', {}).get('status') == 'streaming': _fail_stream(r, q)
        linked = _link_orphans(d, c)
        if stale or linked: _write(d, c)
    unnamed = sorted(((q.get('created', 0), c['id'], q['id']) for c in _all(d) for q in c['questions'] if not q.get('label')), key=lambda x: x[:1])
    for created, cid, qid in unnamed:
        c = read(d, cid); q = next(x for x in c['questions'] if x['id'] == qid); q['label'] = _label(d, created or time.time()); _write(d, c)

def _link_orphans(d, c):
    """Answers without a question (earlier versions, or asked in the terminal) get one, so every answer has a timeline marker."""
    known = {q['id'] for q in c['questions']}
    orphans = [r for r in c['responses'] if r.get('question_id') not in known]
    first = _next_qid(d)
    for i, r in enumerate(orphans):
        q = dict(id=first+i, label=_label(d, r.get('created', time.time())), text=r.get('question') or r.get('title') or '(asked in the terminal)', frame=r.get('frame', 0), t=r.get('t', 0),
            status='answered', response=r['id'], created=r.get('created', time.time()))
        c['questions'].append(q); r['question_id'] = q['id']
    return bool(orphans)

def create(d, name=None, questions=(), responses=(), gallery_example=None):
    """A new conversation, named for its first question unless a name is given (then it is the user's). gallery_example = {name, mod}
    (scripts/gallery.py clean_tag): a Gallery example being asked again (demos/gallery.mjs); once answered, its questions take the
    example's place in the conversation that holds it (gallery.replace)."""
    now = datetime.now(); cid = f"{now:%Y%m%d-%H%M%S}-{time.time_ns()}"; n = 1
    while (folder(d)/f'{cid}.json').exists(): cid = f"{now:%Y%m%d-%H%M%S}-{n}"; n += 1
    c = dict(id=cid, name='', created=time.time(), questions=list(questions), responses=list(responses))
    if str(name or '').strip(): c.update(name=str(name).strip()[:80], named=True)
    if gallery_example: c['gallery_example'] = gallery_example
    _write(d, c); return c

def listing(d):
    _prepare(d)
    return sorted((dict(id=c['id'], name=c['name'], created=when(c), questions=len(c['questions']), responses=len(c['responses']), starred=any(q.get('gallery') for q in c['questions']), rerun=any(q.get('replay_of') for q in c['questions']),
        **({'gallery_example': c['gallery_example']} if c.get('gallery_example') else {})) for c in _all(d)), key=lambda c: c['created'])

def rename(d, cid, name):
    c = read(d, cid); name = str(name or '').strip()[:80]
    if not name: raise ValueError('Empty name.')
    c.update(name=name, named=True); _write(d, c); return c

def import_conversation(d, data):
    """A new conversation from an exported one; question ids are renumbered for this scene and answers keep their links."""
    if not isinstance(data, dict) or not isinstance(data.get('questions', []), list) or not isinstance(data.get('responses', []), list): raise ValueError('Not an exported session.')
    first = _next_qid(d); ids = {}
    questions = []
    for i, q in enumerate(data.get('questions', [])):
        ids[q.get('id')] = first+i
        questions.append(dict(q, id=first+i, label=_label(d, q.get('created') or time.time()), status=q.get('status') if q.get('status') in ('answered', 'failed') else 'failed'))
    responses = [dict(r, id=i+1, question_id=ids.get(r.get('question_id'))) for i, r in enumerate(data.get('responses', []))]
    return create(d, data.get('name') if data.get('named') else None, questions, responses)

def _label(d, ts):
    """q-MMDD-N: a question's name for people, its number among the questions made that day (local time) in this scene. Never given
    again: the day's last number is kept apart (`.question-labels`), so a deleted question's name is not reused."""
    day = datetime.fromtimestamp(ts).strftime('%m%d'); hw = folder(d)/'.question-labels'
    kept = json.loads(hw.read_text()) if hw.is_file() else {}
    used = [int(str(q['label']).rsplit('-', 1)[1]) for c in _all(d) for q in c['questions'] if str(q.get('label', '')).startswith(f'q-{day}-')]
    n = max([kept.get(day, 0), *used])+1; kept[day] = n; hw.write_text(json.dumps(kept))
    return f'q-{day}-{n}'

def _next_qid(d):
    counter = folder(d)/'.question-high-water'
    floor = int(counter.read_text()) if counter.is_file() else 0
    return max(floor, max((q['id'] for c in _all(d) for q in c['questions']), default=0))+1

def delete_conversation(d, cid):
    p = _path(d, cid); recordings = [q.get('audio', {}).get('file') for q in read(d, cid)['questions']] if p.is_file() else []
    # Never reuse deleted question ids: a bridge may still return an old answer.
    (folder(d)/'.question-high-water').write_text(str(_next_qid(d)-1))
    p.unlink(); _drop_audio(d, recordings)
    remaining = _all(d)
    next_session = max(remaining, key=when) if remaining else create(d)
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

def _state(d):
    """The space's devices and mock outbox as a question is asked (its input, like its recording): a replay starts from it again."""
    space = Path(d).parent.parent
    return reset_space.snapshot(space) if (space/'modos').is_dir() else None

replay_live = {}   # {space: its state before a replay began}: put back once the replay is joined to its question, or given up
def start_replay(d, cid, of):
    """Before a question is answered again (replay-audio, -text, -text-batch): the space as it was when the question was asked (its
    `state`; a question asked before states were kept: the initial state), the state it had now kept to be put back after."""
    space = Path(d).parent.parent; c = read(d, cid) if cid else dict(questions=[])
    q = next((x for x in c['questions'] if str(x['id']) == str(of)), None) if of is not None else None
    root = next((x for x in c['questions'] if q and x['id'] == versions.root_id(q)), None)
    replay_live.setdefault(str(space), reset_space.snapshot(space))
    reset_space.restore(space, (root or {}).get('state')); lock.notify_all(); return dict(ok=True, state=bool((root or {}).get('state')))

def end_replay(d):
    """A replay joined or given up: the space as it was before it began."""
    space = Path(d).parent.parent; live = replay_live.pop(str(space), None)
    if live is not None: reset_space.restore(space, live)
    lock.notify_all(); return dict(ok=True)

def ask(d, cid, frame, t, text, live=None, selection=None, pose=None, location=None):
    """live = {read_s}: asked in the editor, which held the video on the question's frame while the agent answered and for `read_s`
    real seconds after the answer appeared; replays hold the same way, using the measured latency."""
    c = read(d, cid)
    now = time.time(); q = dict(id=_next_qid(d), label=_label(d, now), text=text[:500], frame=frame, t=t, status='queued', created=now)
    if isinstance(live, dict):
        read_s = float(live.get('read_s', 5))
        if not 0 <= read_s <= 30: raise ValueError('Bad live timing.')
        q['live'] = dict(read_s=read_s)
    if selection: q['selection'] = selection   # an information box the user looked at, pointed at or touched (scripts/info_context.py selection)
    if pose: q['pose'] = pose   # asked live on a headset (a live session, no recording): the user's head pose then, in scene coordinates
    if location: q['location'] = location   # the zone the user is in and one they face (scripts/location.py)
    q['state'] = _state(d)
    c['questions'].append(q); _write(d, c); lock.notify_all(); return dict(q, conversation=cid)

FILLERS = {'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'hm', 'mm', 'ah', 'eh'}
def normalize(text):
    """A question's words as the pipeline reads them (modos/themes.mjs normalize: the same): case, punctuation, spacing and fillers
    dropped, every other word kept."""
    return ' '.join(w for w in re.sub(r'[^\w]+|_', ' ', str(text).lower()).split() if w not in FILLERS)

def draft(d, cid, qid, frame, t, text, pause=False, selection=None, pose=None, location=None):
    """Answer while typing (modos-system-design.md 12): the question as typed so far. The first revision makes a question with status
    `drafting`; each later one replaces its text, frame and what the user looks at, and is kept in `revisions` (when, the text, whether
    the user paused) so a replay can type it again. The bridge answers the newest revision each time it is free."""
    c = read(d, cid); now = time.time(); text = str(text or '')[:500]
    q = next((x for x in c['questions'] if str(x['id']) == str(qid)), None) if qid is not None else None
    if qid is not None and not q: raise ValueError('Unknown question.')
    if q is None:
        q = dict(id=_next_qid(d), label=_label(d, now), text=text, frame=frame, t=t, status='drafting', created=now, rev=0, revisions=[], state=_state(d))
        c['questions'].append(q)
    elif q['status'] != 'drafting': raise ValueError('That question was already asked.')
    # the same words (a second pass that only punctuated them, a filler dropped): shown and kept, nothing computed again, unless it is
    # the first pause since they were computed (a pause writes the text)
    elif normalize(text) == normalize(q['text']) and not (pause and not q['revisions'][-1].get('pause')):
        q['text'] = text
        if len(q['revisions']) < 200: q['revisions'].append(dict(rev=q['rev'], text=text, at=round(now-q['created'], 3), t=t, frame=frame, pause=bool(pause), same=True))
        _write(d, c); return dict(q, conversation=cid)
    q['rev'] += 1; q.update(text=text, frame=frame, t=t)   # the question's moment is its latest revision's; typing began at revisions[0]
    for k, v in (('selection', selection), ('pose', pose), ('location', location)):
        if v: q[k] = v
        else: q.pop(k, None)
    if len(q['revisions']) < 200: q['revisions'].append(dict(rev=q['rev'], text=text, at=round(now-q['created'], 3), t=t, frame=frame, pause=bool(pause)))
    _write(d, c); lock.notify_all(); return dict(q, conversation=cid)

def finalize(d, cid, qid, text, live=None):
    """Enter on a draft: the question is asked as typed, and answered once more in full (its parts reconciled, its text written)."""
    c = read(d, cid); q = next((x for x in c['questions'] if str(x['id']) == str(qid)), None)
    if not q or q['status'] != 'drafting': raise ValueError('No draft to ask.')
    q['rev'] += 1; q.update(text=str(text or q['text'])[:500], status='queued', asked=time.time())
    q['revisions'].append(dict(rev=q['rev'], text=q['text'], at=round(time.time()-q['created'], 3), t=q['t'], frame=q['frame'], final=True))
    if isinstance(live, dict): q['live'] = dict(read_s=float(live.get('read_s', 5)))
    _write(d, c); lock.notify_all(); return dict(q, conversation=cid)

def revision(d, qid):
    """What the bridge checks while it works on a draft: the latest revision and the status (a newer revision makes its work stale)."""
    c, q = _find_question(d, qid)
    return dict(rev=q.get('rev', 0), status=q['status']) if q else dict(rev=-1, status='gone')

def _new_run(q):
    """A typed question taken again (its next revision, or asked): the trace of the run before is kept with the revision it answered
    and when that run began (`at`, s since the question began), so a replay shows the pipeline as it went; the new run starts empty."""
    if q.get('trace') or q.get('run_at') is not None:
        runs = q.setdefault('traces', [])
        if len(runs) < 200: runs.append(dict(rev=q.get('taken_rev', 0), at=q.get('run_at', 0), steps=q.get('trace', [])))
    q['trace'] = []; q['run_at'] = round(time.time()-q['created'], 3)

RECOMPUTE_S = 1.6   # a draft is answered again at most this often: the newest revision when the time comes (words said meanwhile wait)

def _draft_wait(q):
    """Seconds until a draft may be answered again (its last run began less than RECOMPUTE_S ago)."""
    return 0 if q.get('run_at') is None else q['created']+q['run_at']+RECOMPUTE_S-time.time()

def next_draft_in(d):
    """Seconds until a waiting revision may be taken (None: none waits)."""
    waits = [_draft_wait(q) for c in _all(d) for q in c['questions'] if q['status'] == 'drafting' and q.get('rev', 0) > q.get('taken_rev', 0)]
    return max(0, min(waits)) if waits else None

def take_next(d):
    """Oldest queued question in any of the scene's conversations, marked running; None if there is none.
    A question still running well past the bridge's 4-minute turn limit was interrupted (bridge stopped mid-answer). Several bridges
    may serve one scene, so a question another bridge is answering right now is left alone."""
    for c in _all(d):
        stuck = [q for q in c['questions'] if q['status'] == 'running' and time.time()-q.get('started', 0) > STUCK_S]
        for q in stuck: q.update(status='failed', message='Interrupted: the agent stopped before answering.')
        if stuck: _write(d, c)
    drafts = [(q['created'], c, q) for c in _all(d) for q in c['questions'] if q['status'] == 'drafting' and q.get('rev', 0) > q.get('taken_rev', 0) and _draft_wait(q) <= 0]
    if drafts:
        _, c, q = min(drafts, key=lambda x: x[0]); _new_run(q); q.update(taken_rev=q['rev'], started=q.get('started') or time.time()); _write(d, c)
        return dict(q, conversation=c['id'], n=c['questions'].index(q)+1)
    queued = [(q['created'], c, q) for c in _all(d) for q in c['questions'] if q['status'] == 'queued']
    if not queued: return None
    _, c, q = min(queued, key=lambda x: x[0]); q.update(status='running', started=time.time())
    if q.get('revisions'): _new_run(q); q.update(taken_rev=q['rev'])   # a draft asked: answered again, from its parts so far
    _write(d, c)
    return dict(q, conversation=c['id'], n=c['questions'].index(q)+1)   # n: its number in the conversation (themes cool by it)

def set_info(d, qid, info_key, interaction_id=None, source=None):
    """The info key a question was answered with (modos/text.mjs) and the language model's interaction id, so a
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
    # the run's decision record (modos/decisions.mjs) is the pipeline's raw data: kept whole, and always (one per run)
    record = step.get('tool') == 'decisions'
    if len(trace) < 60 or record:
        trace.append(dict(kind=str(step.get('kind') or 'message')[:16], tool=str(step.get('tool') or '')[:60] or None,
            text=str(step.get('text') or '')[:40000 if record else 2000], at=int(step.get('at') or 0)))
        _write(d, c)
    return dict(ok=True)

def set_audio(d, qid, data, started_ms, video_t=None, video_at_ms=None, video_end_t=None, video_end_at_ms=None, video_rate=None, asr=None):
    """A spoken question's recording (what the microphone heard, a 16 kHz WAV), kept beside its conversations (agent/audio/<id>.wav,
    in the space: local, never committed) with when it began against the question (`at`, s since the question began), so a replay
    plays it in step and can recognize it again. video_t, video_at_ms: the video's time when Space went down, and when that was (a
    replay moves the video from there instead of waiting on the first revision); video_end_*: the same when Space was let go, and video_rate:
    how the video went on from there (its playback speed; 0 paused). The question's line on the timeline runs from the one to the other.
    asr: how speech to text heard it ({split: silence|meaning, fillers: kept|removed}, src/ui-settings.mjs speechOptions)."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if not (data[:4] == b'RIFF' and data[8:12] == b'WAVE') or len(data) > 40_000_000: raise ValueError('The recording must be a WAV.')
    folder(d).joinpath('audio').mkdir(exist_ok=True); name = f'audio/{q["id"]}.wav'; folder(d).joinpath(name).write_bytes(data)
    rate = int.from_bytes(data[28:32], 'little') or 32000   # bytes a second (the WAV header's byte rate)
    q['audio'] = dict(file='agent/'+name, at=round(started_ms/1000-q['created'], 3), duration=round(max(0, len(data)-44)/rate, 3),
                      **(dict(video=dict(t=round(float(video_t), 3), at=round(float(video_at_ms)/1000-q['created'], 3),
                          **(dict(t_end=round(float(video_end_t), 3), at_end=round(float(video_end_at_ms)/1000-q['created'], 3), rate=float(video_rate or 0)) if video_end_t is not None and video_end_at_ms is not None else {})))
                         if video_t is not None and video_at_ms is not None else {}),
                      **({'asr': {k: str(v) for k, v in asr.items() if k in ('split', 'fillers')}} if asr else {}))
    _write(d, c); lock.notify_all()
    return dict(q['audio'])

def runs(d, qid):
    """A typed question's runs, one per revision answered: {rev, at, steps}, the last one the run now kept as its trace."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    # typed before runs were kept: its one trace is the last run, from when it was asked
    at = q['run_at'] if q.get('run_at') is not None else round(q['asked']-q['created'], 3) if q.get('asked') else 0
    return dict(runs=q.get('traces', [])+([dict(rev=q.get('taken_rev', 0), at=at, steps=q.get('trace', []))] if q.get('run_at') is not None or q.get('trace') else []))

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

def _drop_audio(d, gone):
    """Recordings no question refers to any more (a question or conversation deleted; a Gallery copy may still refer to one)."""
    used = {q.get('audio', {}).get('file') for c in _all(d) for q in c['questions']}
    for f in gone:
        if f and f not in used: (Path(d)/f).unlink(missing_ok=True)

def delete_question(d, cid, qid, whole=False):
    """A question deleted (whole: with every version of its replay history), or one version of its history: the original's goes and the
    oldest version left takes its place as the question (its recording, its Gallery tag and the version pinned passed on)."""
    c = read(d, cid); q = next((q for q in c['questions'] if str(q['id']) == str(qid)), None)
    if not q: raise ValueError('Unknown question.')
    group = versions.groups(c['questions']).get(versions.root_id(q), [q])
    gone = group if whole else [q]
    if any(x['status'] == 'running' for x in gone): raise ValueError('The agent is answering this question right now.')
    root = next((x for x in group if not x.get('replay_of')), q)
    left = [x for x in group if x not in gone]
    if left and q is root:   # the original goes: the oldest version left is the question now
        heir = left[0]; heir.pop('replay_of', None)
        for k in ('audio', 'gallery', 'pinned'):
            if root.get(k) is not None and heir.get(k) is None: heir[k] = root[k]
        for x in left[1:]: x['replay_of'] = heir['id']
    for x in left:
        if x.get('pinned') in {g['id'] for g in gone}: x.pop('pinned')
    # Never reuse their ids (a recording is named by one, and a bridge may still return an old answer): the high-water mark passes them.
    hw = folder(d)/'.question-high-water'; hw.write_text(str(max([int(hw.read_text()) if hw.is_file() else 0]+[int(x['id']) for x in gone])))
    ids = {str(x['id']) for x in gone}
    c['questions'] = [x for x in c['questions'] if str(x['id']) not in ids]; c['responses'] = [r for r in c['responses'] if str(r.get('question_id')) not in ids]
    if c.get('themes'): c['themes'] = _book_of(c)
    viewing.get((str(d), cid), {}).pop(root['id'], None)
    _write(d, c); _drop_audio(d, [x.get('audio', {}).get('file') for x in gone]); lock.notify_all(); return dict(ok=True)

def replay_question(d, cid, of, new, how='replay-audio'):
    """An answered question made again from the question `of`'s input (how: 'replay-audio', 'replay-text', 'replay-text-batch';
    scripts/versions.py) joins its replay history as
    its newest version (shown unless another is pinned); the conversation's time is now."""
    add_versions(d, cid, cid, [new], [of], how); return dict(ok=True)

def add_versions(d, src, dst, ids, of, how):
    """Questions `ids` of conversation src (answered) become versions of dst's questions `of` (ids[i] of of[i], the rest of the last),
    with their answers and themes; answer and theme ids are given anew in dst. src goes once it has no question left."""
    a = read(d, src); b = a if dst == src else read(d, dst)
    moving = [q for q in a['questions'] if q['id'] in ids]
    if len(moving) != len(ids): raise ValueError('Unknown question.')
    if any(q['status'] != 'answered' for q in moving): raise ValueError('Only an answered question joins a replay history.')
    by = {q['id']: q for q in b['questions']}
    roots = [versions.root_id(by[o]) if o in by else None for o in of]
    if not roots or None in roots: raise ValueError('Unknown question.')
    if dst != src:
        a['questions'] = [q for q in a['questions'] if q['id'] not in ids]
        answers = [r for r in a['responses'] if r.get('question_id') in ids]; a['responses'] = [r for r in a['responses'] if r.get('question_id') not in ids]
        book = a.get('themes') if isinstance(a.get('themes'), dict) else {}
        themes = [t for t in book.get('themes', []) if any(x.get('q') in ids for x in t.get('sentences', []))]
        if a.get('themes'): a['themes'] = _book_of(a)
        start = max([r['id'] for r in b['responses']]+[b.get('retired_id', 0)])+1; rid = {}
        for k, r in enumerate(answers): rid[r['id']] = start+k; r['id'] = start+k
        for q in moving:
            if q.get('response') in rid: q['response'] = rid[q['response']]
        b['responses'] += answers
        if themes:
            bb = b['themes'] if isinstance(b.get('themes'), dict) else dict(next=1, asked=0, themes=[])
            tid = {}
            for t in themes: tid[t['id']] = bb['next']; bb['next'] += 1
            bb['themes'] = bb['themes']+[dict(t, id=tid[t['id']], sentences=[x for x in t['sentences'] if x.get('q') in ids]) for t in themes]
            for r in answers:
                if isinstance(r.get('theme'), dict): r['theme'] = dict(r['theme'], ids=[tid.get(x, x) for x in r['theme'].get('ids', [])])
            b['themes'] = bb
        b['questions'] += moving
    for i, q in enumerate(sorted(moving, key=lambda q: ids.index(q['id']))):
        root = roots[min(i, len(roots)-1)]; q['replay_of'] = root; q['how'] = how; q.pop('gallery', None); q.pop('state', None)   # the state is the question's input
        viewing.get((str(d), dst), {}).pop(root, None)
    b['updated'] = time.time(); _write(d, b)
    if dst != src:
        if a['questions']: _write(d, a)
        else: _path(d, src).unlink()
    lock.notify_all()
    return b

def pin(d, cid, qid):
    """A version pinned as its question's best answer (shown, and in the Gallery), or unpinned when it was (the newest is shown again)."""
    c = read(d, cid); q = next((x for x in c['questions'] if str(x['id']) == str(qid)), None)
    if not q: raise ValueError('Unknown question.')
    root = next(x for x in c['questions'] if x['id'] == versions.root_id(q))
    if root.get('pinned') == q['id']: root.pop('pinned')
    else: root['pinned'] = q['id']
    _write(d, c); lock.notify_all(); return dict(pinned=root.get('pinned'))

def view(d, cid, qid=None, root=None):
    """The version looked at in the history panel, shown meanwhile (not kept: no version is pinned by looking); qid None: none."""
    v = viewing.setdefault((str(d), cid), {})
    if qid is None and root is None: v.clear()   # none looked at (the editor opening the conversation)
    elif qid is None: v.pop(root, None)
    else:
        c = read(d, cid); q = next((x for x in c['questions'] if str(x['id']) == str(qid)), None)
        if not q: raise ValueError('Unknown question.')
        v[versions.root_id(q)] = q['id']
    lock.notify_all(); return dict(ok=True)

def _book_of(c):
    """The theme book with only what the conversation's questions said: a deleted question's sentences leave its themes, and a theme
    left with none goes (a Rerun's question otherwise joins the themes of the one it replaced)."""
    book = c.get('themes')
    if not isinstance(book, dict) or not isinstance(book.get('themes'), list): return book
    ids = {str(q['id']) for q in c['questions']}
    kept = [{**t, 'sentences': [s for s in t.get('sentences', []) if str(s.get('q')) in ids]} for t in book['themes']]
    return {**book, 'themes': [t for t in kept if t['sentences']]}

def _mod_meta(m):
    """Which MOD, variant and slot made a part, with the slot's settled settings (shown and logged; renderers read it later)."""
    if not isinstance(m, dict) or not isinstance(m.get('id'), str): raise ValueError('Bad mod metadata.')
    settings = m.get('settings') or {}
    if not isinstance(settings, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in settings.items()): raise ValueError('Bad mod settings.')
    out = dict(id=m['id'][:48], variant=str(m.get('variant') or '')[:32] or None, slot=str(m.get('slot') or '')[:32] or None,
               settings={k[:32]: v[:32] for k, v in list(settings.items())[:8]})
    # What the MOD declared its slots draw (modos/ui-rules.mjs) and the facts known when composing; the renderer decides the rest.
    ui, facts = m.get('ui') or {}, m.get('facts') or {}
    if not (isinstance(ui, dict) and len(ui) <= 4 and isinstance(facts, dict) and len(facts) <= 12): raise ValueError('Bad mod ui.')
    for sid, s in ui.items():
        u = s.get('ui') if isinstance(s, dict) else None
        if not (isinstance(u, dict) and all(isinstance(p, str) for p in u.get('fixed', [])) and
                all(isinstance(f, dict) and isinstance(f.get('cue'), str) for f in u.get('flexible', []))): raise ValueError('Bad mod ui.')
    if not all(isinstance(k, str) and isinstance(v, (str, int, float, bool)) for k, v in facts.items()): raise ValueError('Bad mod facts.')
    if ui: out['ui'] = {sid[:32]: dict(use=str(s.get('use') or '')[:32], ui=dict(fixed=[p[:48] for p in s['ui'].get('fixed', [])][:8],
        flexible=[{k: str(f[k])[:120] for k in ('cue', 'when', 'instead_of') if f.get(k)} for f in s['ui'].get('flexible', [])][:12])) for sid, s in ui.items()}
    if facts: out['facts'] = {k[:40]: v for k, v in facts.items()}
    return out

def add_response(d, body):
    if not (body.get('title') or body.get('body') or body.get('items') or (body.get('part') == 'ui' and any(body.get(k) for k in UI_KINDS)) or (body.get('part') == 'animation' and body.get('animation'))): raise ValueError('A response needs a title, body or items.')
    c, q = _find_question(d, body.get('question_id')) if body.get('question_id') is not None else (None, None)
    if body.get('question_id') is not None and not q: raise ValueError('Unknown question.')
    part = body.get('part')
    if part not in (None, 'ui', 'text', 'animation'): raise ValueError('Unknown response part.')
    if q and body.get('rev') is not None and body['rev'] < q.get('taken_rev', 0): raise Stale('A newer revision of the question is being answered.')
    if part and not q: raise ValueError('Response parts need a question_id.')
    if body.get('stream') is not None:
        if part != 'text' or any(body.get(k) is not None for k in UI_KINDS): raise ValueError('Only text parts can stream.')
        return _add_stream(d, c, q, body)
    # A part is one per kind and MOD on its question's surface (part_key). Posted again, it is the same part with new data: it keeps
    # its id (what is drawn for it is updated in place, src/spatial-ui/cue-set.mjs) and the version before is kept (_withdraw).
    mod_of = lambda r: next((k for k in UI_KINDS if r.get(k) is not None), None)
    old = next((r for r in c['responses'] if r.get('question_id') == q['id'] and part_key(r) == part_key(body)), None) if part else None
    if part == 'ui' and (body.get('title') or body.get('body') or body.get('items')): raise ValueError('UI part cannot contain language text.')
    if part == 'text' and any(body.get(k) is not None for k in UI_KINDS): raise ValueError('Text part cannot contain mod UI.')
    if q: at = q
    else:
        # Asked in the terminal: the conversation and frame the editor shows.
        at = editor_state.get(str(d)) or {}
        convs = _all(d); c = next((x for x in convs if x['id'] == at.get('conversation')), None) or (max(convs, key=lambda x: x['created']) if convs else create(d))
    r = dict(id=max([r['id'] for r in c['responses']]+[c.get('retired_id', 0)])+1, created=time.time(), frame=at.get('frame', 0), t=at.get('t', 0),
        question=q['text'] if q else str(body.get('question') or ''), question_id=q['id'] if q else None, title=str(body.get('title') or ''),
        body=str(body.get('body') or ''), items=[str(i) for i in body.get('items') or []][:12], anchor=body.get('anchor') or None)
    if body.get('reserve_text') is True: r['reserve_text'] = True
    if body.get('mod') is not None: r['mod'] = _mod_meta(body['mod'])
    # the theme(s) the part shows and whether one is the user's focus (modos/themes.mjs): a fact its MOD's UI rules may read
    if isinstance(body.get('theme'), dict): r['theme'] = dict(ids=[int(x) for x in body['theme'].get('ids') or [] if isinstance(x, int)][:6], focus=bool(body['theme'].get('focus')))
    # A zone's animation (LabInfo's diorama), played on the headset beside the text.
    if part == 'animation':
        a = body.get('animation')
        if not (isinstance(a, dict) and isinstance(a.get('id'), str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', a['id'])): raise ValueError('Bad animation.')
        r['animation'] = dict(id=a['id'], zone=str(a.get('zone') or '')[:64])
    elif body.get('animation') is not None: raise ValueError('Only an animation part carries an animation.')
    if body.get('info') is not None:
        if part != 'text' or not q: raise ValueError('Only a text part of a question can carry info.')
        r['info'] = response_info(c, q, body['info'])
    if part == 'text' and isinstance(body.get('text_ui'), dict): r['text_ui'] = _text_ui(body['text_ui'])
    if part == 'text' and isinstance(body.get('text_mod'), dict): r['text_mod'] = _text_mod(body['text_mod'])
    if body.get('dialogue') is not None:
        if part != 'text': raise ValueError('Only a text part carries dialogue.')
        r['dialogue'] = _dialogue(body['dialogue'])
    if sum(body.get(k) is not None for k in UI_KINDS) > 1: raise ValueError('Only one mod per response.')
    # ModOS parts that point at things of the twin (scripts/modos_parts.py): a highlight (ObjectStatus, Wayfinding, IoTControl's device)
    # and a device's controls (IoTControl, which applies the asked action).
    if body.get('highlight') is not None:
        if not (Path(d).parent.parent/'modos').is_dir(): raise ValueError('Highlight parts need ModOS.')
        r['highlight'] = modos_parts.resolve_highlight(d, body['highlight'], at.get('frame', 0))
    if body.get('action') is not None:
        if not (Path(d).parent.parent/'modos').is_dir(): raise ValueError('Action parts need ModOS.')
        r['action'] = modos_parts.resolve_action(d, body['action'])
    if body.get('control') is not None:
        if not (Path(d).parent.parent/'modos').is_dir(): raise ValueError('Control parts need ModOS.')
        r['control'] = modos_parts.resolve_control(d, body['control'], preview=q is not None and q['status'] == 'drafting')   # typed, not asked: nothing done yet
    if body.get('findmy') is not None:
        r['findmy'] = findmy.resolve(d,body['findmy'])
    if body.get('weather') is not None:
        r['weather'] = weather.resolve(d, body['weather'])
    reference_ids = body.get('referenced_item_ids', [])
    if r.get('findmy', {}).get('status') == 'found':
        reference_ids = list(dict.fromkeys(reference_ids+[r['findmy']['item_id']])) if isinstance(reference_ids, list) else reference_ids
    r['referenced_entities'] = conversation_context.validate_references(d, reference_ids)
    if part:
        r['part'] = part
        r['layout_slot'] = 1 if part == 'text' and body.get('layout_slot') == 1 else 0
        r['latency'] = round(r['created']-q.get('started', r['created']), 2)
        q.setdefault('parts', {}).setdefault(part, dict(response=r['id'], latency=r['latency']))
        # ModOS: several MODs can each add a ui part; their own arrival times are kept apart from the per-kind `parts`.
        if part == 'ui' and mod_of(r): q.setdefault('mod_parts', {})[mod_of(r)] = dict(response=r['id'], latency=r['latency'])
    if part: r['key'] = part_key(r)
    if old:
        volatile = ('id', 'created', 'updated_at', 'latency', 'question', 'frame', 't')   # the question's own fields, not the part's data
        if {k: v for k, v in r.items() if k not in volatile} == {k: v for k, v in old.items() if k not in volatile}: return old   # nothing new
        r.update(id=old['id'], created=old['created'], latency=old.get('latency', r.get('latency')), updated_at=round(time.time(), 3))
        c['responses'].remove(old); _withdraw(q, old)
    c['responses'].append(r)
    # Real seconds from the agent starting on the question to its answer being shown.
    if q:
        q.update(response=r['id'], latency=round(r['created']-q.get('started', r['created']), 2))
        if not part: q['status'] = 'answered'
    else: _link_orphans(d, c)
    _write(d, c); lock.notify_all(); return r

def _text_ui(ui):
    # The text form a MOD's text slot declares (modos-system-design.md 4.4): fixed parts and flexible ones with a `when` rule.
    fixed = [p for p in ui.get('fixed', []) if isinstance(p, str)][:4]
    inst = lambda v: v if isinstance(v, str) else [x for x in v if isinstance(x, str)][:4] if isinstance(v, list) else None
    flexible = [dict(cue=f['cue'], when=str(f.get('when', ''))[:200], **({'instead_of': inst(f['instead_of'])} if inst(f.get('instead_of')) else {}))
                for f in ui.get('flexible', []) if isinstance(f, dict) and isinstance(f.get('cue'), str)][:6]
    return dict(fixed=fixed, flexible=flexible)

def _dialogue(v):
    # Object-centric Dialogue (compose.mjs): the thing that says the answer, a box of the scene (layout:<id> or comp:<id>).
    speaker = v.get('speaker') if isinstance(v, dict) else None
    if not (isinstance(speaker, str) and re.fullmatch(r'(layout|comp):[A-Za-z0-9_.:-]{1,96}', speaker)): raise ValueError('Bad dialogue.')
    return dict(speaker=speaker)

def _text_mod(m):
    # The MOD hosting the text and its text slot's settings (e.g. duration: stay | 5s), read by the client.
    settings = m.get('settings') if isinstance(m.get('settings'), dict) else {}
    return dict(id=str(m.get('id') or '')[:64], settings={str(k)[:32]: v for k, v in list(settings.items())[:8] if isinstance(v, (str, int, float, bool))})

def _fail_stream(r, q):
    now = time.time(); stream = r['stream']
    stream.update(seq=stream['seq']+1, status='failed'); _writing(r, False, now)
    q.get('parts', {}).get('text', {})['status'] = 'failed'
    r.update(title='Answer unavailable', body='Please try again.', anchor=None, referenced_entities=[])
    stream['updates'].append(dict(seq=stream['seq'], status='failed', at=round(now-q.get('started', now), 3), created=now,
                                  title=r['title'], body=r['body'], anchor=None, referenced_entities=[]))

def _add_stream(d, c, q, body):
    stream = body['stream']
    if not isinstance(stream, dict) or type(stream.get('seq')) is not int or stream['seq'] < 1 or stream.get('status') not in ('streaming', 'complete', 'failed'):
        raise ValueError('Bad text stream update.')
    r = next((r for r in c['responses'] if r.get('question_id') == q['id'] and r.get('part') == 'text'), None)
    if r and q.get('revisions') and stream['seq'] == 1 and (not r.get('stream') or r['stream']['status'] != 'streaming'):
        # A draft's text written again: the same part (its id stays, what is drawn for it is updated in place), a new stream; the text
        # before is kept as a version (_withdraw), so a replay shows it until the new one began.
        _withdraw(q, r); r['stream'] = dict(updates=[]); r['updated_at'] = round(time.time(), 3); r.pop('stale_at', None)
    elif r:
        previous = r.get('stream')
        if not previous: raise ValueError('Text response already completed.')
        if stream['seq'] <= previous['seq']: return r  # retries/out-of-order deliveries cannot roll text back
        if previous['status'] != 'streaming': raise ValueError('Text stream already ended.')
        if len(previous['updates']) >= 256: raise ValueError('Too many text stream updates.')
    if q['status'] not in ('running', 'drafting'): raise ValueError('Question is no longer running.')
    title, text = body.get('title', ''), body.get('body', '')
    if not isinstance(title, str) or not isinstance(text, str) or len(title) > 512 or len(text) > 4096 or body.get('items'):
        raise ValueError('Bad streaming text.')
    if stream['status'] != 'complete' and (body.get('anchor') is not None or body.get('referenced_item_ids')):
        raise ValueError('Partial text cannot supply anchors or item references.')
    anchor = body.get('anchor') if stream['status'] == 'complete' else None
    refs = conversation_context.validate_references(d, body.get('referenced_item_ids', [])) if stream['status'] == 'complete' else []
    now = time.time(); at = max(0, round(now-q.get('started', now), 3))
    if not r:
        r = dict(id=max([r['id'] for r in c['responses']]+[c.get('retired_id', 0)])+1, created=now, frame=q['frame'], t=q['t'],
                 question=q['text'], question_id=q['id'], part='text', layout_slot=1 if body.get('layout_slot') == 1 else 0,
                 latency=at, stream=dict(updates=[]))
        c['responses'].append(r)
        q.setdefault('parts', {})['text'] = dict(response=r['id'], latency=at)
    r.update(title=title, body=text, items=[], anchor=anchor, referenced_entities=refs, reserve_text=True)
    # the theme it answers and whether it is the user's focus, from when it is written (later changes: mark_focus)
    if isinstance(body.get('theme'), dict) and r.get('stream', {}).get('updates') == []:
        r['theme'] = dict(ids=[int(x) for x in body['theme'].get('ids') or [] if isinstance(x, int)][:6], focus=bool(body['theme'].get('focus')))
        r['focus_log'] = [[round(now, 3), r['theme']['focus']]]
    if body.get('info') is not None: r['info'] = response_info(c, q, body['info'])
    if isinstance(body.get('text_ui'), dict): r['text_ui'] = _text_ui(body['text_ui'])
    if isinstance(body.get('text_mod'), dict): r['text_mod'] = _text_mod(body['text_mod'])
    if body.get('dialogue') is not None: r['dialogue'] = _dialogue(body['dialogue'])
    r['stream'].update(seq=stream['seq'], status=stream['status'])
    _writing(r, stream['status'] == 'streaming', now)
    q['parts']['text']['status'] = stream['status']
    r['stream']['updates'].append(dict(seq=stream['seq'], status=stream['status'], at=at, created=now, title=title, body=text, anchor=anchor, referenced_entities=refs))
    q.update(response=r['id'], latency=at)
    _write(d, c); lock.notify_all(); return r

class Stale(ValueError):
    """A part for a revision older than the one the bridge took since (the server answers 409; the bridge stops that work). The
    revision being answered finishes even when the user has typed on: the bridge then takes the newest text, skipping the ones between,
    so a fast typist still sees the answer grow."""

def _withdraw(q, r):
    """A typed question's part that left its surface (replaced by a newer one, or no longer needed) is kept on the question with the
    moment it left (`withdrawn_at`), so a replay shows the surface as it grew while the question was typed (each part from `created`
    to `withdrawn_at`). It travels with the question (an import, a Gallery copy)."""
    if q.get('revisions') and len(q.setdefault('withdrawn', [])) < 300: q['withdrawn'].append(dict(r, withdrawn_at=round(time.time(), 3)))

def part_key(r):
    """A part's identity on its question's surface: its kind and its MOD (a highlight of ObjectStatus and one of Wayfinding are two)."""
    kind = r.get('part') if r.get('part') != 'ui' else next((k for k in UI_KINDS if r.get(k) is not None), 'ui')
    m = r.get('mod'); return f"{kind}:{(m.get('id') if isinstance(m, dict) else m) or ''}"

def retract(d, qid, keys, rev=None):
    """Parts withdrawn from a draft's surface (a MOD no longer needed, text to be written again): by part_key."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if rev is not None and rev < q.get('taken_rev', 0): raise Stale('A newer revision of the question is being answered.')
    keys = set(keys or []); gone = [r for r in c['responses'] if r.get('question_id') == q['id'] and part_key(r) in keys]
    for r in gone: c['retired_id'] = max(c.get('retired_id', 0), r['id']); c['responses'].remove(r); _withdraw(q, r)
    if any(r.get('part') == 'text' for r in gone): q.get('parts', {}).pop('text', None)
    if gone: _write(d, c); lock.notify_all()
    return dict(removed=len(gone))

def _writing(r, on, now):
    """While the language model writes a text (from when a new one is begun until its stream ends): `writing` {from, to?}, so the
    editor shows it writing, and a replay at the moment it was."""
    w = r.get('writing'); open_ = isinstance(w, dict) and 'to' not in w
    if on and not open_: r['writing'] = dict({'from': round(now, 3)}); return True
    if not on and open_: w['to'] = round(now, 3); return True
    return False

def mark_writing(d, qid, keys, on=True, rev=None):
    """A draft's text that is being written anew (on: its words have not come yet) or no longer is (the write was given up)."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if rev is not None and rev < q.get('taken_rev', 0): raise Stale('A newer revision of the question is being answered.')
    keys = set(keys or []); now = time.time()
    hit = [r for r in c['responses'] if r.get('question_id') == q['id'] and part_key(r) in keys and r.get('part') == 'text' and _writing(r, on, now)]
    if hit: _write(d, c); lock.notify_all()
    return dict(changed=len(hit))

def mark_stale(d, qid, keys, stale=True, rev=None):
    """A draft's part that this revision does not update although it no longer answers what is asked (its text, while what it answers
    changed and nothing new is written yet): it stays in view, dimmed (`stale_at`, when it became so), instead of going. stale=False:
    it answers again."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if rev is not None and rev < q.get('taken_rev', 0): raise Stale('A newer revision of the question is being answered.')
    keys = set(keys or []); hit = [r for r in c['responses'] if r.get('question_id') == q['id'] and part_key(r) in keys and bool(r.get('stale_at')) != bool(stale)]
    for r in hit:
        if stale: r['stale_at'] = round(time.time(), 3)
        else: r.pop('stale_at', None)
    if hit: _write(d, c); lock.notify_all()
    return dict(changed=len(hit))

def themes(d, qid):
    """The theme book of a question's conversation (modos/themes.mjs: what the user speaks of, kept across its questions)."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    return dict(themes=_book_of(c))

def set_themes(d, qid, book):
    """The theme book after a question's run (the pipeline gives it back updated)."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if not (isinstance(book, dict) and isinstance(book.get('themes'), list)) or len(json.dumps(book)) > 200_000: raise ValueError('Bad themes.')
    c['themes'] = book; _write(d, c); return dict(ok=True)

def mark_focus(d, qid, keys, focus, rev=None):
    """Whether a part's theme is the user's focus now (the text's: it is not written again for it), logged with the moment it changed,
    so a replay shows it as it was."""
    c, q = _find_question(d, qid)
    if not q: raise ValueError('Unknown question.')
    if rev is not None and rev < q.get('taken_rev', 0): raise Stale('A newer revision of the question is being answered.')
    keys = set(keys or []); hit = []
    for r in c['responses']:
        if r.get('question_id') == q['id'] and part_key(r) in keys and (r.get('focus_log') or [[0, True]])[-1][1] != bool(focus):
            r.setdefault('focus_log', []).append([round(time.time(), 3), bool(focus)])
            if isinstance(r.get('theme'), dict): r['theme']['focus'] = bool(focus)
            hit.append(r)
    if hit: _write(d, c); lock.notify_all()
    return dict(changed=len(hit))

_MOD_NAMES = {}
def mod_names(space):
    """{MOD id: (name, short)}: each MOD's name and its short name (`short`, else its name) for compact lists (the Answers' capsules)."""
    files = sorted(list((Path(__file__).resolve().parents[1]/'modos'/'mods').glob('*.json'))+list((Path(space)/'modos'/'mods').glob('*.json')))
    key = (str(space), tuple((str(f), f.stat().st_mtime) for f in files if f.is_file()))
    if _MOD_NAMES.get(str(space), (None,))[0] != key:
        names = {}
        for f in files:
            try: m = json.loads(f.read_text())
            except (OSError, ValueError): continue
            if m.get('id'): names[m['id']] = (m.get('name') or m['id'], m.get('short') or m.get('name') or m['id'])
        _MOD_NAMES[str(space)] = (key, names)
    return _MOD_NAMES[str(space)][1]

def _mods_of(c, qid):
    """The MODs a version showed, in the order its parts came: each part's MOD, its text's, a merged answer's."""
    out = []
    for r in sorted((r for r in c['responses'] if r.get('question_id') == qid), key=lambda r: (r.get('created', 0), r['id'])):
        for m in [r.get('mod'), r.get('text_mod'), *((r.get('mods') or {}).values())]:
            mid = m.get('id') if isinstance(m, dict) else m
            if isinstance(mid, str) and mid not in out: out.append(mid)
    return out

def status(d, cid):
    c = read(d, cid); busy = running_question(d)[1] is not None
    # A text answer of an info question published without its item (an older bridge) still gets it from the question; a thing's own
    # words (Object-centric Dialogue) are not an info answer.
    questions = {q['id']: q for q in c['questions']}
    responses = [dict(r, info=response_info(c, questions[r['question_id']], dict(key=questions[r['question_id']]['info']['key'])))
                 if r.get('part') == 'text' and not r.get('info') and not r.get('dialogue') and questions.get(r.get('question_id'), {}).get('info') else r for r in c['responses']]
    # what an info answer is about has content (the twin's `content` trait: a poster, a screen): its MOD's Mark can say so
    if any((r.get('info') or {}).get('box_id') for r in responses):
        import modos_twin
        things = modos_twin.entities(Path(d).parents[1], d)
        responses = [dict(r, info=dict(r['info'], has_content=modos_parts.has_content(things.get(r['info']['box_id'], {}))))
                     if (r.get('info') or {}).get('box_id') else r for r in responses]
    # a typed question's withdrawn parts, for replaying how its surface grew (ids of their own: negative, never a live part's)
    gone = [dict(r, question_id=q['id'], id=-(i+1), part_id=r['id']) for i, (q, r) in enumerate((q, r) for q in c['questions'] for r in q.get('withdrawn', []))]   # part_id: the part it is a version of
    def audio(a):   # recordings kept before their length was: their length from the file (16 kHz mono 16-bit)
        f = Path(d)/a.get('file', '')
        return a if 'duration' in a or not f.is_file() else dict(a, duration=round(max(0, f.stat().st_size-44)/32000, 3))
    # one question per replay history: its version shown (pinned, else newest; the one looked at in the history meanwhile), with the
    # question's input (its recording) when the version has none of its own, its Gallery tag, and its history
    look = viewing.get((str(d), cid), {}); questions_out = []; show = set()
    titles = {}
    for r in c['responses']:
        if r.get('part') == 'text' and (r.get('title') or r.get('body')): titles[r.get('question_id')] = r.get('title') or str(r.get('body'))[:60]
    names = mod_names(Path(d).parents[1])   # each answer's MODs, by their short names
    for rid, vs in versions.groups(c['questions']).items():
        root = next((x for x in vs if not x.get('replay_of')), vs[0]); q = versions.shown(vs, look.get(rid)); show.add(q['id'])
        out = {k: v for k, v in q.items() if k not in ('withdrawn', 'traces', 'state')}   # state: the space when asked, for replays only
        for k in ('audio', 'gallery'):
            if root.get(k) is not None and out.get(k) is None: out[k] = root[k]
        # a version answered again from the question's input plays on the input's clock: where the video was as the words came is the
        # question's (a version typed again names only where it was asked); its parts are its own
        if q is not root and root.get('revisions'): out['clock'] = [dict(at=r['at'], t=r['t']) for r in root['revisions']]
        if out.get('audio'): out['audio'] = audio(out['audio'])
        out['history'] = [dict(id=v['id'], label=v.get('label'), how=versions.how(v), created=v.get('created'), status=v.get('status'),
                               title=titles.get(v['id']), mods=[dict(id=m, name=names[m][0] if m in names else m, short=names[m][1] if m in names else m) for m in _mods_of(c, v['id'])], asr=(v.get('audio') or {}).get('asr'),
                               pinned=root.get('pinned') == v['id'], shown=v is q) for v in vs]
        out['root'] = rid
        questions_out.append(out)
    responses = [r for r in responses if r.get('question_id') in show or r.get('question_id') not in questions]
    gone = [r for r in gone if r['question_id'] in show]
    return dict(connected=busy or time.time()-bridge_seen.get(str(d), 0) < 40, questions=questions_out, responses=responses, withdrawn=gone)
