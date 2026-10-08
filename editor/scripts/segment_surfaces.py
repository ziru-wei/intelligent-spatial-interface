#!/usr/bin/env python3
"""Surface segmentation: which triangles of a scene's chosen scan are which wall, ceiling piece or zone floor (step of scene setup,
after the layout and zones; scripts/spaces.py segment runs it).

The layout (scan/semantic.json) says *what* the surfaces are: RoomPlan's walls and ceilings (idealised planes and outlines) and the
zones (floor polygons). The scan says *where* they are, pixel-true in a recording (trim, window frames, bumps). A scan triangle belongs to
a surface when it faces the same way (cos > --normal; ceilings --ceiling-normal, as RoomPlan draws some attic slopes flat), falls inside its outline (grown by --dist), is in no top-level furniture box (grown by
--box-margin toward the surface; doors and windows are already cut out of the walls, scripts/wall_openings.py), and lies within --dist of where the scan shows that surface to be, cell by cell (local_offsets: the outermost layer, since furniture
facing the same way is always in front of a wall, above a floor, below a ceiling): RoomPlan's planes are idealised and sit a few cm off
the real surface, and real walls jog, bow and lean: furniture standing against a wall, a door in it, a cabinet hung on it belong to the
box, not the wall. A triangle near two surfaces goes to the nearer plane. Flat things on a wall with no box (posters, drawings) stay
wall: geometry cannot tell them apart.

Doors and windows (in the walls' holes, scripts/wall_openings.py) get their own surfaces too, and so do boxes nested in them (a window's
glass; the window's own surface is then its frame).

Writes, next to the scan:
  scan/surfaces.glb   one mesh node per surface (named by its id), TEXCOORD_0 = (u, v) in metres in the surface's own frame:
                      walls u along the wall, v up; ceilings u, v in the ceiling plane; floors u = x, v = z; doors and windows (and
                      their parts) u along the wall, v up, from the box centre
  scan/surfaces.json  {version, scan, semanticRevision, params, surfaces: [{id, kind (wall, ceiling, floor, door, window), label, parent (nested parts), zones, area, triangles, origin, u, v, normal,
                      uvMin, uvMax, fit: [{side, offset: median m from RoomPlan's plane, spread: 5-95% range of the local offsets}]}], excluded: {box label: m²}, wallLike: m² near walls taken out by boxes}
Runs in .venv-mesh (trimesh, shapely). Usage: segment_surfaces.py <scene dir> [--dist 0.05] [--normal 0.8] [--ceiling-normal 0.5] [--box-margin 0.03] [--reach 0.6]
"""
import argparse, json, math, sys
from pathlib import Path
import numpy as np, trimesh, shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union
sys.path.insert(0, str(Path(__file__).resolve().parent))
import wall_openings

def scan_mesh(path):
    sc = trimesh.load(path, force='scene')
    parts = [sc.geometry[g].copy().apply_transform(T) for n in sc.graph.nodes_geometry for T, g in [sc.graph[n]]]
    return trimesh.util.concatenate([trimesh.Trimesh(p.vertices, p.faces, process=False) for p in parts])

def box_frame(b):
    a = math.radians(b.get('yaw', 0)); return np.array([[math.cos(a), 0, -math.sin(a)], [0, 1, 0], [math.sin(a), 0, math.cos(a)]])

def surfaces(sem):
    """Each surface: id, kind, label, zones, origin, unit axes u, v and normal, and the outline in (u, v) (a shapely polygon)."""
    out = []
    for w in sem.get('walls', []):
        R = box_frame(w); c = np.array(w['center']); u, n = R[0], R[2]; v = np.array([0., 1, 0]); o = np.array([c[0], 0, c[2]])
        # The wall with its doors and windows already cut out (scripts/wall_openings.py: the floor plan's `region`).
        shape = wall_openings.region_polygon(w, o, u, v) if len(w.get('outline') or []) >= 3 else Polygon([(-w['size'][0]/2, 0), (w['size'][0]/2, 0), (w['size'][0]/2, w['size'][1]), (-w['size'][0]/2, w['size'][1])])
        out.append(dict(id=w['id'], kind='wall', label='wall', zones=w.get('rooms', []), origin=o, u=u, v=v, normal=n, shape=shape, slack=w['size'][2]/2))
    for c in sem.get('ceilings', []):
        o = np.array(c['center']); n = np.array(c['normal'], float); n /= np.linalg.norm(n)
        u = np.cross(n, [0, 0, 1.]) if abs(n[2]) < .9 else np.cross(n, [1., 0, 0]); u /= np.linalg.norm(u); v = np.cross(n, u)
        pts = np.array(c.get('outline') or [])
        if len(pts) < 3: continue
        out.append(dict(id=c['id'], kind='ceiling', label=c.get('label', 'ceiling'), zones=c.get('rooms') or [c.get('room')], origin=o, u=u, v=v, normal=n,
                        shape=Polygon(np.c_[(pts-o)@u, (pts-o)@v]).convex_hull, slack=0))
    for z in sem.get('rooms', []):
        parts = z.get('polygon') or [[t] for t in z['triangles']]
        shape = unary_union([Polygon(p[0], p[1:]) for p in parts]).buffer(0)
        out.append(dict(id='Floor_'+z['id'], kind='floor', label=f"{z.get('name', z['id'])} floor", zones=[z['id']], origin=np.array([0, z.get('floorY', 0), 0.]),
                        u=np.array([1., 0, 0]), v=np.array([0., 0, 1]), normal=np.array([0., 1, 0]), shape=shape, slack=0))
    return out

def local_offsets(u, v, d, w, cell=.15, min_area=.004, layer=.02):
    """Where the real surface is, per point: d is the distance from RoomPlan's face, positive toward the room, and the result is the d
    of the surface at that point. Per (u, v) cell, looking at its 3 x 3 neighbourhood: the outermost layer (the smallest d whose ±`layer`
    band holds at least a quarter of the surface there, and `min_area`), then a plane d = a + b·u + c·v fitted to that layer and refined
    on its inliers, so a slope inside the cell (an attic ceiling that RoomPlan drew flat) is followed, not cut into stripes. Walls, floors
    and ceilings bound the room: whatever else faces the same way (a cabinet front, a table top, a lamp) is in front of them."""
    iu, iv = np.floor(u/cell).astype(int), np.floor(v/cell).astype(int); cells = {}
    for k, key in enumerate(zip(iu.tolist(), iv.tolist())): cells.setdefault(key, []).append(k)
    cells = {key: np.array(ix) for key, ix in cells.items()}; pred = np.empty(len(d))
    for (a, b), own in cells.items():
        ix = np.concatenate([cells.get((a+x, b+y), np.empty(0, int)) for x in (-1, 0, 1) for y in (-1, 0, 1)])
        x, ww = d[ix], w[ix]; o = np.argsort(x); xs, ws = x[o], ww[o]; c = np.concatenate([[0], np.cumsum(ws)]); need = max(min_area, .25*c[-1])
        hi = np.searchsorted(xs, xs+2*layer, side='right'); band = c[hi]-c[np.arange(len(xs))]
        start = int(np.argmax(band >= need)) if (band >= need).any() else int(np.argmax(band))
        sel = ix[o[start:hi[start]]]; coef = np.array([float(np.median(d[sel])), 0., 0.])
        for _ in range(3):   # plane through the layer, then its inliers over the whole neighbourhood
            if len(sel) >= 6:
                G = np.c_[np.ones(len(sel)), u[sel], v[sel]]*np.sqrt(w[sel])[:, None]; coef = np.linalg.lstsq(G, d[sel]*np.sqrt(w[sel]), rcond=None)[0]
            res = d[ix]-(coef[0]+coef[1]*u[ix]+coef[2]*v[ix]); nxt = ix[np.abs(res) < layer]
            if len(nxt) < 3: break
            sel = nxt
        pred[own] = coef[0]+coef[1]*u[own]+coef[2]*v[own]
    return pred

BOX_EDGES = [(i, j) for i in range(8) for j in range(i+1, 8) if bin(i ^ j).count('1') == 1]   # corners indexed by (x, y, z) bits

def contact(Q, d, lo, hi):
    """The part of a box (corners Q, their distances d along a surface's normal) within lo <= d <= hi: its vertices (corners in the slab
    and edge crossings of its two planes). Projected onto the surface this is where the box touches it: a cabinet whose top corner meets a
    sloped ceiling covers a sliver of it, not the whole cabinet's shadow."""
    pts = [Q[i] for i in range(8) if lo <= d[i] <= hi]
    for i, j in BOX_EDGES:
        for t in (lo, hi):
            if (d[i]-t)*(d[j]-t) < 0: pts.append(Q[i]+(Q[j]-Q[i])*(t-d[i])/(d[j]-d[i]))
    return np.array(pts)

def clip_to_region(V, F, uv, region):
    """Triangles (vertices V, faces F, per-vertex surface coordinates uv) cut to a region of the surface's plane: whole when inside,
    clipped and re-triangulated when they straddle its edge (lifted back to 3D through each triangle's own affine map), dropped when
    outside. Scan triangles are large where the scan is flat (10-20 cm on floors), so without this a zone boundary or a door edge would
    follow triangle edges and come out jagged."""
    tri_uv = uv[F]; polys = shapely.polygons(tri_uv); region = shapely.make_valid(region); shapely.prepare(region)
    whole = shapely.contains(region, polys); cut = ~whole&shapely.intersects(region, polys)
    outV, outF, outUV = [V[F[whole]].reshape(-1, 3)], [np.arange(whole.sum()*3).reshape(-1, 3)], [tri_uv[whole].reshape(-1, 2)]; n = whole.sum()*3
    for t in np.nonzero(cut)[0]:
        piece = shapely.intersection(polys[t], region)
        for g in getattr(piece, 'geoms', [piece]):
            if g.geom_type != 'Polygon' or g.area < 1e-6: continue
            pv, pf = trimesh.creation.triangulate_polygon(g, engine='earcut')
            # Affine map uv → 3D from the original triangle.
            (a, b, c), P = tri_uv[t], V[F[t]]; M = np.linalg.lstsq(np.c_[[a, b, c], np.ones(3)], P, rcond=None)[0]
            outV.append(np.c_[pv, np.ones(len(pv))]@M); outUV.append(pv); outF.append(pf+n); n += len(pv)
    return np.concatenate(outV), np.concatenate(outF).astype(int), np.concatenate(outUV)

def openings_of(sem):
    """Doors and windows in walls (wall_openings.wall_of), each with the boxes nested in it (e.g. a window's glass) and its zone."""
    out = []
    for b in sem.get('openings', []):
        w = None if b.get('parent') else wall_openings.wall_of(sem, b)   # nested ones (glass) are parts of theirs
        if not w: continue
        kids = [x for x in sem.get('objects', [])+sem.get('openings', []) if x.get('parent') == b['id']]
        out.append(dict(box=b, wall=w['id'], children=kids, zone=b.get('room') or (w.get('rooms') or [None])[0],
                        kind='door' if b['id'].startswith('Door') or 'door' in str(b.get('category', '')).lower() else 'window'))
    return out

def segment(mesh, sem, dist=.05, normal=.8, ceiling_normal=.5, box_margin=.03, window=.15, reach=.6, cell=.15):
    """Assign scan triangles to the layout's surfaces. Per surface (and per face of a wall: both sides of a 10 cm slab can be visible from
    different rooms): candidates face the same way, lie inside the outline (grown by `dist`; zone floors exactly) and within `window` of
    where RoomPlan puts that face; where the real surface is comes from the scan, cell by cell (local_offsets), and a candidate within
    `dist` of it is on the surface (contested: the surface whose own outline holds it, then the closer). The surface's region is its outline minus where top-level boxes touch it (the part of each box within
    box_margin + dist of the surface, projected onto it: a cabinet on a wall, a door in it, a fridge on the floor; not a table half a
    metre away; see contact); its triangles are
    cut to that region (clip_to_region)."""
    C, N, A, V, F = mesh.triangles_center, mesh.face_normals, mesh.area_faces, mesh.vertices, mesh.faces
    # Furniture only: doors and windows are cut into the walls in the floor plan itself (wall_openings), before segmenting.
    tops = [b for b in sem.get('objects', []) if not b.get('parent')]
    corners = [np.array(b['center'])+(np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)])*np.array(b['size'])/2)@box_frame(b) for b in tops]
    def in_box(ix, i, n):
        c, R, h = np.array(tops[i]['center']), box_frame(tops[i]), np.array(tops[i]['size'])/2
        return np.all(np.abs((C[ix]-c)@R.T) <= h+box_margin*np.abs(R@n)+.005, 1)
    surfs = surfaces(sem); best = np.full(len(C), np.inf); which = np.full(len(C), -1); regions = {}; claims = {}
    for k, s in enumerate(surfs):
        P = C-s['origin']; u, v, d0 = P@s['u'], P@s['v'], P@s['normal']
        outline = s['shape'] if s['kind'] == 'floor' else s['shape'].buffer(dist)
        inside = shapely.contains_xy(outline, u, v); core = shapely.contains_xy(s['shape'], u, v); cosn = N@s['normal']; s['fits'] = []
        for side in ((1, -1) if s['kind'] == 'wall' else (1,)):
            # Search from `window` behind RoomPlan's face to `reach` into the room: the real surface can be far from where RoomPlan put it
            # (an attic slope it drew as a flat ceiling); the outermost layer wins. Walls are vertical and floors flat, so their triangles
            # must face within acos(normal) of them; RoomPlan's ceilings can be off by a slope, so theirs within acos(ceiling_normal),
            # facing down.
            facing = (cosn*side > ceiling_normal)&(N[:, 1] < 0) if s['kind'] == 'ceiling' else cosn*side > normal
            d = d0*side; ix = np.nonzero(inside&facing&(d-s['slack'] > -window)&(d-s['slack'] < reach))[0]; cut = []
            if not len(ix): continue
            # The surface's layer, from what is not furniture (triangles in a box reaching the surface stay out of the estimate).
            furniture = np.zeros(len(ix), bool)
            for i in range(len(tops)): furniture |= in_box(ix, i, s['normal'])
            free = ix[~furniture] if (~furniture).any() else ix
            local = local_offsets(u[free], v[free], d[free], A[free], cell); layer = float(np.median(local))
            lookup = dict(zip(free.tolist(), local.tolist())); est = np.array([lookup.get(i, layer) for i in ix.tolist()])
            # Distance to the local surface measured along RoomPlan's normal; a sloped real surface is steeper in d, so allow for its tilt.
            r = np.abs(d[ix]-est)*np.abs(cosn[ix]); on = r < dist; ix, r = ix[on], r[on]
            # Contested triangles: the surface whose own outline (not grown) holds the triangle's centre comes first, so a thin piece next to
            # a large one cannot take the large one's triangles; then the closer one.
            score = r+np.where(core[ix], 0, 1)
            better = score < best[ix]; best[ix[better]] = score[better]; which[ix[better]] = k
            # Boxes that reach this face of the surface cut their footprint out of it.
            for i, Q in enumerate(corners):
                # Its extent along the surface's normal must overlap the surface's layer: in front of a wall but touching it, not
                # behind it in the next room, not half a metre away.
                qd = (Q-s['origin'])@s['normal']*side; lo, hi = layer-box_margin-dist, layer+box_margin+dist
                if qd.min() <= hi and qd.max() >= lo:
                    T = contact(Q, qd, lo, hi)
                    if len(T) < 3: continue
                    fp = shapely.convex_hull(shapely.multipoints(np.c_[(T-s['origin'])@s['u'], (T-s['origin'])@s['v']]))
                    if fp.area > 1e-4 and fp.intersects(outline): cut.append(fp); claims.setdefault((k, side), []).append((i, fp))
            s['fits'].append(dict(side=side, offset=round(layer, 3), spread=round(float(np.ptp(np.percentile(local, [5, 95]))), 3)))
            # Each face has its own region: a box against one side of a wall leaves the other side alone.
            regions[(k, side)] = outline.difference(shapely.union_all(cut)) if cut else outline
    scene, info, excluded = trimesh.Scene(), [], {}
    is_wall = np.array([x['kind'] == 'wall' for x in surfs]+[False])
    for o in openings_of(sem):
        # Doors and windows: what is in their hole in the wall (cut in the floor plan), from 15 cm behind to 15 cm in front of the box
        # (a window's recess and sill): triangles no other surface has, or the wall's where they straddle the hole's edge. Nested boxes
        # (a window's glass) take their own rectangle; the rest is the frame.
        c, R, h = np.array(o['box']['center']), box_frame(o['box']), np.array(o['box']['size'])/2
        P = C-c; band = np.abs(P@R[2]) < h[2]+.15; near = np.all(np.abs(np.c_[P@R[0], P[:, 1]]) <= h[:2]+.05, 1)
        ix = np.nonzero(band&near&((which < 0)|is_wall[which]))[0]
        if not len(ix): continue
        uv = np.c_[(V-c)@R[0], V[:, 1]-c[1]]; rect = lambda b: shapely.box(*((np.array(b['center'])-c)@R[0]-b['size'][0]/2, b['center'][1]-c[1]-b['size'][1]/2,
                                                                                 (np.array(b['center'])-c)@R[0]+b['size'][0]/2, b['center'][1]-c[1]+b['size'][1]/2))
        whole, kids = rect(o['box']), [(k, rect(k)) for k in o['children']]
        for part, region, parent in [(o['box'], whole.difference(shapely.union_all([r for _, r in kids])) if kids else whole, None)]+[(k, r.intersection(whole), o['box']['id']) for k, r in kids]:
            sv, sf, suv = clip_to_region(V, F[ix], uv, region)
            if not len(sf): continue
            sub = trimesh.Trimesh(sv, sf, process=False); pid = part['id']
            sub.visual = trimesh.visual.TextureVisuals(uv=suv, material=trimesh.visual.material.PBRMaterial(name=pid, baseColorFactor=[255, 255, 255, 255]))
            scene.add_geometry(sub, node_name=pid, geom_name=pid)
            info.append(dict(id=pid, kind=o['kind'], label=part.get('label', pid), parent=parent, wall=o['wall'], zones=[o['zone']] if o['zone'] else [], area=round(float(sub.area), 3),
                             triangles=int(len(sf)), origin=np.round(c, 4).tolist(), u=np.round(R[0], 5).tolist(), v=[0, 1, 0], normal=np.round(R[2], 5).tolist(),
                             uvMin=np.round(suv.min(0), 3).tolist(), uvMax=np.round(suv.max(0), 3).tolist()))
    for k, s in enumerate(surfs):
        faces = np.nonzero(which == k)[0]
        if not len(faces): continue
        uv = np.c_[(V-s['origin'])@s['u'], (V-s['origin'])@s['v']]; parts = []
        for side in ((1, -1) if s['kind'] == 'wall' else (1,)):
            fs = faces[(N[faces]@s['normal'])*side > 0]
            if not len(fs) or (k, side) not in regions: continue
            if s['kind'] == 'wall':   # what the boxes took off this face of the wall, by box
                for i, fp in claims.get((k, side), []):
                    took = shapely.contains_xy(fp, (C[fs]-s['origin'])@s['u'], (C[fs]-s['origin'])@s['v'])
                    if took.any(): excluded[tops[i]['label']] = excluded.get(tops[i]['label'], 0)+float(A[fs][took].sum())
            parts.append(clip_to_region(V, F[fs], uv, regions[(k, side)]))
        if not parts: continue
        sv = np.concatenate([p[0] for p in parts]); suv = np.concatenate([p[2] for p in parts]); off = np.cumsum([0]+[len(p[0]) for p in parts[:-1]])
        sf = np.concatenate([p[1]+o for p, o in zip(parts, off)])
        if not len(sf): continue
        sub = trimesh.Trimesh(sv, sf, process=False)
        sub.visual = trimesh.visual.TextureVisuals(uv=suv, material=trimesh.visual.material.PBRMaterial(name=s['id'], baseColorFactor=[255, 255, 255, 255]))
        scene.add_geometry(sub, node_name=s['id'], geom_name=s['id'])
        info.append(dict(id=s['id'], kind=s['kind'], label=s['label'], zones=[z for z in s['zones'] if z], area=round(float(sub.area), 3), triangles=int(len(sf)),
                         origin=np.round(s['origin'], 4).tolist(), u=np.round(s['u'], 5).tolist(), v=np.round(s['v'], 5).tolist(), normal=np.round(s['normal'], 5).tolist(),
                         uvMin=np.round(suv.min(0), 3).tolist(), uvMax=np.round(suv.max(0), 3).tolist(), fit=s['fits']))
    excluded = {k: round(v, 3) for k, v in excluded.items()}
    return scene, info, excluded, round(sum(excluded.values()), 3)

def run(d, dist=.05, normal=.8, box_margin=.03, reach=.6, ceiling_normal=.5):
    """Segment scene folder d (its chosen scan and layout) and write scan/surfaces.glb and scan/surfaces.json; returns a summary."""
    d = Path(d); m = json.loads((d/'space.json').read_text())
    if not (m.get('scan') or {}).get('mesh') or not m.get('semantic'): raise ValueError('the scene needs a chosen scan and a layout first')
    p = d/m['semantic']; sem = json.loads(p.read_text())
    # Pre-processing: doors and windows cut into the walls (kept in the floor plan; only written when the cut changed).
    before = json.dumps([(w.get('region'), w.get('openings')) for w in sem.get('walls', [])]); cuts = wall_openings.cut(sem)
    if json.dumps([(w.get('region'), w.get('openings')) for w in sem.get('walls', [])]) != before:
        sem['revision'] = sem.get('revision', 0)+1; p.write_text(json.dumps(sem, indent=1))
    scene, info, excluded, boxed = segment(scan_mesh(d/m['scan']['mesh']), sem, dist, normal, ceiling_normal, box_margin, reach=reach)
    scene.export(d/'scan'/'surfaces.glb')
    (d/'scan'/'surfaces.json').write_text(json.dumps(dict(version=1, scan=m['scan']['mesh'], semanticRevision=sem.get('revision', 0),
        params=dict(dist=dist, normal=normal, ceilingNormal=ceiling_normal, boxMargin=box_margin, reach=reach), surfaces=info, excluded=dict(sorted(excluded.items(), key=lambda x: -x[1])), wallLike=round(boxed, 2), openingsCut=cuts), indent=1))
    by = {}
    for s in info: by.setdefault(s['kind'], [0, 0]); by[s['kind']][0] += 1; by[s['kind']][1] += s['area']
    return dict(surfaces={k: dict(count=c, area=round(ar, 1)) for k, (c, ar) in by.items()}, openingsCut=round(sum(cuts.values()), 2), excludedByBoxes=round(boxed, 2), file='scan/surfaces.glb')

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); p.add_argument('scene_dir')
    p.add_argument('--dist', type=float, default=.05); p.add_argument('--normal', type=float, default=.8); p.add_argument('--box-margin', type=float, default=.03)
    p.add_argument('--reach', type=float, default=.6); p.add_argument('--ceiling-normal', type=float, default=.5)
    a = p.parse_args()
    try: print(json.dumps(run(a.scene_dir, a.dist, a.normal, a.box_margin, a.reach, a.ceiling_normal)))
    except ValueError as e: sys.exit(f'error: {e}')
