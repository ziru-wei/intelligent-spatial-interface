#!/usr/bin/env python3
"""The system's server (modos-system): the project's site plus local processing of spaces and their scenarios (see scripts/spaces.py).

GET  /api/spaces                 spaces with their scan and scenarios, raw recordings in private/<scene>/recordings/, whether the mesh environment exists
POST /api/spaces {name}          create an empty space
GET  /api/modos/prompts          the prompts the decision model is asked (modos/prompts.json); POST {change: {decision: {prompt: words}}} edits their words
POST /api/scenarios {space,take} add a recording as a scenario: import, its own mesh, alignment to the scan (mesh and alignment run
                                 in .venv-mesh; open3d needs numpy < 2)
GET  /api/components?space=       the component library (components/<id>/, spaces/<space>/components/<id>/)
POST /api/composition {session|space,scope,revision,components}  placed components of a recording, or of the scene (scope 'scene')
POST /api/objects {space,name,kind,size?,src?}  a new opportunistic object in the scene's library (box, or .glb data URL)
POST /api/objects/update {space,id,name?,shape?,pose?,info?}  rename, reshape (all recordings), or keep its pose for placing it elsewhere
POST /api/objects/replace {space,id,src,size,pivot}  a box object becomes a .glb model in its place (every recording follows)
POST /api/objects/duplicate {space,id,name?,origin?,pose?}  a copy of an object (same shape) under a new name
POST /api/objects/to-box {space,id,size,center}    a model object becomes a box of its bounds in its place (every recording follows)
POST /api/layout/model {space,id,src?,size,center}  a piece of furniture shown as a .glb model fitted in its box, or (no src) as its box again
POST /api/objects/delete {space,id}  remove one that no recording places
POST /api/layout {space,objects,openings}  the scene layout as edited (scan/semantic.json; a box may carry `info`)
POST /api/layout/zone {space,zone,info}  a zone's info key (null: none)
GET  /api/info?space=            the space's info context (scripts/info_context.py): {entries: {key: {text}|{file}}, lib: [files]}
POST /api/info {space,key,value}  a key's value: {text} or {file} (in the lib); null clears it
POST /api/info/lib {space,name,src}  a file (data URL) added to the space's info lib
POST /api/scan/primary {space,scan}  choose which of the space's scans is used (all are already in the space's coordinates)
POST /api/register {space,take,target?}  align a recording again; target {surfaces, boxes}: what it shows (scripts/align_recording.py)
POST /api/align-manual {space,take,toSpace,info}   toSpace from point pairs picked in the editor
POST /api/rename {take,name}     display name of a recording (spaces/names.json)

Agent (scripts/agent-bridge.mjs runs the ModOS pipeline for one recording and publishes its parts here).
Questions and responses live in conversations ("sessions" in the UI), see scripts/agent_store.py:
GET  /api/agent/command?session=                   pastable shell command that starts the bridge for this scene
POST /api/agent/bridge {session}                    start that bridge from the editor (a Gallery example), unless one is already polling
GET  /api/agent/conversations?session=             list; POST /api/agent/conversations {session,name?} creates an empty one
POST /api/agent/conversations/rename|import         {session,conversation,name} | {session,data}; GET …/export?session=&conversation=
GET  /api/gallery                                    the Gallery's examples (scripts/gallery.py), written to context/gallery as well
POST /api/gallery/still {session,conversation,image}  a still of an example's answer; POST /api/gallery/replace {name,keep}: drop older examples of that name
POST /api/gallery/add {session,conversation,ids}      a new example from answered questions (one, or several in a row)
POST /api/asr/relay                                 speech to text: starts scripts/asr-relay.mjs (Doubao) if needed; {url}
POST /api/agent/drafts {session,conversation,id?,frame,t,text,pause?,selection?}   answer while typing: a draft's revision (…/drafts/ask {id,text}, …/drafts/cancel {id}); POST /api/agent/questions/audio?session=&id=&started= (body: WAV) a spoken question's recording; GET /api/agent/questions/runs?id= (a typed question's trace per revision); GET /api/agent/questions/rev?id=; POST /api/agent/responses/retract {question_id,keys,rev}
GET  /api/agent/themes?session=&id=   the theme book of a question's conversation (modos/themes.mjs); POST /api/agent/themes {session,question_id,themes}
POST /api/agent/responses/retract {session,question_id,keys,rev}   a draft's parts withdrawn (by part_key); …/responses/stale {…,stale}: left in view, dimmed; …/responses/writing {…,writing}: being written anew
POST /api/agent/questions {session,conversation,frame,t,text,live?,selection?,selection_mode?}   ask at a frame (live = asked during playback); POST /api/agent/questions/delete
GET  /api/agent/status?session=&conversation=       bridge connected + the conversation's questions and responses
GET  /api/agent/questions/next?session=            bridge long-poll (≤25 s); POST /api/agent/questions/trace {session,id,step}, …/done {session,id,message,duration}
GET  /api/agent/info?session=&question_id=&key=       one info key's value (scripts/info_context.py payload); POST /api/agent/questions/info
                                                   {session,id,key,interaction_id?,source}: the info item a question was answered with
                                                   at the question being answered, else at the frame the editor shows (POST /api/agent/state)
POST /api/agent/placement-log {session,question_id,event}  debug: one placement event of an answer (agent/placement-log/q<id>.jsonl)
POST /api/agent/responses {session,…}              UI/full text; text streams use {part:'text',stream:{seq,status}} snapshots
Static files: the repository as it is laid out, its root the main page (index.html: Demo, Gallery, Vocabulary, About), the editor
under /system/editor/ (framed by the main page; opened on its own it goes to the main page), the Gallery's examples under
/context/gallery/; nothing else (no dot folders, private/, logs or agent-config.local.json). Started from a terminal, it opens the main
page in the browser (--no-open: not).
Binds to 127.0.0.1 only (with --lan, also the local network, for the agent API only, with a token: the Vision Pro app, visionos/);
GET  /api/vision/space?space=&revision=  /colors  /color?file=  /settings?headset=1  /room   POST /api/vision/settings {space, settings}
     POST /api/vision/room {space, worldFromSpace, points} (the headset)   /alignment {space, worldFromSpace} (the editor's Tune)
                                                   the Vision Pro app's live data (scripts/vision.py; settings page: /system/editor/vision.html)
POST /api/agent/questions in a live session (session.json live: true) carries {pose: {position, quaternion}} instead of a recorded frame;
recordings must exist in private/<scene>/recordings/; a session is a scenario's spaces/<space>/scenarios/<take>/session.json.
"""
import hmac, ipaddress, json, math, posixpath, re, secrets, shlex, shutil, subprocess, sys, threading, time
from urllib.parse import urlsplit, parse_qs, unquote
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]   # the editor (system/editor)
SITE = ROOT.parents[1]                       # the repository, served as the site: the main page at its root
sys.path.insert(0, str(ROOT/'scripts'))
import agent_store as store, gallery, spaces, composition, weather, findmy, hand_cache, info_context, layout, vision, location, modos_context, modos_registry, modos_twin, modos_parts, modos_prompts
busy = threading.Lock()
MOCK_CONTEXT = ROOT/'agent'/'mock-context.json'

def session_dir(session):
    """Resolve a session's URL path to its folder, refusing anything else: relative to the editor (./spaces/<space>/scenarios/<take>/session.json,
    as in ?session= and the bridge's --session) or absolute on the site (/system/editor/spaces/…, a URL's pathname)."""
    p = urlsplit(str(session or '')).path
    path = (SITE/p.lstrip('/') if p.startswith('/') else ROOT/p).resolve()
    if path.name != 'session.json' or not path.is_file() or path.parent.parent.name != 'scenarios' or path.parent.parent.parent.parent != spaces.SPACES.resolve():
        raise ValueError('Unknown session: '+str(session))
    return path.parent

def answer_settings(config=None):
    if config is None:
        path=ROOT/'agent-config.local.json'
        try:config=json.loads(path.read_text()) if path.is_file() else {}
        except (OSError, ValueError):raise ValueError('Cannot read local agent config; check its JSON.')
    if not isinstance(config,dict):raise ValueError('Local agent config must be a JSON object.')
    provider=config.get('answerProvider') or 'gemini'
    if provider not in ('gemini','luna'):raise ValueError('Answer provider must be gemini or luna.')
    prefix='gemini-' if provider=='gemini' else 'gpt-'
    matches=isinstance(config.get('answerModel'),str) and config['answerModel'].startswith(prefix)
    model=(config.get('answerModel') if matches else None) or ('gemini-3.5-flash-lite' if provider=='gemini' else 'gpt-6-luna')
    effort=(config.get('answerEffort') if matches else None) or ('minimal' if provider=='gemini' else 'low')
    allowed=('minimal','low','medium','high') if provider=='gemini' else ('low','medium','high','xhigh','max','ultra')
    if not re.fullmatch(r'[a-z0-9.-]+',model) or effort not in allowed:raise ValueError('Invalid answer model or effort.')
    return dict(provider=provider,model=model,effort=effort)

def agent_command(session, host):
    d = session_dir(session); key = './'+d.relative_to(ROOT).as_posix()+'/session.json'
    settings=answer_settings()
    return ' '.join(map(shlex.quote, [shutil.which('node') or 'node', str(ROOT/'scripts'/'agent-bridge.mjs'), '--url', f'http://{host}', '--session', key, '--config', str(ROOT/'agent-config.local.json'), '--provider', settings['provider'], '--model', settings['model'], '--effort', settings['effort']]))

# Bridges the editor started (POST /api/agent/bridge): one per scene, so a Gallery example (or the Demo) can be asked again without a
# terminal. Not started when a bridge is already polling that scene (one started by hand, or by demos/gallery.mjs).
bridges = {}
def start_bridge(session, host):
    d = session_dir(session); key = str(d)
    if key in bridges and bridges[key].poll() is None: return dict(started=False, running=True)
    if time.time()-store.bridge_seen.get(key, 0) < 30: return dict(started=False, running=True)
    log = open(d/'agent'/'bridge.log', 'ab') if (d/'agent').is_dir() else subprocess.DEVNULL
    bridges[key] = subprocess.Popen(shlex.split(agent_command(session, host)), cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
    return dict(started=True, running=True)
def stop_bridges():
    for p in [*bridges.values(), *asr.values()]:
        if p.poll() is None: p.terminate()

# Speech to text for the ask box (scripts/asr-relay.mjs, design doc 12.8): one relay to Doubao's streaming recognition, on 127.0.0.1,
# started when the editor first needs it; its keys are read by the relay from agent-config.local.json (doubaoAsr), never sent here.
asr = {}
ASR_PORT = 8767
def start_asr():
    cfg = ROOT/'agent-config.local.json'
    try: keys = json.loads(cfg.read_text()).get('doubaoAsr') if cfg.is_file() else None
    except (OSError, ValueError): keys = None
    if not isinstance(keys, dict) or not (keys.get('apiKey') or (keys.get('appKey') and keys.get('accessKey'))):
        raise ValueError('Speech to text needs doubaoAsr keys in agent-config.local.json (apiKey, or appKey and accessKey, and resourceId).')
    url = f'http://127.0.0.1:{ASR_PORT}'
    if 'relay' in asr and asr['relay'].poll() is None: return dict(url=url, started=False)
    log = open(ROOT/'asr-relay.log', 'ab')
    asr['relay'] = subprocess.Popen([shutil.which('node') or 'node', str(ROOT/'scripts'/'asr-relay.mjs'), '--port', str(ASR_PORT), '--config', str(cfg)], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
    time.sleep(.4)   # listening before the editor's first request
    return dict(url=url, started=True)

def frame_pose(d, frame):
    f = json.loads((d/'session.json').read_text())['frames'][frame]; x, y, z, w = f['quaternion']
    # Camera forward (-Z) rotated by the quaternion.
    forward = [-(2*(x*z+y*w)), -(2*(y*z-x*w)), -(1-2*(x*x+y*y))]
    return dict(frame=frame, t=f['t'], position=f['position'], quaternion=f['quaternion'], forward=forward)

def agent_context(session, groups=None, question_id=None):
    d = session_dir(session)
    ctx = weather.context(d, groups)
    with store.lock:
        conversation, running = store._find_question(d, question_id) if question_id is not None else store.running_question(d)
        if question_id is not None and running is None: raise ValueError('Unknown question.')
        live = store.editor_state.get(str(d))
        ctx['conversation'] = store.conversation_context.snapshot(conversation, running)
        # The information box the user selected when asking, and the info item of the previous turn (a follow-up may be about it).
        if running and running.get('selection'): ctx['selection'] = running['selection']
        # Where the user is: the zone they are in, one they face (scripts/location.py), and what "here" / "this lab" mean.
        if running and running.get('location'): ctx['location'] = location.context(d, running['location'])
        if store.active_info(conversation, running): ctx['active_info'] = store.active_info(conversation, running)
    if running:
        ctx['question'] = dict(id=running['id'], text=running['text'], asked_at_s=running['t'])
        live = dict(frame=running['frame'], t=running['t'], **running['pose']) if running.get('pose') else frame_pose(d, running['frame'])
    ctx['user'] = dict(ctx.get('user', {}), pose=live or 'editor not open on this scene')
    return ctx

def next_question(session):
    d = session_dir(session); deadline = time.time()+25
    with store.lock:
        while True:
            store.bridge_seen[str(d)] = time.time()
            q = store.take_next(d)
            if q: return q
            if time.time() >= deadline: return {}
            soon = store.next_draft_in(d)   # a revision waiting for its turn (RECOMPUTE_S) is taken when it comes
            store.lock.wait(max(.01, min(deadline-time.time(), soon if soon is not None else 1e9)))

def live_pose(value):
    """A head pose sent by a headset asking live: {position: [x, y, z], quaternion: [x, y, z, w]} in scene coordinates, with its forward."""
    num = lambda v, n: isinstance(v, list) and len(v) == n and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)
    if not isinstance(value, dict) or not num(value.get('position'), 3) or not num(value.get('quaternion'), 4): raise ValueError('Bad live pose.')
    x, y, z, w = value['quaternion']
    return dict(position=[float(v) for v in value['position']], quaternion=[float(v) for v in value['quaternion']],
                forward=[-(2*(x*z+y*w)), -(2*(y*z-x*w)), -(1-2*(x*x+y*y))])

def ask(body, drafting=False):
    d = session_dir(body.get('session')); text = str(body.get('text') or '').strip()
    if not text: raise ValueError('Empty question.')
    sm = json.loads((d/'session.json').read_text()); frames = len(sm['frames']); frame = int(body.get('frame', 0))
    if not 0 <= frame < frames: raise ValueError('Frame out of range.')
    # A live session (a headset, visionos/): no recording; the question carries the user's pose.
    pose = live_pose(body.get('pose')) if sm.get('live') else None
    space = d.parent.parent; m = json.loads((space/'space.json').read_text()); sem_path = space/(m.get('semantic') or 'scan/semantic.json')
    sem = layout.migrate_information(json.loads(sem_path.read_text())) if sem_path.is_file() else {}
    selection = info_context.selection(space, sem, body.get('selection'), body.get('selection_mode', 'jev'), session=d) if body.get('selection') else None
    # A recording asked about in the editor: where the recorded camera stands and looks (a headset sends its own).
    where = location.check(d, body.get('location')) if body.get('location') is not None or sm.get('live') else location.from_camera(d, sm, frame)
    with store.lock:
        if drafting: return store.draft(d, body.get('conversation'), body.get('id'), frame, float(body.get('t', 0)), text, bool(body.get('pause')), selection, pose, where)
        return store.ask(d, body.get('conversation'), frame, float(body.get('t', 0)), text, body.get('live'), selection, pose, where)

def agent_get(path, session, q):
    if path == '/api/agent/questions/next': return next_question(session)
    d = session_dir(session); cid = q.get('conversation', [''])[0]
    with store.lock:
        store._prepare(d)
        if path == '/api/agent/conversations': return store.listing(d)
        if path == '/api/agent/questions/rev': return store.revision(d, q.get('id', [''])[0])
        if path == '/api/agent/questions/runs': return store.runs(d, q.get('id', [''])[0])
        if path == '/api/agent/themes': return store.themes(d, q.get('id', [''])[0])
        if path == '/api/agent/conversations/export': return store.read(d, cid)
        if path == '/api/agent/status': return store.status(d, cid)
    if path == '/api/agent/info':
        # One info key's value for the bridge (scripts/info_context.py payload): text, or a file's text or bytes.
        with store.lock:
            if not store._find_question(d, q.get('question_id', [''])[0])[1]: raise ValueError('Unknown question.')
        return info_context.payload(d, q.get('key', [''])[0])
    raise KeyError(path)

def agent_post(path, body):
    if path == '/api/agent/questions': return ask(body)
    if path == '/api/agent/drafts': return ask(body, drafting=True)
    d = session_dir(body.get('session')); cid = body.get('conversation')
    with store.lock:
        store._prepare(d)
        if path == '/api/agent/state': store.editor_state[str(d)] = {k: body.get(k) for k in ('conversation', 'frame', 't', 'position', 'quaternion', 'forward')}; return dict(ok=True)
        if path == '/api/agent/conversations': return store.create(d, body.get('name'), gallery_example=gallery.clean_tag(body['gallery_example']) if body.get('gallery_example') else None)
        if path == '/api/agent/conversations/delete': out = store.delete_conversation(d, cid); gallery.rebuild(); return out
        if path == '/api/agent/conversations/rename': return store.rename(d, cid, body.get('name'))
        if path == '/api/agent/conversations/import': return store.import_conversation(d, body.get('data'))
        if path == '/api/agent/questions/delete': out = store.delete_question(d, cid, body.get('id')); gallery.rebuild(); return out
        if path == '/api/agent/questions/trace': store.bridge_seen[str(d)] = time.time(); return store.add_trace(d, body.get('id'), body.get('step'))
        if path == '/api/agent/placement-log': return store.log_placement(d, body.get('question_id'), body.get('event'))
        if path == '/api/agent/questions/info': return store.set_info(d, body.get('id'), body.get('key'), body.get('interaction_id'), body.get('source'))
        if path == '/api/agent/questions/done': store.bridge_seen[str(d)] = time.time(); return store.finish(d, body.get('id'), body.get('message'), body.get('duration'))
        if path == '/api/agent/responses': return store.add_response(d, body)
        # Answer while typing (store.draft): Enter asks the draft as typed; clearing the box drops it; the bridge withdraws parts
        if path == '/api/agent/drafts/ask': return store.finalize(d, cid, body.get('id'), body.get('text'), body.get('live'))
        if path == '/api/agent/drafts/cancel': return store.delete_question(d, cid, body.get('id'))
        if path == '/api/agent/responses/retract': return store.retract(d, body.get('question_id'), body.get('keys'), body.get('rev'))
        if path == '/api/agent/themes': return store.set_themes(d, body.get('question_id'), body.get('themes'))
        if path == '/api/agent/responses/focus': return store.mark_focus(d, body.get('question_id'), body.get('keys'), body.get('focus') is not False, body.get('rev'))
        if path == '/api/agent/responses/writing': return store.mark_writing(d, body.get('question_id'), body.get('keys'), body.get('writing', True) is not False, body.get('rev'))
        if path == '/api/agent/responses/stale': return store.mark_stale(d, body.get('question_id'), body.get('keys'), body.get('stale', True) is not False, body.get('rev'))
    raise KeyError(path)

class Server(ThreadingHTTPServer):
    # Playback fetches an image and a depth map per frame while bridges long-poll; the default listen backlog of 5 overflows and
    # the browser sees reset connections (a failed module load leaves the editor blank).
    request_queue_size = 256
    daemon_threads = True

def served(path):
    """Whether a static path is part of the site: the main page, the editor (system/editor/) and the Gallery's examples (context/gallery/)."""
    parts = [x for x in posixpath.normpath('/'+unquote(path)).split('/') if x]   # as the file server reads it (%2e%2e is ..)
    if not parts: return True
    if any(x.startswith('.') for x in parts) or parts[-1] == 'agent-config.local.json' or parts[-1].endswith('.log'): return False
    if parts == ['index.html']: return True
    if parts[:2] == ['context', 'gallery']: return True
    return parts[:2] == ['system', 'editor'] and (len(parts) < 3 or parts[2] != 'private')

class Handler(SimpleHTTPRequestHandler):
    server_version = 'modos-system'   # its name (the speech relay beside it is modos-speech, the agent bridge modos-agent)
    sys_version = ''
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.cjs': 'text/javascript', '.wasm': 'application/wasm'}
    # Keep-alive: one connection carries many requests instead of a new one per frame.
    protocol_version = 'HTTP/1.1'
    def send_head(self):
        # Only the site's pages and what they load (the main page, the editor, the Gallery's examples); never dot folders (.git,
        # .git-private, .venv), private/ (raw exports), logs or the bridge's credentials.
        if not served(urlsplit(self.path).path):
            self.send_error(404, 'Not found')
            return None
        return super().send_head()
    def end_headers(self):
        # Editor modules change while developing; never serve stale copies.
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, fmt, *args):
        # Polls (the editor, the agent bridge, the headset's live sync) would drown everything else.
        polled = ('/api/agent/state', '/api/agent/status', '/api/agent/questions/next') + (('/api/vision/settings', '/api/vision/space') if self.command == 'GET' else ('/api/vision/room',))
        if not any(p in self.path for p in polled): super().log_message(fmt, *args)
    def reply(self, status, body):
        data = json.dumps(body).encode(); self.send_response(status)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def lan_refused(self):
        """With --lan, a client on another machine (the headset) may only use the agent API, and only with the token
        (header X-Spatial-Token: agent-config.local.json visionToken); this machine's own clients are unrestricted."""
        if ipaddress.ip_address(self.client_address[0].removeprefix('::ffff:')).is_loopback: return False
        token = self.headers.get('X-Spatial-Token') or ''
        if LAN_TOKEN and urlsplit(self.path).path.startswith(('/api/agent/', '/api/vision/')) and hmac.compare_digest(token, LAN_TOKEN): return False
        if self.command == 'POST': self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.reply(403, dict(error='Forbidden')); return True
    def do_GET(self):
        if self.lan_refused(): return
        url = urlsplit(self.path); q = parse_qs(url.query); session = q.get('session', [''])[0]
        if url.path == '/api/hands':
            try:
                d = session_dir(session)
                return self.reply(200, hand_cache.read(d, int(q['frame'][0]), q.get('token', [''])[0]) if 'frame' in q else hand_cache.describe(d))
            except (ValueError, OSError, KeyError) as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/components':
            space = q.get('space', [''])[0]
            try: return self.reply(200, dict(components=composition.library(spaces.space_dir(space) if space else None)))
            except ValueError as e: return self.reply(400, dict(error=str(e)))
        if url.path.startswith('/api/vision/'):
            # The Vision Pro app's live data (scripts/vision.py).
            name = q.get('space', ['atlas'])[0]
            try:
                if url.path == '/api/vision/space': return self.reply(200, vision.space(name, q.get('revision', [None])[0]))
                if url.path == '/api/vision/colors': return self.reply(200, vision.colors(name))
                if url.path == '/api/vision/settings': return self.reply(200, vision.settings(name, headset=q.get('headset', [''])[0] == '1'))
                if url.path == '/api/vision/room': return self.reply(200, vision.room(name))
                if url.path == '/api/vision/color':
                    data = vision.color_file(name, q.get('file', [''])[0]); self.send_response(200)
                    self.send_header('Content-Type', 'image/png'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data); return
                return self.reply(404, dict(error='Not found'))
            except (ValueError, OSError, subprocess.SubprocessError) as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/info':
            try: return self.reply(200, info_context.read(spaces.space_dir(q.get('space', [''])[0])))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/spaces': return self.reply(200, dict(spaces=spaces.listing(), takes=spaces.takes(), meshAvailable=spaces.MESH_PYTHON.is_file()))
        if url.path == '/api/agent/command':
            try: return self.reply(200, dict(command=agent_command(session, self.headers.get('Host', '127.0.0.1:8766')), config_path=str(ROOT/'agent-config.local.json'), gemini_setup_command=' '.join(map(shlex.quote,[shutil.which('node') or 'node',str(ROOT/'scripts/gemini-setup.mjs')])), restart_command=' '.join(map(shlex.quote, ['npm', '--prefix', str(ROOT), 'start']))))
            except ValueError as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/modos/entities':
            # The digital twin's one entity view (scripts/modos_twin.py) for the editor's Space tab (Entities): every entity with its kind,
            # traits, parent and device, plus the knowledge items attached to it.
            try:
                sp = spaces.space_dir(q.get('space', [''])[0]); d = session_dir(session) if session else None
                ents = modos_twin.entities(sp, d)
                its = modos_context.items(d or sp, modos_registry.installed(sp, set(ents)))
                about = {}
                for it in its:
                    for a in it['about']: about.setdefault(a, []).append(dict(id=it['id'], type=it['type'], summary=it['summary']))
                return self.reply(200, dict(entities=[dict(e, knowledge=about.get(e['id'], [])) for e in ents.values()],
                                            kinds=list(modos_twin.KINDS), traits=list(modos_twin.TRAITS)))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/gallery':
            try:
                with store.lock: return self.reply(200, dict(examples=gallery.rebuild()))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/modos/prompts':
            # The prompts the decision model is asked (scripts/modos_prompts.py), for the pipeline page.
            return self.reply(200, dict(prompts=modos_prompts.load()))
        if url.path == '/api/modos/installed':
            # The space's installed MODs as the pipeline reads them (effective: active variant, settled settings, declarations); the
            # editor draws every part with these (src/current-mods.mjs).
            try: return self.reply(200, dict(mods=modos_registry.installed(spaces.space_dir(q.get('space', [''])[0]))))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/modos/mods':
            # The space's MODs as the editor's MODs tab tailors them (scripts/modos_registry.py catalog).
            try: return self.reply(200, dict(mods=modos_registry.catalog(spaces.space_dir(q.get('space', [''])[0]))))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path in ('/api/modos/context', '/api/modos/memory', '/api/modos/items'):   # /memory: the old name
            # ModOS (modos-system-design.md): the catalog of the question being answered plus the space's MODs, entities and item
            # summaries; or the bodies of chosen items.
            try:
                d = session_dir(session); qid = q.get('question_id', [None])[0]
                if url.path in ('/api/modos/context', '/api/modos/memory'):
                    ctx = agent_context(session, [], qid)
                    keep = {k: ctx[k] for k in ('time', 'conversation', 'selection', 'location', 'active_info', 'question', 'user') if k in ctx}
                    return self.reply(200, dict(keep, **modos_context.snapshot(d)))
                mods = modos_context.snapshot(d)['mods']
                ids = [i for i in q.get('ids', [''])[0].split('|') if i]
                return self.reply(200, dict(items=[modos_context.body(d, i, mods) for i in ids]))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path.startswith('/api/agent/'):
            try: return self.reply(200, agent_get(url.path, session, q))
            except KeyError: return self.reply(404, dict(error='Not found'))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        super().do_GET()
    def do_POST(self):
        if self.lan_refused(): return
        path = urlsplit(self.path).path
        if path in ('/api/vision/settings', '/api/vision/room', '/api/vision/alignment'):
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            name = body.get('space') or 'atlas'
            try:
                if path == '/api/vision/room': return self.reply(200, vision.save_room(name, body))
                if path == '/api/vision/alignment': return self.reply(200, vision.set_alignment(name, body))
                return self.reply(200, vision.save_settings(name, body.get('settings')))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path in ('/api/gallery/still', '/api/gallery/replace', '/api/gallery/add'):
            # The Gallery (scripts/gallery.py): a still of an example's answer from the editor, or a newly answered example replacing
            # the older ones of its name (demos/gallery.mjs).
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try:
                with store.lock:
                    if path == '/api/gallery/add': return self.reply(200, gallery.add(session_dir(body.get('session')), body.get('conversation'), body.get('ids')))
                    if path == '/api/gallery/still': return self.reply(200, dict(example=gallery.save_still(session_dir(body.get('session')), body.get('conversation'), body.get('image'))))
                    return self.reply(200, gallery.replace(gallery.clean_tag(dict(name=body.get('name')))['name'], body.get('keep')))
            except (ValueError, OSError, KeyError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/modos/entities':
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try:
                sp = spaces.space_dir(body.get('space')); d = session_dir(body['session']) if body.get('session') else None
                op = body.get('op')
                if op == 'update': return self.reply(200, dict(entity=modos_twin.update(sp, body.get('id'), body.get('patch'), d)))
                if op == 'add': return self.reply(200, dict(entity=modos_twin.add(sp, body.get('entity') or {}, d)))
                if op == 'remove': modos_twin.remove(sp, body.get('id')); return self.reply(200, dict(ok=True))
                return self.reply(400, dict(error='op is update, add or remove.'))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/modos/actions':
            # An action card's confirm button (Send's confirm): {space, action, message} → sent (mock: the space's outbox).
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try: return self.reply(200, modos_parts.send(spaces.space_dir(body.get('space')), body.get('action'), body.get('message')))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/modos/devices':
            # A connected device's input changed from its controls (IoTControl's panel): {space, id, key, op, value} → its device (mock protocol).
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try: return self.reply(200, dict(device=modos_parts.apply_action(spaces.space_dir(body.get('space')), body.get('id'), body.get('key'), body.get('op', 'set'), body.get('value'))))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/modos/prompts':
            # Edit the prompts' words {change: {decision: {prompt: words}}}: each keeps its placeholders (scripts/modos_prompts.py).
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try:
                with store.lock: return self.reply(200, dict(prompts=modos_prompts.save(body.get('change'))))
            except ValueError as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/modos/mods':
            # Tailor a MOD: op customize {mod, change}, reset {mod}, fork {mod, id, name, description?}, remove {mod} (a fork),
            # install / uninstall {mod}. Every change is validated by resolving the MOD before it is saved.
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try:
                sp = spaces.space_dir(body.get('space')); op = body.get('op'); mid = body.get('mod')
                if op == 'customize': modos_registry.customize(sp, mid, body.get('change') or {})
                elif op == 'reset': modos_registry.reset(sp, mid)
                elif op == 'fork': modos_registry.fork(sp, mid, body.get('id'), body.get('name'), body.get('description'))
                elif op == 'remove': modos_registry.remove_fork(sp, mid)
                elif op == 'install': modos_registry.install(sp, mid)
                elif op == 'uninstall': modos_registry.uninstall(sp, mid)
                else: return self.reply(400, dict(error='op is customize, reset, fork, remove, install or uninstall.'))
                return self.reply(200, dict(mods=modos_registry.catalog(sp)))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/modos/install':
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            try: return self.reply(200, dict(installed=modos_registry.install(spaces.space_dir(body.get('space')), body.get('mod'))))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/asr/relay':
            try: return self.reply(200, start_asr())
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/agent/bridge':
            try: return self.reply(200, start_bridge(json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}').get('session'), self.headers.get('Host', '127.0.0.1:8766')))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path == '/api/agent/questions/audio':
            # a spoken question's own recording (16 kHz WAV), kept in its recording's folder only (spaces/ is local): raw bytes, not JSON
            q = parse_qs(urlsplit(self.path).query); data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            v = lambda k: float(q[k][0]) if q.get(k, [''])[0] not in ('', None) else None
            try:
                with store.lock: kept = store.set_audio(session_dir(q.get('session', [''])[0]), q.get('id', [''])[0], data, float(q.get('started', ['0'])[0]), v('t'), v('t_at'), v('t_end'), v('t_end_at'), v('rate'))
                return self.reply(200, kept)
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if path.startswith('/api/agent/'):
            try: return self.reply(200, agent_post(path, json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')))
            except store.Stale as e: return self.reply(409, dict(error=str(e), stale=True))
            except KeyError: return self.reply(404, dict(error='Not found'))
            except (ValueError, OSError, TypeError) as e: return self.reply(400, dict(error=str(e)))
        # With keep-alive, the body must always be read, or it would be parsed as the next request.
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        if path == '/api/hands':
            try: return self.reply(200, hand_cache.write(session_dir(body.get('session')), body.get('frame'), body.get('token'), body.get('data') or {}))
            except (ValueError, OSError, TypeError) as e: return self.reply(400, dict(error=str(e)))
        quick = {'/api/spaces': lambda: spaces.create(body.get('name')), '/api/rename': lambda: spaces.rename(body.get('take'), body.get('name')),
            '/api/layout': lambda: spaces.save_layout(body.get('space'), body.get('objects'), body.get('openings'), body.get('revision'), body.get('information')),
            '/api/info': lambda: info_context.set_value(spaces.space_dir(body.get('space')), body.get('key'), body.get('value')),
            '/api/info/lib': lambda: info_context.add_file(spaces.space_dir(body.get('space')), body.get('name'), body.get('src')),
            # A recording's own components, or (scope 'scene') the scene's, shared by all its recordings.
            '/api/composition': lambda: composition.save(spaces.space_dir(body.get('space')), body.get('components'), body.get('revision')) if body.get('scope') == 'scene'
                else composition.save(session_dir(body.get('session')), body.get('components'), body.get('revision')),
            '/api/objects': lambda: composition.add_object(spaces.space_dir(body.get('space')), body.get('name'), body.get('kind'), body.get('size'), body.get('src'), body.get('origin'), body.get('pose')),
            '/api/objects/update': lambda: composition.update_object(spaces.space_dir(body.get('space')), body.get('id'), body.get('name'), body.get('shape'), body.get('pose'), body.get('origin'), **({'info': body['info']} if 'info' in body else {})),
            '/api/objects/replace': lambda: composition.replace_object(spaces.space_dir(body.get('space')), body.get('id'), body.get('src'), body.get('size'), body.get('pivot')),
            '/api/objects/duplicate': lambda: composition.duplicate_object(spaces.space_dir(body.get('space')), body.get('id'), body.get('name'), body.get('origin'), body.get('pose')),
            '/api/objects/to-box': lambda: composition.model_to_box(spaces.space_dir(body.get('space')), body.get('id'), body.get('size'), body.get('center')),
            '/api/layout/zone': lambda: spaces.set_zone_info(body.get('space'), body.get('zone'), body.get('info')),
            '/api/layout/model': lambda: spaces.set_furniture_model(body.get('space'), body.get('id'), body.get('src'), body.get('size'), body.get('center')),
            '/api/objects/delete': lambda: composition.remove_object(spaces.space_dir(body.get('space')), body.get('id')),
            '/api/scan/primary': lambda: spaces.set_primary(body.get('space'), body.get('scan')),
            '/api/align-manual': lambda: spaces.align_manually(body.get('space'), body.get('take'), body.get('toSpace'), body.get('info'))}.get(path)
        if quick:
            try: return self.reply(200, quick())
            except (spaces.Conflict, composition.Conflict) as e: return self.reply(409, dict(error=str(e)))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        action = {'/api/scan/import': lambda space, take: spaces.import_scan(space, body.get('source')), '/api/scenarios': spaces.add_scenario, '/api/register': lambda space, take: spaces.register(space, take, body.get('target'))}.get(path)
        if not action: return self.reply(404, dict(error='Not found'))
        if not busy.acquire(blocking=False): return self.reply(409, dict(error='Another job is running.'))
        try:
            self.reply(200, action(body.get('space'), body.get('take')))
        except (ValueError, OSError) as e: self.reply(400, dict(error=str(e)))
        finally: busy.release()

LAN_TOKEN = None
def lan_token():
    """The token a headset needs (--lan): agent-config.local.json visionToken, made once if missing."""
    path = ROOT/'agent-config.local.json'; config = json.loads(path.read_text()) if path.is_file() else {}
    if not isinstance(config.get('visionToken'), str) or len(config['visionToken']) < 16:
        config['visionToken'] = secrets.token_urlsafe(24); path.write_text(json.dumps(config, indent=2))
    return config['visionToken']

if __name__ == '__main__':
    # server.py [port] [--lan] [--no-open]: --lan also listens on the local network, for the Vision Pro app (visionos/), which may then use
    # the agent API only, with the token; started from a terminal, the main page opens in the browser unless --no-open.
    args = [a for a in sys.argv[1:] if a not in ('--lan', '--no-open')]; lan = '--lan' in sys.argv[1:]
    port = int(args[0]) if args else 8766
    if lan: LAN_TOKEN = lan_token()
    http = Server(('0.0.0.0' if lan else '127.0.0.1', port), partial(Handler, directory=str(SITE)))
    if sys.stdout.isatty(): sys.stdout.write('\x1b]0;modos-system\x07')   # its terminal's title (the agent bridge's is modos-agent)
    home = f'http://127.0.0.1:{http.server_port}/'
    print(f'modos-system: {home}'+(' (also on the local network: agent API only, token in agent-config.local.json visionToken)' if lan else ''), flush=True)
    if sys.stdout.isatty() and '--no-open' not in sys.argv[1:] and shutil.which('open'): subprocess.Popen(['open', home])   # the main page
    import atexit, signal; atexit.register(stop_bridges)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))   # stopped (kill): the bridges it started stop with it
    try: http.serve_forever()
    finally: stop_bridges()
