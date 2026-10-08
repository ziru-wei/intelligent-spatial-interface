#!/usr/bin/env python3
"""Editor server: static files plus local processing of spaces and their scenarios (see scripts/spaces.py).

GET  /api/spaces                 spaces with their scan and scenarios, raw recordings in private/<scene>/recordings/, whether the mesh environment exists
POST /api/spaces {name}          create an empty space
POST /api/scenarios {space,take} add a recording as a scenario: import, its own mesh, alignment to the scan (mesh and alignment run
                                 in .venv-mesh; open3d needs numpy < 2)
GET  /api/components?space=       the component library (components/<id>/, spaces/<space>/components/<id>/)
POST /api/composition {session|space,scope,revision,components}  placed components of a recording, or of the scene (scope 'scene')
POST /api/objects {space,name,kind,size?,src?}  a new opportunistic object in the scene's library (box, or .glb data URL)
POST /api/objects/update {space,id,name?,shape?,pose?}  rename, reshape (all recordings), or keep its pose for placing it elsewhere
POST /api/objects/replace {space,id,src,size,pivot}  a box object becomes a .glb model in its place (every recording follows)
POST /api/objects/delete {space,id}  remove one that no recording places
POST /api/segment {space}        split the chosen scan into the layout's surfaces again (scripts/segment_surfaces.py)
POST /api/layout {space,objects,openings}  the scene layout as edited (scan/semantic.json)
POST /api/scan/primary {space,scan}  choose which of the space's scans is used (all are already in the space's coordinates)
POST /api/register {space,take,target?}  align a recording again; target {surfaces, boxes}: what it shows (scripts/align_recording.py)
POST /api/align-manual {space,take,toSpace,info}   toSpace from point pairs picked in the editor
POST /api/rename {take,name}     display name of a recording (spaces/names.json)

Agent (a local coding agent plays the spatial assistant: scripts/agent-bridge.mjs runs Codex, which calls back through scripts/mcp.mjs).
Questions and responses live in conversations ("sessions" in the UI), see scripts/agent_store.py:
GET  /api/agent/command?session=                   pastable shell command that starts the bridge for this scene
GET  /api/agent/conversations?session=             list; POST /api/agent/conversations {session,name?} creates an empty one
POST /api/agent/conversations/rename|import         {session,conversation,name} | {session,data}; GET …/export?session=&conversation=
POST /api/agent/questions {session,conversation,frame,t,text,live?}   ask at a frame (live = asked during playback); POST /api/agent/questions/delete
GET  /api/agent/status?session=&conversation=       bridge connected + the conversation's questions and responses
GET  /api/agent/questions/next?session=            bridge long-poll (≤25 s); POST /api/agent/questions/trace {session,id,step}, …/done {session,id,message,duration}
GET  /api/agent/context?session=                   household context (scenario or space context.json, else agent/mock-context.json) + the user's pose
                                                   at the question being answered, else at the frame the editor shows (POST /api/agent/state)
POST /api/agent/responses {session,…}              UI/full text; text streams use {part:'text',stream:{seq,status}} snapshots
Binds to 127.0.0.1 only; recordings must exist in private/<scene>/recordings/; a session is a scenario's spaces/<space>/scenarios/<take>/session.json.
"""
import json, re, shlex, shutil, subprocess, sys, threading, time
from urllib.parse import urlsplit, parse_qs
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import agent_store as store, spaces, composition, weather, findmy, hand_cache
busy = threading.Lock()
MOCK_CONTEXT = ROOT/'agent'/'mock-context.json'

def session_dir(session):
    """Resolve an editor session URL path (./spaces/<space>/scenarios/<take>/session.json) to its folder, refusing anything else."""
    path = (ROOT/urlsplit(str(session or '')).path.lstrip('./')).resolve()
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
    ctx['interaction'] = dict(weather_mod=bool((running or live or {}).get('weather_mod', False)),findmy_mod=bool((running or live or {}).get('findmy_mod', False)))
    if 'storage' in ctx.get('loaded_groups',[]): ctx['findmy_catalog'] = findmy.catalog(d,ctx)[0]
    if running:
        ctx['question'] = dict(id=running['id'], text=running['text'], asked_at_s=running['t'])
        live = frame_pose(d, running['frame'])
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
            store.lock.wait(deadline-time.time())

def ask(body):
    d = session_dir(body.get('session')); text = str(body.get('text') or '').strip()
    if not text: raise ValueError('Empty question.')
    frames = len(json.loads((d/'session.json').read_text())['frames']); frame = int(body.get('frame', 0))
    if not 0 <= frame < frames: raise ValueError('Frame out of range.')
    with store.lock: return store.ask(d, body.get('conversation'), frame, float(body.get('t', 0)), text, body.get('live'), body.get('weather_mod', False), body.get('text_response'), body.get('findmy_mod', False))

def agent_get(path, session, q):
    if path == '/api/agent/questions/next': return next_question(session)
    d = session_dir(session); cid = q.get('conversation', [''])[0]
    with store.lock:
        store._prepare(d)
        if path == '/api/agent/conversations': return store.listing(d)
        if path == '/api/agent/conversations/export': return store.read(d, cid)
        if path == '/api/agent/status': return store.status(d, cid)
    raise KeyError(path)

def agent_post(path, body):
    if path == '/api/agent/questions': return ask(body)
    d = session_dir(body.get('session')); cid = body.get('conversation')
    with store.lock:
        store._prepare(d)
        if path == '/api/agent/state': store.editor_state[str(d)] = {k: body.get(k) for k in ('conversation', 'frame', 't', 'position', 'quaternion', 'forward', 'weather_mod', 'findmy_mod')}; return dict(ok=True)
        if path == '/api/agent/conversations': return store.create(d, body.get('name'))
        if path == '/api/agent/conversations/delete': return store.delete_conversation(d, cid)
        if path == '/api/agent/conversations/rename': return store.rename(d, cid, body.get('name'))
        if path == '/api/agent/conversations/import': return store.import_conversation(d, body.get('data'))
        if path == '/api/agent/questions/delete': return store.delete_question(d, cid, body.get('id'))
        if path == '/api/agent/questions/trace': store.bridge_seen[str(d)] = time.time(); return store.add_trace(d, body.get('id'), body.get('step'))
        if path == '/api/agent/questions/done': store.bridge_seen[str(d)] = time.time(); return store.finish(d, body.get('id'), body.get('message'), body.get('duration'))
        if path == '/api/agent/responses': return store.add_response(d, body)
    raise KeyError(path)

class Server(ThreadingHTTPServer):
    # Playback fetches an image and a depth map per frame while bridges long-poll; the default listen backlog of 5 overflows and
    # the browser sees reset connections (a failed module load leaves the editor blank).
    request_queue_size = 256
    daemon_threads = True

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.cjs': 'text/javascript', '.wasm': 'application/wasm'}
    # Keep-alive: one connection carries many requests instead of a new one per frame.
    protocol_version = 'HTTP/1.1'
    def send_head(self):
        # Local bridge credentials must never be exposed by the editor's static file server.
        target = Path(self.translate_path(self.path)).resolve()
        if target.name == 'agent-config.local.json':
            self.send_error(404, 'Not found')
            return None
        return super().send_head()
    def end_headers(self):
        # Editor modules change while developing; never serve stale copies.
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, fmt, *args):
        if not any(p in self.path for p in ('/api/agent/state', '/api/agent/status', '/api/agent/questions/next')): super().log_message(fmt, *args)
    def reply(self, status, body):
        data = json.dumps(body).encode(); self.send_response(status)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
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
        if url.path == '/api/spaces': return self.reply(200, dict(spaces=spaces.listing(), takes=spaces.takes(), meshAvailable=spaces.MESH_PYTHON.is_file()))
        if url.path == '/api/agent/command':
            try: return self.reply(200, dict(command=agent_command(session, self.headers.get('Host', '127.0.0.1:8766')), config_path=str(ROOT/'agent-config.local.json'), gemini_setup_command=' '.join(map(shlex.quote,[shutil.which('node') or 'node',str(ROOT/'scripts/gemini-setup.mjs')])), restart_command=' '.join(map(shlex.quote, ['npm', '--prefix', str(ROOT), 'start']))))
            except ValueError as e: return self.reply(400, dict(error=str(e)))
        if url.path == '/api/agent/context':
            try: return self.reply(200, agent_context(session, q.get('groups', [None])[0].split(',') if q.get('groups', [None])[0] else ([] if 'catalog' in q else None), q.get('question_id', [None])[0]))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        if url.path.startswith('/api/agent/'):
            try: return self.reply(200, agent_get(url.path, session, q))
            except KeyError: return self.reply(404, dict(error='Not found'))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        super().do_GET()
    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/agent/'):
            try: return self.reply(200, agent_post(path, json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')))
            except KeyError: return self.reply(404, dict(error='Not found'))
            except (ValueError, OSError, TypeError) as e: return self.reply(400, dict(error=str(e)))
        # With keep-alive, the body must always be read, or it would be parsed as the next request.
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        if path == '/api/hands':
            try: return self.reply(200, hand_cache.write(session_dir(body.get('session')), body.get('frame'), body.get('token'), body.get('data') or {}))
            except (ValueError, OSError, TypeError) as e: return self.reply(400, dict(error=str(e)))
        quick = {'/api/spaces': lambda: spaces.create(body.get('name')), '/api/rename': lambda: spaces.rename(body.get('take'), body.get('name')),
            '/api/layout': lambda: spaces.save_layout(body.get('space'), body.get('objects'), body.get('openings'), body.get('revision')),
            # A recording's own components, or (scope 'scene') the scene's, shared by all its recordings.
            '/api/composition': lambda: composition.save(spaces.space_dir(body.get('space')), body.get('components'), body.get('revision')) if body.get('scope') == 'scene'
                else composition.save(session_dir(body.get('session')), body.get('components'), body.get('revision')),
            '/api/objects': lambda: composition.add_object(spaces.space_dir(body.get('space')), body.get('name'), body.get('kind'), body.get('size'), body.get('src'), body.get('origin'), body.get('pose')),
            '/api/objects/update': lambda: composition.update_object(spaces.space_dir(body.get('space')), body.get('id'), body.get('name'), body.get('shape'), body.get('pose'), body.get('origin')),
            '/api/objects/replace': lambda: composition.replace_object(spaces.space_dir(body.get('space')), body.get('id'), body.get('src'), body.get('size'), body.get('pivot')),
            '/api/objects/delete': lambda: composition.remove_object(spaces.space_dir(body.get('space')), body.get('id')),
            '/api/scan/primary': lambda: spaces.set_primary(body.get('space'), body.get('scan')),
            '/api/align-manual': lambda: spaces.align_manually(body.get('space'), body.get('take'), body.get('toSpace'), body.get('info'))}.get(path)
        if quick:
            try: return self.reply(200, quick())
            except (spaces.Conflict, composition.Conflict) as e: return self.reply(409, dict(error=str(e)))
            except (ValueError, OSError) as e: return self.reply(400, dict(error=str(e)))
        action = {'/api/scenarios': spaces.add_scenario, '/api/register': lambda space, take: spaces.register(space, take, body.get('target')), '/api/segment': lambda space, take: spaces.segment(space)}.get(path)
        if not action: return self.reply(404, dict(error='Not found'))
        if not busy.acquire(blocking=False): return self.reply(409, dict(error='Another job is running.'))
        try:
            self.reply(200, action(body.get('space'), body.get('take')))
        except (ValueError, OSError) as e: self.reply(400, dict(error=str(e)))
        finally: busy.release()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    http = Server(('127.0.0.1', port), partial(Handler, directory=str(ROOT)))
    print(f'http://127.0.0.1:{http.server_port}', flush=True); http.serve_forever()
