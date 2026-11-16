"""ModOS registry: the core primitive representations (modos/primitives.json, fixed by the authors) and the MODs composed from them.

System MODs live in modos/mods/<id>.json. A space can add its own (authored by its owner or its users) in
spaces/<space>/modos/mods/<id>.json, and chooses which MODs are installed in spaces/<space>/modos/installed.json
({"installed": [ids]}; missing: every MOD whose scope fits the space). Installing a MOD is also when the external feeds it
needs start being cached (scripts/modos_cache.py).

A MOD is data, never code: what it knows (knowledge refs), where it belongs (scope), how it may appear (slots, each one primitive
representation with an anchor rule), what is decided at runtime (selectors) and which slot carries the answer text. validate()
checks a MOD against the primitives so a broken one is refused at load time, not mid-answer.
No dependencies: used by the server and tests."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODOS = ROOT/'modos'
SELECTOR_KINDS = {'enum', 'pick-one', 'pick-many'}

def _json(p):
    return json.loads(Path(p).read_text())

def primitives():
    """{id: spec} of the core primitive representations, plus the fixed item types and anchor kinds."""
    data = _json(MODOS/'primitives.json')
    return {p['id']: p for p in data['primitives']}, set(data['item_types']), set(data['anchor_kinds'])

def validate(mod, prims=None):
    """Raise ValueError naming the first problem; return the MOD unchanged when it is sound."""
    specs, types, anchors = prims or primitives()
    mid = mod.get('id')
    if not isinstance(mid, str) or not mid: raise ValueError('A MOD needs an id.')
    for key in ('description', 'slots'):
        if not mod.get(key): raise ValueError(f'MOD {mid} needs {key}.')
    scope = mod.get('scope', 'global')
    if not (scope in ('global', 'referent') or isinstance(scope, list) and scope and all(isinstance(s, str) for s in scope)):
        raise ValueError(f'MOD {mid}: scope is global, referent, or a list of entity ids.')
    for k in mod.get('knowledge', []):
        if 'type' in k and k['type'] not in types: raise ValueError(f'MOD {mid}: unknown item type {k["type"]}.')
    selectors = mod.get('selectors', {})
    for name, sel in selectors.items():
        if sel.get('kind') not in SELECTOR_KINDS: raise ValueError(f'MOD {mid}: selector {name} must be enum, pick-one or pick-many.')
        if sel.get('from') == 'allowed' and not sel.get('allowed'): raise ValueError(f'MOD {mid}: selector {name} picks from an empty allowed list.')
    ids = set()
    for slot in mod['slots']:
        sid, use = slot.get('id'), slot.get('use')
        if not sid or sid in ids: raise ValueError(f'MOD {mid}: slots need unique ids.')
        ids.add(sid)
        if use not in specs: raise ValueError(f'MOD {mid}: slot {sid} uses unknown primitive representation {use}.')
        data = slot.get('data')
        if data is not None and data not in selectors: raise ValueError(f'MOD {mid}: slot {sid} reads unknown selector {data}.')
        a = slot.get('anchor') or {}
        kind = a.get('kind') or ('surface' if a.get('order') else None)
        if kind not in anchors: raise ValueError(f'MOD {mid}: slot {sid} has no valid anchor.')
        if kind == 'relative' and a.get('to') not in [s.get('id') for s in mod['slots']]: raise ValueError(f'MOD {mid}: slot {sid} is relative to an unknown slot.')
    if mod.get('text') and mod['text'] not in ids: raise ValueError(f'MOD {mid}: text slot {mod["text"]} is not one of its slots.')
    if mod.get('text') and next(s for s in mod['slots'] if s['id'] == mod['text'])['use'] != 'situated-text':
        raise ValueError(f'MOD {mid}: the text slot must be a situated-text.')
    return mod

def _mod_files(space=None):
    files = sorted((MODOS/'mods').glob('*.json'))
    if space: files += sorted((Path(space)/'modos'/'mods').glob('*.json'))
    return files

def all_mods(space=None):
    """{id: MOD} of the system MODs and the space's own (a space MOD with the same id replaces the system one)."""
    prims = primitives(); out = {}
    for f in _mod_files(space):
        mod = validate(_json(f), prims); out[mod['id']] = mod
    return out

def _fits(mod, entities):
    scope = mod.get('scope', 'global')
    return scope in ('global', 'referent') or any(e in entities for e in scope)

def installed(space, entities=None):
    """The MODs installed in a space, in a stable order. entities: the space's entity ids, used for the default (every MOD whose
    scope fits the space) when the space has no installed.json."""
    mods = all_mods(space); path = Path(space)/'modos'/'installed.json'
    if path.is_file():
        ids = _json(path).get('installed', [])
        unknown = [i for i in ids if i not in mods]
        if unknown: raise ValueError('Unknown installed MOD: '+', '.join(unknown))
        return [mods[i] for i in ids]
    return [m for m in mods.values() if entities is None or _fits(m, entities)]

def install(space, mod_id):
    """Install a MOD in a space and start caching the feeds it needs. Returns the installed ids."""
    import modos_cache
    mods = all_mods(space)
    if mod_id not in mods: raise ValueError('Unknown MOD.')
    path = Path(space)/'modos'/'installed.json'
    ids = _json(path).get('installed', []) if path.is_file() else []
    if mod_id not in ids: ids.append(mod_id)
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps({'installed': ids}, indent=1))
    modos_cache.ensure(space, [mods[mod_id]])
    return ids

def feeds(mods):
    """The external feeds the MODs need (knowledge refs feed:<id>)."""
    return sorted({k['ref'].split(':', 1)[1] for m in mods for k in m.get('knowledge', []) if str(k.get('ref', '')).startswith('feed:')})
