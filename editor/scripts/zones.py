#!/usr/bin/env python3
"""Reshape a scene's zones (scan/semantic.json `rooms`): the floor is partitioned among them, so giving an area to one zone takes it from
the others. Zones can be any shape (L-shaped kitchens, rooms with notches); each keeps `polygon` (its outline: a list of parts, each a
list of rings [[x,z],...], the first ring outside, any further ones holes) and `triangles` (for point-in-zone tests). Afterwards every
relation to zones is recomputed (scripts/layout.py relate: boxes, walls, ceilings); walls and ceilings themselves never move.

  zones.py <scene> assign <zone> (--rect X0 Z0 X1 Z1 | --polygon "x,z x,z ..." | --zones a,b) [--name NAME] [--not-zones c,d]
  zones.py <scene> rename <zone> <name> [--id NEW_ID]

assign: the area (clipped to the scene's floor, minus --not-zones) goes to <zone>, created if new. Runs in .venv-mesh (shapely, earcut).
"""
import argparse, json, re, sys
from pathlib import Path
import numpy as np, trimesh
from shapely.geometry import Polygon, MultiPolygon, box, mapping
from shapely.ops import unary_union
sys.path.insert(0, str(Path(__file__).resolve().parent))
import layout

SPACES = Path(__file__).resolve().parents[1]/'spaces'

def geom(zone):
    if zone.get('polygon'): return unary_union([Polygon(part[0], part[1:]) for part in zone['polygon']]).buffer(0)
    return unary_union([Polygon(t) for t in zone['triangles']]).buffer(0)

def store(zone, g):
    g = g.buffer(0); parts = [p for p in (g.geoms if isinstance(g, MultiPolygon) else [g]) if p.area > 1e-4]
    zone['polygon'] = [[[[round(x, 3), round(z, 3)] for x, z in list(r.coords)[:-1]] for r in [p.exterior, *p.interiors]] for p in parts]
    tris = []
    for p in parts:
        v, f = trimesh.creation.triangulate_polygon(p, engine='earcut'); tris += [[[round(float(v[i][0]), 3), round(float(v[i][1]), 3)] for i in t] for t in f]
    zone['triangles'] = tris
    c = unary_union(parts).representative_point() if parts else None
    zone['center'] = [round(c.x, 3), round(c.y, 3)] if c else zone.get('center'); zone['area'] = round(sum(p.area for p in parts), 2)

def load(scene):
    m = json.loads((SPACES/scene/'space.json').read_text()); p = SPACES/scene/m['semantic']; return p, json.loads(p.read_text())

def save(p, sem):
    sem['rooms'] = [r for r in sem['rooms'] if r.get('triangles')]; layout.relate(sem)
    sem['revision'] = sem.get('revision', 0)+1; p.write_text(json.dumps(sem, indent=1))
    # Zones changed: doors and windows are cut into the walls again (the walls' zones may have changed).
    import wall_openings
    wall_openings.run(p.parent.parent)

def assign(sem, zid, area, name=None, keep_out=()):
    rooms = sem['rooms']; floor = unary_union([geom(r) for r in rooms])
    area = area.intersection(floor)
    for k in keep_out: area = area.difference(geom(next(r for r in rooms if r['id'] == k)))
    zone = next((r for r in rooms if r['id'] == zid), None)
    if zone is None: zone = dict(id=zid, name=name or zid.title(), floorY=min(r.get('floorY', 0) for r in rooms)); rooms.append(zone)
    zone['kind'] = 'zone'
    if name: zone['name'] = name
    for r in rooms:
        if r is not zone: store(r, geom(r).difference(area))
    store(zone, (geom(zone) if zone.get('triangles') else Polygon()).union(area))
    return zone

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); p.add_argument('scene')
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('assign'); a.add_argument('zone'); a.add_argument('--name'); a.add_argument('--not-zones', default='')
    g = a.add_mutually_exclusive_group(required=True); g.add_argument('--rect', nargs=4, type=float); g.add_argument('--polygon'); g.add_argument('--zones')
    r = sub.add_parser('rename'); r.add_argument('zone'); r.add_argument('name'); r.add_argument('--id')
    args = p.parse_args(); path, sem = load(args.scene)
    if args.cmd == 'assign':
        zid = re.sub(r'[^a-z0-9_-]', '-', args.zone.lower())
        if args.rect: x0, z0, x1, z1 = args.rect; area = box(min(x0, x1), min(z0, z1), max(x0, x1), max(z0, z1))
        elif args.polygon: area = Polygon([tuple(map(float, pt.split(','))) for pt in args.polygon.split()]).buffer(0)
        else: area = unary_union([geom(next(z for z in sem['rooms'] if z['id'] == k)) for k in args.zones.split(',')])
        zone = assign(sem, zid, area, args.name, [k for k in args.not_zones.split(',') if k])
    else:
        zone = next(z for z in sem['rooms'] if z['id'] == args.zone); zone['name'] = args.name
        if args.id:
            old, zone['id'] = zone['id'], re.sub(r'[^a-z0-9_-]', '-', args.id.lower())
    save(path, sem)
    print(json.dumps({z['id']: dict(name=z['name'], area=z.get('area'), parts=len(z.get('polygon', [])) or None,
        boxes=sorted(b['label'] for b in sem['objects']+sem['openings'] if b['room'] == z['id'] and not b.get('parent'))) for z in sem['rooms']}, indent=1))
