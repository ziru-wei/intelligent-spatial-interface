#!/usr/bin/env python3
"""Digital twin objects: repaired or modelled copies of a scene's real objects (from Blender), added as components of the scene.

  twins.py <scene> <placement_manifest.json> [asset names...] [--name asset=Display name ...] [--scale 1]

The manifest (written alongside the exported assets) lists each asset: name, parts (node names in the scan it was cut from), its .glb,
and to_full_scene_gltf_y_up (row-major 4x4 from the asset to the scan's own frame, the one it had before registration). Per asset:
  spaces/<scene>/components/<name>/model.glb + component.json   kind gltf, category "persistent", scope "scene", pivot at the centre
                                                                of its bounding box, defaultScale --scale
  spaces/<scene>/composition.json                               an instance placed where the object is: the manifest's matrix, then
                                                                the chosen scan's toSpace (space.json) into the scene's coordinates;
                                                                that spot is also its `initial` (Reset). Running again keeps twins
                                                                that were moved where they are (--refresh moves them back)
Each scan part belongs to one twin: when an asset also contains parts of another chosen asset (a desk exported with its drawer, the
drawer also on its own), it keeps only its own parts (component.json `nodes`).
The twins keep their original size (default scale 1, about the pivot). Scope "scene": they are in every recording of the scene.
Runs in .venv-mesh (trimesh).
"""
import argparse, json, math, shutil, sys, time
from pathlib import Path
import numpy as np, trimesh

ROOT = Path(__file__).resolve().parents[1]; SPACES = ROOT/'spaces'

def add_twins(scene, manifest, names=None, display=None, scale=1, refresh=False):
    d = SPACES/scene; m = json.loads((d/'space.json').read_text()); man = json.loads(Path(manifest).read_text()); src = Path(manifest).parent
    chosen = (m.get('scan') or {}).get('id'); scan = next((x for x in m.get('scans', []) if x['id'] == chosen), None)
    if not scan: raise ValueError('The scene has no chosen scan.')
    T = np.array(scan['toSpace'], float).reshape(4, 4); assets = [a for a in man['assets'] if not names or a['name'] in names]
    if names and len(assets) != len(set(names)): raise ValueError('Unknown assets: '+', '.join(sorted(set(names)-{a['name'] for a in assets})))
    comp_path = d/'composition.json'; doc = json.loads(comp_path.read_text()) if comp_path.is_file() else dict(version=2, revision=0, components=[])
    out = []
    for a in assets:
        others = {p for b in assets if b is not a for p in b['parts']}; own = [p for p in a['parts'] if p not in others] or a['parts']
        g = trimesh.load(src/a['files']['glb'], force='scene')
        keep = [n for n in g.graph.nodes_geometry if n in own or any(n.startswith(p) for p in own)]
        V = np.concatenate([trimesh.transform_points(g.geometry[g.graph[n][1]].vertices, g.graph[n][0]) for n in keep])
        pivot = (V.min(0)+V.max(0))/2; M = T@np.array(a['to_full_scene_gltf_y_up'], float)
        R = M[:3, :3]; s = np.cbrt(abs(np.linalg.det(R)))
        if abs(s-1) > .01 or abs(R[1, 1]/s-1) > .01: raise ValueError(f"{a['name']}: placement is not a yaw and a translation")
        yaw = math.degrees(math.atan2(R[0, 2], R[0, 0])); position = (M@np.r_[pivot, 1])[:3]
        cdir = d/'components'/a['name']; cdir.mkdir(parents=True, exist_ok=True); shutil.copyfile(src/a['files']['glb'], cdir/'model.glb')
        name = (display or {}).get(a['name']) or a['name'].replace('_', ' ').capitalize()
        spec = dict(name=name, kind='gltf', entry='model.glb', category='persistent', scope='scene', defaultScale=scale, pivot=np.round(pivot, 4).tolist(),
                    description=f"Digital twin of {name.lower()} ({a.get('label', '')}), from {Path(man.get('source_scene', '')).name}.", source=dict(manifest=str(Path(manifest).resolve().relative_to(ROOT)), asset=a['name'], parts=own))
        if own != a['parts']: spec['nodes'] = own
        (cdir/'component.json').write_text(json.dumps(spec, indent=1, ensure_ascii=False))
        here = dict(position=np.round(position, 4).tolist(), rotation=[0, round(yaw, 2), 0], scale=scale)
        old = next((c for c in doc['components'] if c['id'] == a['name']), None)
        # Preserve both the current transform and saved Reset defaults unless explicitly refreshed.
        inst = dict(old) if old and not refresh else dict(id=a['name'], component=a['name'], name=name, **here, yaw=round(yaw, 2), visible=True, mount='floor', params={}, scope='scene', initial=here)
        doc['components'] = [c for c in doc['components'] if c['id'] != a['name']]+[inst]
        out.append(dict(id=a['name'], name=name, position=inst['position'], yaw=inst['yaw'], parts=own))
    doc['revision'] = doc.get('revision', 0)+1; comp_path.write_text(json.dumps(doc, indent=1))
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('scene'); ap.add_argument('manifest'); ap.add_argument('assets', nargs='*')
    ap.add_argument('--name', action='append', default=[], help='asset=Display name'); ap.add_argument('--scale', type=float, default=1)
    ap.add_argument('--refresh', action='store_true', help='move already placed twins back to where the manifest puts them')
    a = ap.parse_args()
    try: print(json.dumps(add_twins(a.scene, a.manifest, a.assets, dict(x.split('=', 1) for x in a.name), a.scale, a.refresh), indent=1, ensure_ascii=False))
    except ValueError as e: sys.exit(f'error: {e}')
