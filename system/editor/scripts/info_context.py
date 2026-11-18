"""Info context: information attached to things of the space, next to the user context (scripts/user_context.py) in the system context.
A piece of furniture, a door or window (scan/semantic.json objects/openings `info`), a zone (rooms[] `info`) or a persistent scene
object (composition.json components[] `info`) can carry an info key (by default its own name; several may share one). Each key has a
value: text, or a file in the space's info lib. Targets are named as the object mod names them: layout:<box id>, comp:<component id>,
zone:<zone id>.

spaces/<space>/info/context.json  {"entries": {key: {"text": "..."} | {"file": "<path inside lib/>"}}}
spaces/<space>/info/lib/          the files values link to (added from the editor, or copied in by hand)

Not part of get_user_context: the agent gets one key's value (payload) when the user selects a thing carrying it, or asks a follow-up
about the one of the previous turn (scripts/jev-pipeline.mjs).
No dependencies: used by the server and tests."""
import base64, json, mimetypes, re
from pathlib import Path

TEXT_MAX = 20000
FILE_MAX = 25*1024*1024
FILE_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,95}$')

def key(label):
    """The key of an information box: the last part of its label path, trimmed ("fridge/manual" → "manual"); None if empty."""
    parts = [p.strip() for p in str(label or '').split('/') if p.strip()]
    return parts[-1][:48] if parts else None

def root(d):
    """The space folder for a space or one of its scenarios (spaces/<space>/scenarios/<take>)."""
    d = Path(d)
    return d if (d/'space.json').is_file() or not (d.parent.parent/'space.json').is_file() else d.parent.parent

def _paths(d):
    base = root(d)/'info'
    return base/'context.json', base/'lib'

def lib_files(d):
    """Files in the lib, as paths relative to it, sorted."""
    _, lib = _paths(d)
    return sorted(p.relative_to(lib).as_posix() for p in lib.rglob('*') if p.is_file() and not p.name.startswith('.')) if lib.is_dir() else []

def read(d):
    """{entries, lib}: every key's value, and the files in the lib."""
    ctx, _ = _paths(d)
    raw = json.loads(ctx.read_text()) if ctx.is_file() else {}
    return dict(entries=raw.get('entries', {}), lib=lib_files(d))

def _lib_file(d, name):
    _, lib = _paths(d)
    p = (lib/str(name)).resolve()
    if not p.is_relative_to(lib.resolve()) or not p.is_file(): raise ValueError('No such file in the info lib: '+str(name))
    return p

def set_value(d, name, value):
    """A key's value: {text} or {file} (a file already in the lib); None or {} clears it. Returns read(d)."""
    k = key(name)
    if not k or k != str(name).strip(): raise ValueError('Bad info key.')
    if value is not None and not isinstance(value, dict) or value and (set(value) - {'text', 'file'} or len(value) != 1):
        raise ValueError('An info value is text or a file.')
    ctx, _ = _paths(d)
    raw = json.loads(ctx.read_text()) if ctx.is_file() else {}
    entries = raw.setdefault('entries', {})
    if not value or value.get('text') is not None and not str(value['text']).strip(): entries.pop(k, None)
    elif 'text' in value:
        if not isinstance(value['text'], str) or len(value['text']) > TEXT_MAX: raise ValueError(f'Info text is at most {TEXT_MAX} characters.')
        entries[k] = dict(text=value['text'])
    else:
        _lib_file(d, value['file']); entries[k] = dict(file=Path(str(value['file'])).as_posix())
    ctx.parent.mkdir(parents=True, exist_ok=True); ctx.write_text(json.dumps(raw, indent=1, ensure_ascii=False))
    return read(d)

def add_file(d, name, src):
    """A file added to the lib (src: a data URL). An existing file is not replaced. Returns read(d)."""
    name = str(name or '').strip()
    if not FILE_NAME.match(name) or name in ('.', '..'): raise ValueError('Bad file name.')
    if not (isinstance(src, str) and src.startswith('data:') and ',' in src): raise ValueError('A file must be a data URL.')
    data = base64.b64decode(src.split(',', 1)[1])
    if len(data) > FILE_MAX: raise ValueError('The file is larger than 25 MB.')
    _, lib = _paths(d); p = lib/name
    if p.exists(): raise ValueError(f'{name} is already in the info lib.')
    lib.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
    return read(d)

def lookup(d, name):
    """One key's value: {key, text} or {key, file, path} (path: absolute, for reading it), or None."""
    k = key(name); v = read(d)['entries'].get(k) if k else None
    if not v: return None
    if 'file' in v: return dict(key=k, file=v['file'], path=str(_lib_file(d, v['file'])))
    return dict(key=k, text=v['text'])

# Files the answer model reads: text as text; PDFs and images as the file itself (Gemini reads them; inline data stays well under its 20 MB
# request limit); anything else by name only.
TEXT_TYPES = {'.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json'}
FILE_TYPES = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif'}
PAYLOAD_MAX = 15*1024*1024

def payload(d, name):
    """One key's value for the answer model: {key, text} | {key, file: {name, mime_type, text | data (base64) | unreadable}} | {key, missing}."""
    v = lookup(d, name); k = key(name)
    if not v: return dict(key=k, missing=True)
    if 'text' in v: return dict(key=k, text=v['text'])
    p = Path(v['path']); ext = p.suffix.lower(); f = dict(name=v['file'])
    if ext in TEXT_TYPES: f.update(mime_type=TEXT_TYPES[ext], text=p.read_text(errors='replace')[:TEXT_MAX*5])
    elif ext in FILE_TYPES and p.stat().st_size <= PAYLOAD_MAX: f.update(mime_type=FILE_TYPES[ext], data=base64.b64encode(p.read_bytes()).decode())
    else: f.update(mime_type=mimetypes.guess_type(p.name)[0] or 'application/octet-stream', unreadable=True)
    return dict(key=k, file=f)

def clean_key(value):
    """An info key as attached to a thing: trimmed, at most 48 characters, no '/'; None for none."""
    if value is None or value == '': return None
    k = str(value).strip()[:48]
    if not k or '/' in k: raise ValueError('Bad info key.')
    return k

def targets(d, sem, session=None):
    """Every thing of the space carrying info: {target id: key} (layout:, comp:, zone:). session: a recording folder, whose placed scene
    objects carry their library object's info (spaces/<space>/components/<id>/component.json `info`)."""
    out = {}
    for b in sem.get('objects', [])+sem.get('openings', []):
        if b.get('info'): out['layout:'+b['id']] = b['info']
    for r in sem.get('rooms', []):
        if r.get('info'): out['zone:'+r['id']] = r['info']
    comp = root(d)/'composition.json'
    if comp.is_file():
        for c in json.loads(comp.read_text()).get('components', []):
            if c.get('info') and c.get('category') == 'persistent': out['comp:'+c['id']] = c['info']
    if session and (Path(session)/'composition.json').is_file():
        for c in json.loads((Path(session)/'composition.json').read_text()).get('components', []):
            entry = root(d)/'components'/str(c.get('component'))/'component.json'
            k = json.loads(entry.read_text()).get('info') if entry.is_file() and c.get('id') else None
            if k: out['comp:'+c['id']] = k
    return out

CUES = ('gaze', 'point', 'touch', 'zone')
def selection(d, sem, value, mode, session=None):
    """A user selection sent with a question (src/user-selection.mjs), checked against the space: {box_id (a target id), key, score,
    cues, mode}. The key is the one the target carries, not the request's. A zone (the user standing in it) is a weak candidate: Jev
    always judges it (mode 'jev'). An id without a prefix is a layout box (older questions). None when there is none."""
    if value is None: return None
    if not isinstance(value, dict): raise ValueError('Bad selection.')
    tid = str(value.get('box_id') or '');tid = tid if ':' in tid else 'layout:'+tid
    k = targets(d, sem, session).get(tid)
    if not k: raise ValueError('Selected thing carries no info in this scene.')
    num = lambda v: isinstance(v, (int, float)) and 0 <= v <= 1
    cues = value.get('cues') or {}
    if not num(value.get('score')) or not isinstance(cues, dict) or any(not num(cues.get(c, 0)) for c in CUES): raise ValueError('Bad selection score.')
    if mode not in ('jev', 'score'): raise ValueError('Selection mode is jev or score.')
    return dict(box_id=tid, key=k, score=round(float(value['score']), 3),
                cues={c: round(float(cues.get(c, 0)), 3) for c in CUES if c != 'zone' or cues.get('zone')}, mode='jev' if tid.startswith('zone:') else mode)
