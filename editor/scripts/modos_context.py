"""ModOS context info: everything the system knows about the space and the user, as items attached to the entities of the digital
twin (the context the MODs ask for; not the user's memory).

Entities are what the twin holds: zone:<id> (rooms), layout:<box> (furniture, doors, windows), comp:<id> (scene objects),
user:me, and feed:<id> (external sources). An item is one piece of knowledge about one or more entities:

    {id, about: [entity ids], type, summary, source, freshness}      (+ the body, read on demand with body())

`type` is one of the fixed item types in modos/primitives.json; `summary` is the one sentence the pipeline chooses from, so only
the chosen bodies are read. Items come from four places, read where they already live (no copy to keep in sync):

  info context   spaces/<space>/info/context.json, attached to things by their info key (scripts/info_context.py)
  authored       spaces/<space>/modos/items.json: items written for ModOS, or summaries and extra entities for an info key
  user context   the scene's context groups (scripts/user_context.py), except weather, which is external data, not the user's
  feed cache     spaces/<space>/modos/cache/<feed>.json (scripts/modos_cache.py), for the feeds of installed MODs

No dependencies beyond the other scripts: used by the server and tests."""
import json
from pathlib import Path
import info_context, user_context, findmy, modos_cache, modos_registry, modos_twin

SUMMARY_MAX = 200
# User context groups that are the user's own data, as items about user:me. Weather is not here: it is a feed.
USER_GROUPS = {
    'personal': ('user:personal', 'text'),
    'user_events': ('user:calendar', 'schedule'),
}

def _json(p, default):
    try: return json.loads(Path(p).read_text())
    except (OSError, ValueError): return default

def _space(d):
    d = Path(d)
    return d if (d/'space.json').is_file() else d.parent.parent

def _semantic(space):
    m = _json(space/'space.json', {})
    return _json(space/(m.get('semantic') or 'scan/semantic.json'), {})

def _short(text):
    t = ' '.join(str(text or '').split())
    return t if len(t) <= SUMMARY_MAX else t[:SUMMARY_MAX-1].rsplit(' ', 1)[0]+'…'

def entities(d):
    """{id: entity} of the space, from the digital twin's single entity view (scripts/modos_twin.py)."""
    return modos_twin.entities(_space(d), d if not (Path(d)/'space.json').is_file() else None)

def _info_items(d, space):
    entries = info_context.read(space)['entries']
    targets = info_context.targets(space, _semantic(space), session=d)
    about = {}
    for tid, key in targets.items(): about.setdefault(key, []).append(tid)
    items = {}
    for key, value in entries.items():
        summary = _short(value['text']) if 'text' in value else f'File: {value.get("file")}'
        items['info:'+key] = dict(id='info:'+key, about=about.get(key, []), type='text' if 'text' in value else 'file',
                                  summary=summary, source='space', freshness='static', info_key=key)
    return items

def _authored(space, items):
    """Apply spaces/<space>/modos/items.json: new items, or a summary and extra entities for an info key's item."""
    for a in _json(space/'modos'/'items.json', {}).get('items', []):
        iid = 'info:'+a['info_key'] if a.get('info_key') else a['id']
        base = items.get(iid, dict(id=iid, about=[], type=a.get('type', 'text'), source='authored', freshness='static'))
        base['about'] = list(dict.fromkeys(base.get('about', [])+a.get('about', [])))
        for k in ('summary', 'type', 'body', 'source', 'level', 'data'):
            if k in a: base[k] = a[k]
        if a.get('info_key'): base['info_key'] = a['info_key']
        items[iid] = base
    return items

def _user_items(d):
    catalog = user_context.read(d, [])
    groups = catalog.get('context_groups', {}); out = {}
    for g, (iid, typ) in USER_GROUPS.items():
        if g in groups: out[iid] = dict(id=iid, about=['user:me'], type=typ, summary=_short(groups[g]['description']), source='user', freshness='static', group=g)
    if 'storage' in groups:
        out['user:household'] = dict(id='user:household', about=['user:me'], type='text', source='user', freshness='static', group='storage',
                                     summary=_short(groups['storage']['description']))
    return out

def _feed_items(d, mods):
    space, out = _space(d), {}
    for feed in modos_registry.feeds(mods):
        entry = modos_cache.read(space, feed)
        if entry: out['feed:'+feed] = dict(id='feed:'+feed, about=['feed:'+feed], type=entry['type'], summary=entry['summary'],
                                           source='feed', freshness='cached', fetched_at=entry['fetched_at'])
    return out

def _device_state(dev):
    """A device in words, from its Outputs and Inputs: a task as its progress, a queue as how many wait, others as their values."""
    out = []
    for side in ('outputs', 'inputs'):
        for k, v in (dev.get(side) or {}).items():
            t = v.get('type')
            if t == 'task' and v.get('title'):
                k_ = min(1, (v.get('elapsed_s') or 0)/max(1, v.get('total_s') or 1))
                out.append(f"{k}: {v['title']}, {int((v.get('total') or 0)*k_)} of {v.get('total')} {v.get('unit', '')}, about {max(0, round(((v.get('total_s') or 0)-(v.get('elapsed_s') or 0))/60))} min left{' (paused)' if v.get('paused') else ''}")
            elif t == 'queue': out.append(f"{len(v.get('items') or [])} waiting in {k}")
            elif t == 'command': out.append(f"can {', '.join(v.get('commands') or [])} ({k})")
            elif t in ('toggle', 'choice', 'level', 'reading'): out.append(f"{k} {v.get('value')}{(' '+v['unit']) if v.get('unit') else ''}")
            elif t == 'alert' and v.get('items'): out.append(f"alerts: {'; '.join(a.get('message', '') for a in v['items'])}")
    return ', '.join(out)

def items(d, mods):
    """Every item of the space (without bodies), for the installed MODs' feeds."""
    space = _space(d)
    out = _authored(space, _info_items(d, space))
    out.update(_user_items(d)); out.update(_feed_items(d, mods))
    # Connected devices: one device-state item each, from the twin (the state is the twin's; IoTControl reads and changes it).
    for e in modos_twin.entities(space, d if not (Path(d)/'space.json').is_file() else None).values():
        dev = e.get('device')
        if dev: out['device:'+e['id']] = dict(id='device:'+e['id'], about=[e['id']], type='device-state', source='twin', freshness='live',
                                              summary=_short(f"{e['name']}: {_device_state(dev)}"))
    # Belongings are items of the twin; one item-location entry lists them all, so retrieval judges one summary, not every item.
    if modos_twin.belongings(space, d if not (Path(d)/'space.json').is_file() else None):
        out['user:belongings'] = dict(id='user:belongings', about=['user:me'], type='item-location', source='twin', freshness='static',
                                      summary='Where the user\'s registered belongings are kept (each item and the container it is in).')
    return list(out.values())

def body(d, item_id, mods):
    """One item's content, for the pipeline: text / file payload / structured data."""
    space = _space(d)
    if item_id.startswith('info:'):
        it = next((i for i in items(d, mods) if i['id'] == item_id), None)
        if it is None: raise ValueError('Unknown item.')
        if 'body' in it: return dict(id=item_id, type=it['type'], text=it['body'])
        return dict(id=item_id, type=it['type'], **{k: v for k, v in info_context.payload(space, it['info_key']).items() if k != 'key'})
    if item_id.startswith('feed:'):
        entry = modos_cache.read(space, item_id[5:])
        if not entry: raise ValueError('Feed not cached.')
        return dict(id=item_id, type=entry['type'], data=entry['data'], fetched_at=entry['fetched_at'])
    if item_id.startswith('device:'):
        e = modos_twin.entities(space, d if not (Path(d)/'space.json').is_file() else None).get(item_id[7:])
        if not e or not e.get('device'): raise ValueError('Unknown device.')
        return dict(id=item_id, type='device-state', data=dict(entity=e['id'], name=e['name'], **e['device']))
    if item_id == 'user:belongings':
        return dict(id=item_id, type='item-location', data=modos_twin.belongings(space, d))
    if item_id == 'user:household':
        ctx = user_context.read(d, ['storage'])
        return dict(id=item_id, type='text', data=ctx.get('objects', []))
    for g, (iid, typ) in USER_GROUPS.items():
        if item_id == iid:
            ctx = user_context.read(d, [g]); keep = {k: v for k, v in ctx.items() if k not in ('context_groups', 'loaded_groups', 'mock', 'note', 'user')}
            return dict(id=item_id, type=typ, data=keep)
    authored = next((i for i in _authored(space, {}).values() if i['id'] == item_id), None)
    if authored and 'data' in authored: return dict(id=item_id, type=authored['type'], data=authored['data'])
    if authored and 'body' in authored: return dict(id=item_id, type=authored['type'], text=authored['body'])
    raise ValueError('Unknown item.')

def snapshot(d):
    """What the pipeline reads first: the installed MODs (their feeds cached), the entities and every item's summary."""
    space = _space(d); ents = entities(d)
    mods = modos_registry.installed(space, set(ents))
    modos_cache.ensure(space, mods)
    return dict(mods=mods, entities=list(ents.values()), items=items(d, mods))
