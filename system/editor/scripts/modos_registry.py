"""ModOS registry: the core primitive representations (modos/primitives.json, fixed by the authors) and the MODs composed from them.

Three layers make the MODs a space uses (modos-system-design.md 7):
  base       system MODs in modos/mods/<id>.json (and full MODs a space ships in spaces/<space>/modos/mods/<id>.json)
  overrides  how a space tailors a base MOD, in spaces/<space>/modos/custom.json "overrides": {<id>: customization}
  forks      new MODs derived from a base one, in custom.json "forks": [{id, from, name, description?, ...customization}]

A customization changes only what a MOD lets people change, never its code, where it applies or what it knows:
  variant      one of the MOD's representation variants (which slots it shows; the MOD's author defines them)
  settings     {slot: {param: value}} for a slot param of kind `setting` (duration, lock)
  description  what it is for, and examples: questions it answers (both replace the author's: the decision model chooses MODs by them)

effective(base, customization) resolves all of this into the plain MOD the pipeline reads: `slots` holds only the active ones,
`text` names the text slot (or is absent), and each slot's params carry {fixed: value} where the author settled them.
Installing a MOD is when the external feeds it needs start being cached (scripts/modos_cache.py). No dependencies."""
import copy, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODOS = ROOT/'modos'
SELECTOR_KINDS = {'enum', 'pick-one', 'pick-many'}
TEXT_USES = {'situated-text', 'action-card'}
ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,47}$')
CUSTOM_KEYS = {'variant', 'settings', 'description', 'examples'}   # whether a MOD shows text is its variant's text slot

def _json(p):
    return json.loads(Path(p).read_text())

def primitives():
    """{id: spec} of the core primitive representations, plus the fixed item types and anchor kinds."""
    data = _json(MODOS/'primitives.json')
    return {p['id']: p for p in data['primitives']}, set(data['item_types']), set(data['anchor_kinds'])

def _check_scope(mid, scope):
    if not (scope in ('global', 'referent') or isinstance(scope, list) and scope and all(isinstance(s, str) for s in scope)):
        raise ValueError(f'MOD {mid}: scope is global, referent, or a list of entity ids.')

# A slot's `ui` (modos-system-design.md 4.4): which spatial UI it draws. `fixed` parts are always drawn; each `flexible` part is drawn when
# its `when` holds (a rule over the target, the data and the request, evaluated without a model) and may stand `instead_of` a fixed one.
# Parts are library cues, or the MOD's own `ambient:`, `asset:` and `text:` parts; `iconButton:<preset>` names a preset button.
CUES = {'breathingBox', 'cornerBrackets', 'footprintRing', 'floorArea', 'doorwayGlow', 'arrowAhead', 'floorPath', 'gauge', 'progressRail',
        'pinnedTags', 'statusPulse', 'cardStack', 'slider', 'choice', 'iconButton', 'textButton', 'datePicker', 'playback', 'tetherSend',
        'bodyArrow', 'textInput', 'arPhoto', 'textArrow'}
# Text forms of the library (not cues): text floating by its anchor, written onto a surface, or spoken by an object.
TEXT_FORMS = {'floatingText', 'embeddedText', 'dialogue'}
UI_OWN = ('ambient:', 'asset:')
WHEN_FACTS = {'target.has_content', 'target.out_of_view', 'target.other_room', 'target.door_in_view', 'user.in_target', 'data.days',
              'data.steps_per_day', 'value.type', 'value.io', 'intent', 'preset.found', 'state.level', 'question.about', 'surface.score', 'target.pointed', 'request.second_person', 'attachment.kind', 'text.apart'}

def _check_ui(mid, sid, ui):
    def part(p):
        if p.startswith(UI_OWN): return
        if p in TEXT_FORMS: return
        cue, _, preset = p.partition(':')
        if cue not in CUES or (preset and cue != 'iconButton'): raise ValueError(f'MOD {mid}: slot {sid} draws unknown UI {p}.')
    for p in ui.get('fixed', []): part(p)
    for f in ui.get('flexible', []):
        part(f.get('cue', ''))
        drawn = set(ui.get('fixed', []))|{x.get('cue') for x in ui.get('flexible', [])}
        for gone in ([f['instead_of']] if isinstance(f.get('instead_of'), str) else f.get('instead_of') or []):
            if gone not in drawn: raise ValueError(f'MOD {mid}: slot {sid} replaces {gone}, which it does not draw.')
        for term in str(f.get('when', '')).split('&'):
            fact = re.split(r'[=!<>]', term.strip().lstrip('!'), maxsplit=1)[0]
            if fact not in WHEN_FACTS: raise ValueError(f'MOD {mid}: slot {sid} decides on unknown fact {fact!r}.')

def validate(mod, prims=None):
    """Raise ValueError naming the first problem; return the MOD unchanged when it is sound."""
    specs, types, anchors = prims or primitives()
    mid = mod.get('id')
    if not isinstance(mid, str) or not mid: raise ValueError('A MOD needs an id.')
    for key in ('description', 'slots'):
        if not mod.get(key): raise ValueError(f'MOD {mid} needs {key}.')
    _check_scope(mid, mod.get('scope', 'global'))
    for k in mod.get('knowledge', []):
        if 'type' in k and k['type'] not in types: raise ValueError(f'MOD {mid}: unknown item type {k["type"]}.')
    selectors = mod.get('selectors', {})
    for name, sel in selectors.items():
        if sel.get('kind') not in SELECTOR_KINDS: raise ValueError(f'MOD {mid}: selector {name} must be enum, pick-one or pick-many.')
        if sel.get('from') == 'allowed' and not sel.get('allowed'): raise ValueError(f'MOD {mid}: selector {name} picks from an empty allowed list.')
    ids = [s.get('id') for s in mod['slots']]
    if len(set(ids)) != len(ids) or not all(ids): raise ValueError(f'MOD {mid}: slots need unique ids.')
    for slot in mod['slots']:
        sid, use = slot['id'], slot.get('use')
        if use not in specs: raise ValueError(f'MOD {mid}: slot {sid} uses unknown primitive representation {use}.')
        for data in ([slot['data']] if isinstance(slot.get('data'), str) else slot.get('data') or []):
            if data not in selectors: raise ValueError(f'MOD {mid}: slot {sid} reads unknown selector {data}.')
        a = slot.get('anchor') or {}
        kind = a.get('kind') or ('surface' if a.get('order') else None)
        if kind not in anchors: raise ValueError(f'MOD {mid}: slot {sid} has no valid anchor.')
        if kind == 'relative' and a.get('to') not in ids: raise ValueError(f'MOD {mid}: slot {sid} is relative to an unknown slot.')
        if slot.get('ui'): _check_ui(mid, sid, slot['ui'])
        for pname, p in (slot.get('params') or {}).items():
            spec = specs[use]['params'].get(pname)
            if spec is None: raise ValueError(f'MOD {mid}: slot {sid} sets unknown param {pname}.')
            values = spec.get('values')
            for v in ([p['fixed']] if 'fixed' in p else [])+p.get('allowed', []):
                if values and v not in values: raise ValueError(f'MOD {mid}: {sid}.{pname} cannot be {v!r} (one of {", ".join(values)}).')
    variants = (mod.get('variants') or {}) if 'customization' not in mod else {}   # an effective MOD shows one variant's slots
    for vid, v in variants.items():
        bad = [s for s in v.get('slots', []) if s not in ids]
        if not v.get('slots') or bad: raise ValueError(f'MOD {mid}: variant {vid} names unknown slots.')
        if v.get('text') and v['text'] not in v['slots']: raise ValueError(f'MOD {mid}: variant {vid} puts text in a slot it does not show.')
    if variants and mod.get('default_variant') not in variants: raise ValueError(f'MOD {mid}: default_variant must be one of its variants.')
    if mod.get('text'):
        if mod['text'] not in ids: raise ValueError(f'MOD {mid}: text slot {mod["text"]} is not one of its slots.')
        if next(s for s in mod['slots'] if s['id'] == mod['text'])['use'] not in TEXT_USES:
            raise ValueError(f'MOD {mid}: the text slot must be a situated-text or an action-card.')
    return mod

def effective(base, custom=None, prims=None):
    """The plain MOD the pipeline reads: base + one customization, with the active variant's slots and settled params."""
    specs = (prims or primitives())[0]
    custom = custom or {}
    unknown = set(custom)-CUSTOM_KEYS-{'id', 'from', 'name'}
    if unknown: raise ValueError('Unknown customization: '+', '.join(sorted(unknown)))
    mod = copy.deepcopy(base); variants = base.get('variants') or {}
    variant = custom.get('variant') or base.get('default_variant')
    if variants:
        if variant not in variants: raise ValueError(f'MOD {base["id"]} has no variant {variant}.')
        active, text = variants[variant]['slots'], variants[variant].get('text')
    elif custom.get('variant'): raise ValueError(f'MOD {base["id"]} has no variant {custom["variant"]}.')
    else: active, text = [s['id'] for s in base['slots']], base.get('text')
    settings = custom.get('settings') or {}
    for sid, params in settings.items():
        slot = next((s for s in base['slots'] if s['id'] == sid), None)
        if slot is None: raise ValueError(f'MOD {base["id"]} has no slot {sid}.')
        for pname, value in params.items():
            spec = specs[slot['use']]['params'].get(pname)
            if not spec or spec['kind'] != 'setting': raise ValueError(f'{sid}.{pname} cannot be set by hand.')
            allowed = (slot.get('params', {}).get(pname, {}).get('allowed')) or spec.get('values')
            if value not in allowed: raise ValueError(f'{sid}.{pname} cannot be {value!r}.')
    mod['slots'] = []
    for s in base['slots']:
        if s['id'] not in active: continue
        s = copy.deepcopy(s); params = s.setdefault('params', {})
        for pname, spec in specs[s['use']]['params'].items():
            if spec['kind'] == 'setting': params.setdefault(pname, {})['fixed'] = settings.get(s['id'], {}).get(pname, params.get(pname, {}).get('fixed', spec['default']))
            elif pname in settings.get(s['id'], {}): params.setdefault(pname, {})['fixed'] = settings[s['id']][pname]
        if not params: s.pop('params')
        mod['slots'].append(s)
    for s in mod['slots']:   # a slot placed relative to a hidden slot falls back to that slot's anchor
        a = s.get('anchor') or {}
        if a.get('kind') == 'relative' and a['to'] not in active: s['anchor'] = next(x['anchor'] for x in base['slots'] if x['id'] == a['to'])
    if text: mod['text'] = text
    else: mod.pop('text', None)
    if 'description' in custom:
        d = custom['description']
        if not (isinstance(d, str) and d.strip() and len(d) <= 400): raise ValueError(f'MOD {base["id"]}: a description is 1-400 letters.')
        mod['description'] = d.strip()
    if 'examples' in custom:
        ex = custom['examples']
        if not (isinstance(ex, list) and len(ex) <= 12 and all(isinstance(e, str) and e.strip() and len(e) <= 160 for e in ex)):
            raise ValueError(f'MOD {base["id"]}: examples are up to 12 questions.')
        mod['examples'] = [e.strip() for e in ex]
    mod['variant'] = variant if variants else None
    mod['customization'] = {k: v for k, v in custom.items() if k in CUSTOM_KEYS}
    return mod

def _custom_path(space):
    return Path(space)/'modos'/'custom.json'

def custom(space):
    """{overrides: {id: customization}, forks: [fork]} of a space."""
    try: c = _json(_custom_path(space)) if space else {}
    except (OSError, ValueError): c = {}
    return dict(overrides=c.get('overrides', {}), forks=c.get('forks', []))

def _save_custom(space, c):
    p = _custom_path(space); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(c, indent=1, ensure_ascii=False))

def extend(raw, bases):
    """A MOD that extends another (`extends`: its id) is the base with these changes: `slots`, `selectors` and `variants` merge by id
    (a null entry removes the base's), every other field given replaces the base's. LabInfo extends WorldInfo this way: the same
    answer about a place, plus a diorama on the lab table."""
    if not raw.get('extends'): return raw
    base = bases.get(raw['extends'])
    if base is None: raise ValueError(f'MOD {raw.get("id")} extends an unknown MOD.')
    mod = copy.deepcopy(base)
    for k, v in raw.items():
        if k in ('selectors', 'variants'):
            merged = dict(mod.get(k) or {}); merged.update(v)
            mod[k] = {i: x for i, x in merged.items() if x is not None}
        elif k == 'slots':
            own = {x['id']: x for x in v}; slots = [own.pop(x['id'], x) for x in mod['slots']]+list(own.values())
            mod['slots'] = [x for x in slots if x.get('use') is not None]
        else: mod[k] = v
    for k in ('text',): mod.pop(k, None) if mod.get('variants') else None
    return mod

def base_mods(space=None):
    """{id: MOD} as written: system MODs (the foundational ones), then the space's own MODs (same id replaces), which may extend a
    foundational MOD."""
    prims = primitives(); out = {}
    for f in sorted((MODOS/'mods').glob('*.json')):
        mod = validate(_json(f), prims); out[mod['id']] = mod
    for f in (sorted((Path(space)/'modos'/'mods').glob('*.json')) if space else []):
        mod = validate(extend(_json(f), out), prims); out[mod['id']] = mod
    return out

def all_mods(space=None):
    """{id: effective MOD}: every base MOD with the space's override applied, plus the space's forks."""
    prims = primitives(); bases = base_mods(space); c = custom(space); out = {}
    for mid, base in bases.items():
        mod = validate(effective(base, c['overrides'].get(mid), prims), prims); mod['origin'] = 'base'; out[mid] = mod
    for fork in c['forks']:
        if fork.get('from') not in bases: raise ValueError(f'Fork {fork.get("id")} comes from an unknown MOD.')
        base = dict(copy.deepcopy(bases[fork['from']]), id=fork['id'], name=fork.get('name') or fork['id'], provider='user')
        if fork.get('description'): base['description'] = fork['description']
        mod = validate(effective(base, {k: v for k, v in fork.items() if k in CUSTOM_KEYS}, prims), prims)
        mod['origin'] = 'fork'; mod['from'] = fork['from']; out[fork['id']] = mod
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
    ids = _json(path).get('installed', []) if path.is_file() else []   # the first install makes the list explicit
    if mod_id not in ids: ids.append(mod_id)
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps({'installed': ids}, indent=1))
    modos_cache.ensure(space, [mods[mod_id]])
    return ids

def uninstall(space, mod_id):
    path = Path(space)/'modos'/'installed.json'
    ids = _json(path).get('installed', []) if path.is_file() else [m['id'] for m in installed(space)]
    ids = [i for i in ids if i != mod_id]
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps({'installed': ids}, indent=1))
    return ids

def customize(space, mod_id, change):
    """Tailor a MOD of the space: a base MOD's override, or a fork's own fields. Validated before it is saved."""
    change = dict(change or {}); unknown = set(change)-CUSTOM_KEYS
    if unknown: raise ValueError('Unknown customization: '+', '.join(sorted(unknown)))
    c = custom(space); fork = next((f for f in c['forks'] if f['id'] == mod_id), None)
    if fork is not None: fork.update(change)
    elif mod_id in base_mods(space): c['overrides'][mod_id] = dict(c['overrides'].get(mod_id, {}), **change)
    else: raise ValueError('Unknown MOD.')
    _validate_custom(space, c); _save_custom(space, c); return all_mods(space)[mod_id]

def reset(space, mod_id):
    """Drop a base MOD's override (back to how its author made it)."""
    c = custom(space); c['overrides'].pop(mod_id, None); _save_custom(space, c); return all_mods(space)[mod_id]

def fork(space, from_id, new_id, name, description=None):
    """A new MOD from an existing one (its current customization is carried over); installed right away."""
    if not ID.match(new_id or ''): raise ValueError('A MOD id is lowercase letters, digits and dashes.')
    mods = all_mods(space)
    if new_id in mods: raise ValueError('That MOD id is taken.')
    if from_id not in mods: raise ValueError('Unknown MOD.')
    source = mods[from_id]; c = custom(space)
    root = source.get('from', from_id)
    entry = dict(source.get('customization', {}), id=new_id, **{'from': root}, name=name or new_id)
    if description: entry['description'] = description
    c['forks'].append(entry); _validate_custom(space, c); _save_custom(space, c)
    if (Path(space)/'modos'/'installed.json').is_file(): install(space, new_id)
    return all_mods(space)[new_id]

def remove_fork(space, mod_id):
    c = custom(space); before = len(c['forks'])
    c['forks'] = [f for f in c['forks'] if f['id'] != mod_id]
    if len(c['forks']) == before: raise ValueError('Only a fork can be removed.')
    _save_custom(space, c); uninstall(space, mod_id)

def _validate_custom(space, c):
    """Resolve every MOD with the proposed customizations before saving them."""
    prims = primitives(); bases = base_mods(space)
    for mid, o in c['overrides'].items():
        if mid in bases: validate(effective(bases[mid], o, prims), prims)
    for f in c['forks']:
        if f.get('from') not in bases: raise ValueError('A fork must come from a known MOD.')
        validate(effective(dict(bases[f['from']], id=f['id']), {k: v for k, v in f.items() if k in CUSTOM_KEYS}, prims), prims)

def feeds(mods):
    """The external feeds the MODs need (knowledge refs feed:<id>)."""
    return sorted({k['ref'].split(':', 1)[1] for m in mods for k in m.get('knowledge', []) if str(k.get('ref', '')).startswith('feed:')})

def catalog(space):
    """What the editor's MODs tab shows: each MOD of the space with what can be tailored (variants, settings of every slot the MOD
    has, its description and examples, with the author's), the current choice, and whether it is installed."""
    specs = primitives()[0]; bases = base_mods(space); c = custom(space); mods = all_mods(space)
    on = {m['id'] for m in installed(space)}
    out = []
    for mid, m in mods.items():
        base = bases[m.get('from', mid)]
        cust = m['customization']
        settings = []
        for s in base['slots']:
            for pname, spec in specs[s['use']]['params'].items():
                own = s.get('params', {}).get(pname, {})
                if spec['kind'] == 'setting':
                    values = own.get('allowed') or spec['values']
                    current = cust.get('settings', {}).get(s['id'], {}).get(pname, own.get('fixed', spec.get('default')))
                    settings.append(dict(slot=s['id'], use=s['use'], param=pname, kind=spec['kind'], values=values, value=current,
                                         active=any(x['id'] == s['id'] for x in m['slots'])))
        out.append(dict(id=mid, name=m.get('name', mid), description=m['description'], origin=m['origin'], **({'from': m['from']} if 'from' in m else {}),
                        provider=m.get('provider'), extends=m.get('extends'), installed=mid in on, variant=m['variant'], text=bool(m.get('text')),
                        variants=[dict(id=k, label=v.get('label', k), description=v.get('description', ''), slots=[dict(id=s, use=next(x['use'] for x in base['slots'] if x['id'] == s)) for s in v['slots']], text=v.get('text'))
                                  for k, v in (base.get('variants') or {}).items()],
                        settings=settings, examples=m.get('examples', []),
                        authored=dict(description=base.get('description', ''), examples=base.get('examples', [])),
                        customized=bool(cust) if m['origin'] == 'base' else True))
    return out
