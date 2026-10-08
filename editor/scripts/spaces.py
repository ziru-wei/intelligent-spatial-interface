"""Scenes (folders spaces/<scene>), their scans, layout and recordings (folders scenarios/<take>): Scene → Scan → Recordings.

spaces/<scene>/space.json:
  scans    exports from scanning apps (Polycam, Scaniverse, a Record3D pass fused into a mesh), each baked into scan/<id>.glb in the
           scene's coordinates (a root node carries its toSpace), with its registration
  scan     the chosen one: occlusion, text placement, the reference recordings are aligned to
  layout   the RoomPlan export the labelled boxes came from (scan/roomplan.glb); not a scan
  semantic scan/semantic.json: labelled boxes and rooms (scripts/layout.py), laid over whichever scan is chosen, editable in the editor
  frame    which export defined the coordinates (the first one added; a RoomPlan layout is a good frame: floor at y = 0, walls on axes)
Every later export is registered (scripts/register_scenario.py: gravity-locked yaw sweep, FPFH + RANSAC, point-to-plane ICP) to the
reference: the chosen scan, else the layout model.
Recordings: Record3D takes of everyday moments: scenarios/<take>/session.json with frames/, depth/, an optional room.glb of their own
and agent/ (Q&A sessions); toSpace in session.json maps the take's ARKit frame into the scene's.
Raw exports stay in private/, per scene:
  private/<scene>/scans/        exports from scanning apps (RoomPlan, Polycam, Scaniverse, a slow Record3D pass), repairs/, archive/
  private/<scene>/recordings/   Record3D "EXR + JPG sequence" exports of everyday moments there (the scene's recordings)
A recording's session.json keeps `sourcePath`, the export it was imported from. Display names (renamed in the editor) are in
spaces/names.json.

Every step is a command (python scripts/spaces.py --help); the editor server calls the same functions.
"""
import json, re, shutil, struct, subprocess, time
from pathlib import Path
import import_record3d, layout, hand_cache

ROOT = Path(__file__).resolve().parents[1]; PRIVATE = ROOT/'private'; SPACES = ROOT/'spaces'
MESH_PYTHON = ROOT/'.venv-mesh'/'bin'/'python'
NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

NAMES = SPACES/'names.json'
def names(): return json.loads(NAMES.read_text()) if NAMES.is_file() else {}
def label(take): return names().get(take, take)
def rename(take, name):
    """Display name of a recording; folders and URLs keep the original name, so a running agent bridge is unaffected."""
    known = any(t['name'] == take for t in takes()) or (SPACES.is_dir() and any((d/'scenarios'/str(take)/'session.json').is_file() for d in SPACES.iterdir()))
    if not NAME.match(str(take or '')) or not known: raise ValueError('Unknown recording: '+str(take))
    name = str(name or '').strip()[:64]
    if not name: raise ValueError('Empty name.')
    n = names(); n[take] = name; SPACES.mkdir(exist_ok=True); NAMES.write_text(json.dumps(n, indent=2, ensure_ascii=False))
    return dict(take=take, label=name)

def space_dir(name):
    if not NAME.match(str(name or '')) or not (SPACES/name/'space.json').is_file(): raise ValueError('Unknown space: '+str(name))
    return SPACES/name
def manifest(d): return json.loads((d/'space.json').read_text())
def write_manifest(d, m): (d/'space.json').write_text(json.dumps(m, indent=2))
def session_path(space, take): return f'./spaces/{space}/scenarios/{take}/session.json'

def listing():
    out = []
    for d in sorted(SPACES.iterdir()) if SPACES.is_dir() else []:
        if not (d/'space.json').is_file(): continue
        m = manifest(d); scenarios = []
        for s in sorted((d/'scenarios').iterdir()) if (d/'scenarios').is_dir() else []:
            if not (s/'session.json').is_file(): continue
            sm = json.loads((s/'session.json').read_text())
            scenarios.append(dict(name=s.name, label=label(s.name), session=session_path(d.name, s.name), depth=bool(sm.get('depth')), roomMesh=bool(sm.get('roomMesh')),
                hands=sm.get('handsPreparation'), registered=sm.get('toSpace') is not None, registration=sm.get('registration'), alignError=sm.get('alignError')))
        scan = m.get('scan')
        if scan: scan = dict(scan, label=scan.get('label') or label(scan.get('source')))
        scans = [dict(id=x['id'], label=x['label'], registration=x.get('registration'), primary=bool(scan) and x['mesh'] == scan['mesh']) for x in m.get('scans', []) if not x.get('archived')]
        sem = json.loads((d/m['semantic']).read_text()) if m.get('semantic') and (d/m['semantic']).is_file() else None
        layout_info = sem and dict(objects=len(sem.get('objects', [])), openings=len(sem.get('openings', [])), rooms=len(sem.get('rooms', [])), edited=bool(sem.get('edited')),
            surfaces=surfaces_state(d, m))
        out.append(dict(name=d.name, scan=scan, scans=scans, semantic=bool(sem), layout=layout_info, scenarios=scenarios))
    return out

def create(name):
    name = str(name or '').strip().replace(' ', '-')
    if not NAME.match(name): raise ValueError('Space names: letters, digits, . _ - (up to 64).')
    if (SPACES/name).exists(): raise ValueError('That space already exists.')
    (SPACES/name/'scenarios').mkdir(parents=True); write_manifest(SPACES/name, dict(version=1, name=name, created=time.time(), scan=None))
    return dict(name=name)

def takes():
    """Raw Record3D exports that can be recordings: private/<scene>/recordings/<take>/ (and, from before, private/<take>/), with the
    scene they belong to and the scenes they were added to (matched by the scenario's `sourcePath`, else its folder name). A take that was
    fused into a scan (a slow reconstruction pass) is a scan source, not a recording."""
    scenes = [d for d in SPACES.iterdir() if (d/'space.json').is_file()] if SPACES.is_dir() else []
    sources = {x.get('source') for d in scenes for x in manifest(d).get('scans', [])}
    added = {}
    for d in scenes:
        for sc in (d/'scenarios').iterdir() if (d/'scenarios').is_dir() else []:
            if (sc/'session.json').is_file(): added.setdefault(json.loads((sc/'session.json').read_text()).get('sourcePath') or sc.name, []).append(d.name)
    found = [(d.name, d) for d in sorted(PRIVATE.glob('*/recordings/*'))]+[(None, d) for d in sorted(PRIVATE.iterdir()) if (d/'metadata.json').is_file()] if PRIVATE.is_dir() else []
    out = []
    for scene_dir, d in found:
        if not (d/'metadata.json').is_file() or d.name in sources: continue
        rel = d.relative_to(ROOT).as_posix(); scene = d.parent.parent.name if scene_dir else None
        out.append(dict(name=d.name, label=label(d.name), scene=scene, path=rel, depthSource=(d/'depth').is_dir(), spaces=sorted(set(added.get(rel, [])+added.get(d.name, [])))))
    return out

def _take(name):
    t = next((t for t in takes() if t['name'] == name), None)
    if not t: raise ValueError('Unknown recording: '+str(name))
    return ROOT/t['path']

def _mesh(args):
    if not MESH_PYTHON.is_file(): raise ValueError('Mesh environment missing: python3 -m venv .venv-mesh && .venv-mesh/bin/pip install -r requirements-mesh.txt')
    r = subprocess.run([str(MESH_PYTHON), *map(str, args)], capture_output=True, text=True)
    if r.returncode: raise ValueError((r.stderr.strip().splitlines() or ['exit '+str(r.returncode)])[-1])
    # Open3D prints warnings to stdout; the result is the last JSON object (one line or indented).
    lines = r.stdout.splitlines()
    for i in reversed([i for i, l in enumerate(lines) if l.startswith('{')]):
        try: return json.loads('\n'.join(lines[i:]))
        except json.JSONDecodeError: continue
    raise ValueError('No result from '+Path(str(args[0])).name)

def import_take(space, take):
    """Add a recording to a scene (frames, poses, depth)."""
    d, src = space_dir(space), _take(take); dest = d/'scenarios'/take
    if not (dest/'session.json').is_file():
        import_record3d.convert(src, dest, depth=(src/'depth').is_dir())
        p = dest/'session.json'; sm = json.loads(p.read_text()); sm['sourcePath'] = src.relative_to(ROOT).as_posix(); p.write_text(json.dumps(sm, indent=2))
    elif not json.loads((dest/'session.json').read_text()).get('depth') and (src/'depth').is_dir(): import_record3d.add_depth(src, dest)
    return dict(session=session_path(space, take))

def build_mesh(space, take):
    """The scenario's own fused mesh (its frame), registered in its session.json as roomMesh."""
    d = space_dir(space); dest = d/'scenarios'/take
    if not (dest/'session.json').is_file(): raise ValueError('Add the recording to the space first.')
    return _mesh([ROOT/'scripts'/'fuse_record3d.py', _take(take), dest/'room.glb'])

def build_scan(space, source, sid=None, primary=False):
    """Fuse a slow, thorough Record3D pass (a raw export folder) into a scan of the scene (scripts/fuse_record3d.py), then add it like
    any other scan. Such a take is a scan source, not a recording."""
    src = Path(source) if Path(source).is_dir() else PRIVATE/str(source)
    if not (src/'metadata.json').is_file(): raise ValueError('Not a Record3D export: '+str(source))
    d = space_dir(space); (d/'scan').mkdir(exist_ok=True); sid = sid or 'record3d'
    raw = d/'scan'/f'{sid}.raw.glb'; report = _mesh([ROOT/'scripts'/'fuse_record3d.py', src, raw])
    try: entry = add_scan(space, raw, sid, 'Record3D (fused)', primary=primary, source=src.name)
    finally: raw.unlink(missing_ok=True)
    return dict(report, registration=entry['registration'])

# Scans from scanning apps -------------------------------------------------------------------------------------------------------
BLENDER = next((b for b in ('/Applications/Blender.app/Contents/MacOS/Blender', shutil.which('blender') or '') if b and Path(b).exists()), None)

def _glb_json(path):
    data = Path(path).read_bytes(); n = struct.unpack('<I', data[12:16])[0]
    return data, json.loads(data[20:20+n]), 20+n

def bake_transform(src, dst, to_space):
    """Lossless: a new root node carries the row-major 4x4 transform (glTF matrices are column-major); buffers and textures untouched."""
    data, gltf, end = _glb_json(src); M = [to_space[r*4+c] for c in range(4) for r in range(4)]
    scene = gltf['scenes'][gltf.get('scene', 0)]; gltf['nodes'].append(dict(name='toSpace', matrix=M, children=scene['nodes'])); scene['nodes'] = [len(gltf['nodes'])-1]
    body = json.dumps(gltf, separators=(',', ':')).encode(); body += b' '*(-len(body) % 4); rest = data[end:]
    Path(dst).write_bytes(b'glTF'+struct.pack('<II', 2, 12+8+len(body)+len(rest))+struct.pack('<I', len(body))+b'JSON'+body+rest)

def is_roomplan(glb):
    names = {n.get('name', '') for n in _glb_json(glb)[1].get('nodes', [])}
    return any(n.startswith('Floor_') for n in names) and any(n.startswith('Wall_') for n in names)

def to_glb(src, dst):
    """GLB as is; FBX (e.g. Scaniverse) through Blender, which handles units and axes (glTF is y-up, metres)."""
    src = Path(src)
    if src.suffix.lower() == '.glb': shutil.copyfile(src, dst); return
    if src.suffix.lower() != '.fbx': raise ValueError('Scans must be .glb or .fbx.')
    if not BLENDER: raise ValueError('Converting FBX needs Blender (/Applications/Blender.app).')
    script = (f"import bpy;bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.fbx(filepath={str(src)!r});"
              f"bpy.ops.export_scene.gltf(filepath={str(dst)!r},export_format='GLB')")
    r = subprocess.run([BLENDER, '-b', '--factory-startup', '--python-expr', script], capture_output=True, text=True)
    if r.returncode or not Path(dst).is_file(): raise ValueError('Blender could not convert the FBX: '+(r.stderr.strip().splitlines() or ['?'])[-1])

def reference(m, d):
    """What new scans and recordings are registered to: the chosen scan, else the layout (RoomPlan) model, else nothing (the first
    export then defines the scene's coordinates)."""
    if (m.get('scan') or {}).get('mesh'): return d/m['scan']['mesh']
    if (m.get('layout') or {}).get('mesh'): return d/m['layout']['mesh']
    return None

def _place(d, m, path, sid):
    """Convert, register to the reference (or define the frame) and bake into scan/<sid>.glb. Returns (file, toSpace, registration)."""
    tmp = d/'scan'/f'{sid}.src.glb'; to_glb(path, tmp); ref = reference(m, d)
    if ref is None or not ref.is_file():
        to_space, registration = IDENTITY, dict(method='defines-space', fitness=1.0, rmse=0.0); m['frame'] = sid
    else:
        result = _mesh([ROOT/'scripts'/'register_scenario.py', ref, '--mesh', tmp])
        to_space, registration = result['toSpace'], {k: v for k, v in result.items() if k != 'toSpace'}
    out = d/'scan'/f'{sid}.glb'; bake_transform(tmp, out, to_space); tmp.unlink()
    return out, to_space, registration

def add_scan(space, path, sid=None, title=None, primary=False, source=None):
    """Add an export from a scanning app (.glb, or .fbx through Blender). A RoomPlan export is not a scan but the layout (add_layout).
    The first export defines the scene's coordinates; later ones are registered to the reference and baked. The first scan, or one
    added with primary=True, becomes the chosen scan."""
    d = space_dir(space); (d/'scan').mkdir(exist_ok=True); path = Path(path)
    if path.suffix.lower() == '.glb' and is_roomplan(path): return add_layout(space, path)
    sid = sid or re.sub(r'[^A-Za-z0-9_.-]', '-', path.stem)[:64]; title = title or sid
    if not NAME.match(sid) or sid == 'roomplan': raise ValueError('Bad scan id: '+sid)
    m = manifest(d); m['scans'] = [x for x in m.get('scans', []) if x['id'] != sid]
    if (m.get('scan') or {}).get('id') == sid: m['scan'] = None
    out, to_space, registration = _place(d, m, path, sid)
    entry = dict(id=sid, label=title, mesh=f'scan/{sid}.glb', source=source or path.name, toSpace=to_space, registration=registration, added=time.time())
    m['scans'].append(entry)
    chosen = primary or not (m.get('scan') or {}).get('mesh')
    if chosen: m['scan'] = dict(_chosen(entry), semantic=m.get('semantic'))
    write_manifest(d, m)
    if chosen: segment(space)
    return entry

STRUCTURE = ('rooms', 'walls', 'ceilings')

def add_layout(space, path, replace_boxes=False):
    """A RoomPlan export: its labelled boxes and the room structure (rooms, walls, ceilings) become scan/semantic.json, and its model is
    kept as scan/roomplan.glb (a registration reference before any scan exists). An edited layout keeps its boxes unless replace_boxes;
    the structure is always refreshed. The same export again keeps its registration (only the extraction runs)."""
    d = space_dir(space); (d/'scan').mkdir(exist_ok=True); m = manifest(d); same = (m.get('layout') or {}).get('source') == Path(path).name
    if same and (d/m['layout']['mesh']).is_file(): out = d/m['layout']['mesh']
    else:
        out, to_space, registration = _place(d, m, path, 'roomplan')
        m['layout'] = dict(mesh='scan/roomplan.glb', source=Path(path).name, toSpace=to_space, registration=registration, added=time.time())
    sem = _mesh([ROOT/'scripts'/'semantic_from_roomplan.py', out]); (d/'scan'/'semantic.roomplan.json').write_text(json.dumps(sem, indent=1))
    work = d/'scan'/'semantic.json'; old = json.loads(work.read_text()) if work.is_file() else {}
    keep = old.get('edited') and not replace_boxes
    # Zones reshaped by hand (scripts/zones.py; kind 'zone') are kept too; walls and ceilings always come from RoomPlan.
    fresh = [k for k in STRUCTURE if not (k == 'rooms' and any(r.get('kind') == 'zone' for r in old.get('rooms', [])))]
    out = dict(old, **{k: sem[k] for k in fresh}) if keep else dict(sem, rooms=old['rooms']) if 'rooms' not in fresh else sem
    work.write_text(json.dumps(dict(layout.relate(out), revision=old.get('revision', 0)+1), indent=1))
    m['semantic'] = 'scan/semantic.json'
    if m.get('scan'): m['scan']['semantic'] = m['semantic']
    write_manifest(d, m); segment(space); return m['layout']

def _chosen(entry): return dict(id=entry['id'], mesh=entry['mesh'], source=entry['source'], label=entry['label'])

def archive_scan(space, sid, restore=False):
    """Set a scan aside (scan/archive/<id>.glb, `archived` in space.json; not offered in the editor) or bring it back. Its registration
    is kept, so restoring needs no re-alignment. The chosen scan cannot be archived."""
    d = space_dir(space); m = manifest(d); entry = next((x for x in m.get('scans', []) if x['id'] == sid), None)
    if not entry: raise ValueError('Unknown scan: '+str(sid))
    if not restore and (m.get('scan') or {}).get('id') == sid: raise ValueError('Choose another scan first.')
    src = d/entry['mesh']; dst = d/'scan'/('archive' if not restore else '')/f'{sid}.glb'
    dst.parent.mkdir(exist_ok=True); shutil.move(str(src), str(dst))
    entry['mesh'] = str(dst.relative_to(d)); entry['archived'] = not restore
    if restore: entry.pop('archived')
    write_manifest(d, m); return entry

def set_primary(space, sid):
    """Choose the scan. Every scan is baked into the scene's coordinates, so the recordings' toSpace stays valid."""
    d = space_dir(space); m = manifest(d); entry = next((x for x in m.get('scans', []) if x['id'] == sid), None)
    if not entry or entry.get('archived'): raise ValueError('Unknown or archived scan: '+str(sid))
    m['scan'] = dict(_chosen(entry), semantic=m.get('semantic')); write_manifest(d, m); segment(space); return m['scan']

def add_zone(space, name, around, margin=.1):
    """A zone RoomPlan did not capture (a laundry closet, a storage room): the floor rectangle around the given boxes. Every box's zone
    is recomputed."""
    d = space_dir(space); m = manifest(d)
    if not m.get('semantic'): raise ValueError('This scene has no layout yet.')
    p = d/m['semantic']; sem = json.loads(p.read_text()); boxes = {b['id']: b for b in sem.get('objects', [])+sem.get('openings', [])}
    zid = re.sub(r'[^a-z0-9_-]', '-', str(name).strip().lower())
    if not zid or any(r['id'] == zid for r in sem.get('rooms', [])): raise ValueError('Zone exists or bad name: '+str(name))
    missing = [i for i in around if i not in boxes]
    if missing or not around: raise ValueError('Unknown boxes: '+', '.join(missing or ['(none)']))
    floor_y = min((r.get('floorY', 0) for r in sem.get('rooms', [])), default=0.0)
    sem['rooms'] = sem.get('rooms', [])+[layout.zone_around(zid, str(name).strip(), [boxes[i] for i in around], margin, floor_y)]
    for b in boxes.values(): b['room'] = layout.room_of(sem['rooms'], b['center'])
    sem['revision'] = sem.get('revision', 0)+1; p.write_text(json.dumps(sem, indent=1)); segment(space)
    return dict(zone=zid, members=sorted(i for i, b in boxes.items() if b['room'] == zid))

def segment(space):
    """Split the chosen scan into the layout's surfaces (walls, ceilings, zone floors): scripts/segment_surfaces.py → scan/surfaces.glb
    and scan/surfaces.json. Part of scene setup; rerun when the scan, the layout boxes or the zones change (surfaces_state says so)."""
    d = space_dir(space); m = manifest(d)
    if not ((m.get('scan') or {}).get('mesh') and m.get('semantic')): return None
    return _mesh([ROOT/'scripts'/'segment_surfaces.py', d])

def surfaces_state(d, m):
    """{count, stale} of the scene's segmentation, None if it was never run. Stale: made from another scan or an older layout."""
    p = d/'scan'/'surfaces.json'
    if not p.is_file(): return None
    s = json.loads(p.read_text()); sem = json.loads((d/m['semantic']).read_text()) if m.get('semantic') and (d/m['semantic']).is_file() else {}
    return dict(count=len(s.get('surfaces', [])), stale=s.get('scan') != (m.get('scan') or {}).get('mesh') or s.get('semanticRevision') != sem.get('revision', 0))

class Conflict(ValueError): pass

def save_layout(space, objects, openings, revision=None):
    """The layout as edited in the editor (boxes added, removed, moved, resized, relabelled). revision is the one the editor loaded. The
    save is refused only if the boxes were changed since (another editor tab, or a script moving boxes: boxesRevision); structural
    writes that leave the boxes alone (doors and windows cut into walls, zones, ceiling and wall fixes) bump only `revision`, so editing
    and scene setup can run side by side."""
    d = space_dir(space); m = manifest(d)
    if not m.get('semantic'): raise ValueError('This scene has no layout yet.')
    p = d/m['semantic']; current = json.loads(p.read_text())
    if revision is not None and revision < current.get('boxesRevision', current.get('revision', 0)): raise Conflict('The layout was changed in another window. Reload to get it.')
    rev = current.get('revision', 0)+1; data = dict(layout.update(current, objects, openings), revision=rev, boxesRevision=rev); p.write_text(json.dumps(data, indent=1))
    return dict(objects=len(data['objects']), openings=len(data['openings']), revision=data['revision'])

def add_scenario(space, take):
    """Everything a recording needs to be used in the space: import, its own mesh, alignment to the scan (if there is one)."""
    import_take(space, take)
    if MESH_PYTHON.is_file() and not json.loads((space_dir(space)/'scenarios'/take/'session.json').read_text()).get('roomMesh'): build_mesh(space, take)
    _align_quietly(space, take)
    hands = prepare_hands(space, take)
    return dict(session=session_path(space, take), hands=hands)

def prepare_hands(space, take):
    """Required, resumable recording preparation; uses no agent/API credentials."""
    d = space_dir(space)/'scenarios'/take
    p = d/'session.json'
    def state(status, **extra):
        data = json.loads(p.read_text()); data['handsPreparation'] = dict(status=status, **extra)
        tmp = p.with_suffix('.hands.tmp'); tmp.write_text(json.dumps(data, indent=2)); tmp.replace(p)
    info = hand_cache.describe(d)
    state('preparing', completed=len(info['entries']), total=info['total'])
    try:
        if len(info['entries']) != info['total']:
            node = shutil.which('node')
            if not node: raise ValueError('Node.js is required for offline hand preparation')
            result = subprocess.run([node, str(ROOT/'scripts/prepare-recording-hands.mjs'), session_path(space, take)], cwd=ROOT, capture_output=True, text=True, timeout=7200)
            if result.returncode: raise ValueError('Offline hand preparation failed: '+result.stderr[-1000:])
            info = hand_cache.describe(d)
        if len(info['entries']) != info['total']: raise ValueError('Offline hand cache is incomplete')
        summary = dict(completed=len(info['entries']), total=info['total'], version=info['version'])
        state('ready', **summary)
        return summary
    except (ValueError, OSError, subprocess.TimeoutExpired) as e:
        state('error', message=str(e)[:1000])
        raise ValueError(str(e)) from e

def _align_quietly(space, take):
    """Align if possible; a failure is kept on the scenario (alignError) rather than failing the whole job."""
    d = space_dir(space); s = d/'scenarios'/take
    if reference(manifest(d), d) is None: return
    try: register(space, take)
    except ValueError as e:
        p = s/'session.json'; sm = json.loads(p.read_text()); sm['alignError'] = str(e)[:300]; p.write_text(json.dumps(sm, indent=2))

def register(space, take, target=None):
    """Align a recording to the scene and store toSpace. With a selection of what the recording shows (target {surfaces, boxes}, kept as
    the recording's alignTarget so it can be run again), scripts/align_recording.py aligns to those parts only; without one, the older
    whole-scan registration (scripts/register_scenario.py), which a partial view full of clutter can fool."""
    d = space_dir(space); s = d/'scenarios'/take; m = manifest(d); p = s/'session.json'
    if not p.is_file(): raise ValueError('Add the recording to the space first.')
    ref = reference(m, d)
    if ref is None: raise ValueError('This scene has no scan yet.')
    sm = json.loads(p.read_text())
    if target is not None:
        target = {k: [str(x) for x in (target.get(k) or []) if NAME.match(str(x))] for k in ('surfaces', 'boxes')}
        sm['alignTarget'] = target; p.write_text(json.dumps(sm, indent=2))
    target = sm.get('alignTarget')
    if target and (target.get('surfaces') or target.get('boxes')):
        result = _mesh([ROOT/'scripts'/'align_recording.py', d, s]); result['target'] = target; result['scan'] = (m.get('scan') or {}).get('id')
    else: result = _mesh([ROOT/'scripts'/'register_scenario.py', ref, s])
    set_transform(s, result['toSpace'], {k: v for k, v in result.items() if k != 'toSpace'})
    return result

def align_manually(space, take, to_space, info):
    """toSpace set in the editor (fine-tuning: the recording's mesh moved onto the scan with the gizmo)."""
    d = space_dir(space); s = d/'scenarios'/take
    if not (s/'session.json').is_file(): raise ValueError('Unknown scenario.')
    if not (isinstance(to_space, list) and len(to_space) == 16 and all(isinstance(v, (int, float)) for v in to_space)): raise ValueError('Bad transform.')
    info = info if isinstance(info, dict) else {}
    # Fine-tuned in the editor (the recording's mesh moved onto the scan with the gizmo): keep what it was picked against, if anything.
    prev = (json.loads((s/'session.json').read_text()).get('registration') or {})
    set_transform(s, [float(v) for v in to_space], dict(method=str(info.get('method') or 'manual')[:32], rmse=prev.get('rmse'), explained=prev.get('explained'), target=prev.get('target'), fitness=None))
    return dict(ok=True)

def set_transform(s, to_space, registration):
    p = s/'session.json'; sm = json.loads(p.read_text())
    sm.pop('alignError', None)
    if to_space is None: sm.pop('toSpace', None); sm.pop('registration', None)
    else: sm['toSpace'] = to_space; sm['registration'] = registration
    p.write_text(json.dumps(sm, indent=2))

if __name__ == '__main__':
    import argparse, sys
    p = argparse.ArgumentParser(description='Scenes: scans, layout and recordings. Run with .venv/bin/python; registration uses .venv-mesh.')
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('create', help='new empty scene'); c.add_argument('scene')
    c = sub.add_parser('add-scan', help='add an export from a scanning app (.glb/.fbx; a RoomPlan .glb becomes the layout)')
    c.add_argument('scene'); c.add_argument('file'); c.add_argument('--id'); c.add_argument('--label'); c.add_argument('--primary', action='store_true')
    c = sub.add_parser('add-layout', help='RoomPlan export → layout boxes and rooms'); c.add_argument('scene'); c.add_argument('file')
    c.add_argument('--replace-boxes', action='store_true', help='discard boxes edited in the editor')
    c = sub.add_parser('fuse-scan', help='fuse a Record3D export folder into a scan'); c.add_argument('scene'); c.add_argument('source'); c.add_argument('--id'); c.add_argument('--primary', action='store_true')
    c = sub.add_parser('archive-scan', help='set a scan aside (scan/archive/)'); c.add_argument('scene'); c.add_argument('id')
    c = sub.add_parser('restore-scan', help='bring an archived scan back'); c.add_argument('scene'); c.add_argument('id')
    c = sub.add_parser('choose-scan', help='the scan used for occlusion, placement and alignment'); c.add_argument('scene'); c.add_argument('id')
    c = sub.add_parser('add-recording', help='import a Record3D take from private/, build its mesh, align it'); c.add_argument('scene'); c.add_argument('take')
    c = sub.add_parser('align', help='align a recording again (to its alignTarget if it has one; --target JSON {surfaces, boxes} sets it)'); c.add_argument('scene'); c.add_argument('take'); c.add_argument('--target')
    c = sub.add_parser('align-all', help='align every recording of the scene again'); c.add_argument('scene')
    c = sub.add_parser('add-zone', help='a zone RoomPlan missed: the floor rectangle around some layout boxes'); c.add_argument('scene'); c.add_argument('name')
    c.add_argument('boxes', nargs='+', help='box ids'); c.add_argument('--margin', type=float, default=.1)
    c = sub.add_parser('segment', help='split the chosen scan into walls, ceilings and zone floors (scan/surfaces.glb)'); c.add_argument('scene')
    sub.add_parser('list', help='scenes as JSON')
    a = p.parse_args()
    try:
        r = {'create': lambda: create(a.scene), 'add-scan': lambda: add_scan(a.scene, a.file, a.id, a.label, a.primary),
             'add-layout': lambda: add_layout(a.scene, a.file, a.replace_boxes), 'fuse-scan': lambda: build_scan(a.scene, a.source, a.id, a.primary),
             'choose-scan': lambda: set_primary(a.scene, a.id), 'add-recording': lambda: add_scenario(a.scene, a.take),
             'align': lambda: register(a.scene, a.take, json.loads(a.target) if a.target else None),
             'align-all': lambda: {s.name: register(a.scene, s.name) for s in sorted((space_dir(a.scene)/'scenarios').iterdir()) if (s/'session.json').is_file()},
             'archive-scan': lambda: archive_scan(a.scene, a.id), 'restore-scan': lambda: archive_scan(a.scene, a.id, True),
             'add-zone': lambda: add_zone(a.scene, a.name, a.boxes, a.margin), 'segment': lambda: segment(a.scene), 'list': listing}[a.cmd]()
    except ValueError as e: sys.exit(f'error: {e}')
    print(json.dumps(r, indent=1, default=str))
