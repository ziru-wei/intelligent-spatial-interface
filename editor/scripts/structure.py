#!/usr/bin/env python3
"""Correct the layout's room structure from the scan, where RoomPlan modelled it wrong (scan/semantic.json).

  structure.py <scene> split-ceiling <ceiling id> [--angle 15] [--min-area 0.3]
  structure.py <scene> align-openings [ids...] [--dry-run]
  structure.py <scene> merge-walls [--dry-run]

split-ceiling: RoomPlan sometimes draws an attic slope as part of a flat ceiling piece. The scan triangles under that piece (facing down,
inside its outline, from 15 cm above its plane to 1.2 m below: scripts/scan_geometry.py near) are grouped by the way they face (within
--angle degrees); every group of at least
--min-area m² gets a plane fitted to it (its largest connected part, inliers within 3 cm). The group that faces like RoomPlan's piece
keeps the piece's id and its outline minus the others' footprints; each other group becomes a new piece (<id>b, <id>c, ...; outline:
the convex hull of its part, source 'scan'). Walls whose outline reaches above a new sloped piece are cut down to it. Then the zones'
relations (layout.relate) and the doors and windows cut into the walls (scripts/wall_openings.py) are redone.

align-openings: a window's or door's box from RoomPlan (or drawn by hand) is often a few cm off. Its frame (casing, sill, head) stands
out from the wall as narrow ridges in the scan (1-3 cm proud, about 10 cm wide), even where the glass, blinds and wall are all at about
the same depth. Across the opening (and up it) the scan's depth profile minus its 50 cm running median shows them; each edge of the box
moves to the outer edge of the ridge nearest to it (within 30 cm), so the box covers the whole unit, frame included, up to the paint.
Edges with no ridge stay. Default: every window (Window_*); name ids to do doors too.

merge-walls: RoomPlan cuts a wall wherever another wall meets it (a T junction), so one flat wall becomes several pieces (home: Wall_0 and
Wall_6). Pieces that are parallel (within 2°), in the same plane (centre lines within 3 cm) and touching end to end (gap under 5 cm) are
merged into the longer one's id (outline: the union; `parts` lists the merged ids).

Runs in .venv-mesh (trimesh, shapely).
"""
import argparse, json, math, sys
from pathlib import Path
import numpy as np, trimesh, shapely
from shapely.geometry import Polygon, MultiPoint
sys.path.insert(0, str(Path(__file__).resolve().parent))
import layout, wall_openings
from scan_geometry import box_frame, scan_mesh, layout_surfaces, near
from wall_openings import wall_of

SPACES = Path(__file__).resolve().parents[1]/'spaces'

def plane_basis(n):
    u = np.cross(n, [0, 0, 1.]) if abs(n[2]) < .9 else np.cross(n, [1., 0, 0]); u /= np.linalg.norm(u); return u, np.cross(n, u)

def fit(mesh, faces):
    """Plane (point, unit normal facing down into the room) of a set of faces, refitted on its inliers within 3 cm."""
    C, A = mesh.triangles_center[faces], mesh.area_faces[faces]; keep = np.ones(len(faces), bool)
    for _ in range(3):
        w = A[keep]; p = (C[keep]*w[:, None]).sum(0)/w.sum(); n = np.linalg.svd((C[keep]-p)*np.sqrt(w)[:, None], full_matrices=False)[2][2]
        n = -n if n[1] > 0 else n; nxt = np.abs((C-p)@n) < .03
        if nxt.sum() < 3: break
        keep = nxt
    return p, n, faces[keep]

def largest_part(mesh, faces):
    # Weld the scan's vertices (exports often store triangles apart) to see what touches what.
    sub = mesh.submesh([faces], append=True, only_watertight=False); sub.merge_vertices(digits_vertex=4)
    labels = trimesh.graph.connected_component_labels(sub.face_adjacency, node_count=len(faces))
    areas = np.bincount(labels, weights=sub.area_faces); return faces[labels == areas.argmax()]

def split_ceiling(scene, cid, angle=15., min_area=.3):
    d = SPACES/scene; m = json.loads((d/'space.json').read_text()); p = d/m['semantic']; sem = json.loads(p.read_text())
    piece = next((c for c in sem['ceilings'] if c['id'] == cid), None)
    if piece is None: raise ValueError('Unknown ceiling: '+cid)
    s = next((x for x in layout_surfaces(sem) if x['id'] == cid), None); full = scan_mesh(d/m['scan']['mesh'])
    idx = near(full, s, behind=.15, front=1.2, facing=.5) if s else []
    if not len(idx): raise ValueError(f'The scan has no triangles under {cid}')
    mesh = full.submesh([idx], append=True); N, A = mesh.face_normals, mesh.area_faces; n0 = np.array(piece['normal'], float); n0 /= np.linalg.norm(n0)
    # Group by facing: repeatedly take the most common direction (area-weighted, among the remaining faces) and everything within `angle`.
    left = np.arange(len(N)); groups = []
    while len(left) and A[left].sum() >= min_area:
        votes = (np.clip(N[left]@N[left].T, -1, 1) > math.cos(math.radians(angle)))@A[left] if len(left) < 6000 else None
        seed = left[votes.argmax()] if votes is not None else left[np.argmax(A[left])]
        member = left[N[left]@N[seed] > math.cos(math.radians(angle))]
        if A[member].sum() < min_area: break
        groups.append(member); left = np.setdiff1d(left, member)
    if len(groups) < 2: return dict(ceiling=cid, pieces=1, note='one facing only; nothing to split')
    planes = []
    for gi in groups:
        point, n, inl = fit(mesh, largest_part(mesh, gi)); planes.append(dict(point=point, normal=n, faces=inl, area=float(A[inl].sum())))
    keep = max(range(len(planes)), key=lambda i: planes[i]['normal']@n0)   # the group facing like RoomPlan's piece
    o0 = np.array(piece['center']); u0, v0 = plane_basis(n0)
    to2 = lambda P, o, u, v: np.c_[(P-o)@u, (P-o)@v]
    outline0 = Polygon(to2(np.array(piece['outline']), o0, u0, v0)).convex_hull
    new, footprints = [], []
    for i, pl in enumerate(planes):
        if i == keep: continue
        V = mesh.vertices[np.unique(mesh.faces[pl['faces']])]; u, v = plane_basis(pl['normal'])
        hull = MultiPoint(to2(V, pl['point'], u, v)).convex_hull; ring = np.array(hull.exterior.coords)[:-1]
        outline = pl['point']+ring[:, :1]*u+ring[:, 1:]*v; slope = round(math.degrees(math.acos(min(1, abs(pl['normal'][1])))), 1)
        new.append(dict(id=f'{cid}{chr(ord("b")+len(new))}', label='sloped ceiling' if slope > 5 else 'ceiling', room=piece.get('room'), center=np.round(outline.mean(0), 3).tolist(),
                        normal=np.round(pl['normal'], 3).tolist(), slope=slope, outline=np.round(outline, 3).tolist(), source='scan'))
        footprints.append(MultiPoint(to2(outline, o0, u0, v0)).convex_hull)
    rest = outline0.difference(shapely.union_all(footprints)); rest = max(getattr(rest, 'geoms', [rest]), key=lambda x: x.area)
    ring = np.array(rest.exterior.coords)[:-1]; piece['outline'] = np.round(o0+ring[:, :1]*u0+ring[:, 1:]*v0, 3).tolist(); piece['refit'] = 'split-ceiling'
    i = sem['ceilings'].index(piece); sem['ceilings'][i+1:i+1] = new
    # Walls cannot reach above the ceiling: cut each wall's outline where a new piece's plane passes below its top.
    cut = []
    for c in new:
        n = np.array(c['normal']); pc = np.array(c['center']); foot = Polygon(np.array(c['outline'])[:, [0, 2]]).buffer(.15)
        for w in sem['walls']:
            a = math.radians(w['yaw']); along = np.array([math.cos(a), 0, -math.sin(a)]); o = np.array([w['center'][0], 0, w['center'][2]])
            P = np.array(w.get('outline') or []);
            if len(P) < 3: continue
            us = np.linspace(-w['size'][0]/2, w['size'][0]/2, 41); pts = o+us[:, None]*along
            under = shapely.contains_xy(foot, pts[:, 0], pts[:, 2])
            if not under.any() or abs(n[1]) < 1e-6: continue
            # Height of the ceiling plane above each point of the wall's line.
            h = pc[1]-((pts-pc)@n-(pts[:, 1]-pc[1])*n[1])/n[1]
            if not (h[under] < P[:, 1].max()-.02).any(): continue
            above = Polygon(list(zip(us[under], h[under]))+[(us[under][-1], 99), (us[under][0], 99)]).buffer(0)
            wall2 = Polygon(np.c_[(P-o)@along, P[:, 1]]).convex_hull.difference(above)
            if wall2.is_empty: continue
            wall2 = max(getattr(wall2, 'geoms', [wall2]), key=lambda x: x.area); ring = np.array(wall2.exterior.coords)[:-1]
            w['outline'] = np.round(o+ring[:, :1]*along+ring[:, 1:]*np.array([0, 1, 0]), 3).tolist(); w['refit'] = 'split-ceiling'; cut.append(w['id'])
    layout.relate(sem); wall_openings.cut(sem); sem['revision'] = sem.get('revision', 0)+1; p.write_text(json.dumps(sem, indent=1))
    return dict(ceiling=cid, kept=dict(area=round(planes[keep]['area'], 2), slope=round(math.degrees(math.acos(min(1, abs(planes[keep]['normal'][1])))), 1)),
                added=[dict(id=c['id'], slope=c['slope'], area=round(planes[i]['area'], 2)) for c, i in zip(new, [j for j in range(len(planes)) if j != keep])],
                walls_cut=sorted(set(cut)))

def merge_walls(scene, dry=False, angle=2., offset=.03, gap=.05):
    d = SPACES/scene; m = json.loads((d/'space.json').read_text()); p = d/m['semantic']; sem = json.loads(p.read_text())
    walls = sorted(sem['walls'], key=lambda w: -w['size'][0]); merged = []
    def span(w, o, ax): c = (np.array(w['center'])-o)@ax; return c-w['size'][0]/2, c+w['size'][0]/2
    changed = True
    while changed:
        changed = False
        for a in walls:
            A = box_frame(a); oa = np.array([a['center'][0], 0, a['center'][2]])
            for b in walls:
                if b is a: continue
                B = box_frame(b)
                if abs(A[0]@B[0]) < math.cos(math.radians(angle)) or abs((np.array(b['center'])-oa)@A[2]) > offset: continue
                (a0, a1), (b0, b1) = span(a, oa, A[0]), span(b, oa, A[0])
                if max(a0, b0)-min(a1, b1) > gap: continue
                # One wall from the two: union of their outlines in a's frame (along, up); centre and length from the union's extent.
                to2 = lambda P: np.c_[(np.array(P)-oa)@A[0], np.array(P)[:, 1]]
                rect = lambda w, s0, s1: [(s0, 0), (s1, 0), (s1, w['size'][1]), (s0, w['size'][1])]
                pa = Polygon(to2(a['outline'])) if len(a.get('outline') or []) >= 3 else Polygon(rect(a, a0, a1))
                pb = Polygon(to2(b['outline'])) if len(b.get('outline') or []) >= 3 else Polygon(rect(b, b0, b1))
                # Close the gap between them so the union is one piece.
                bridge = Polygon([(min(a1, b1)-.001, 0), (max(a0, b0)+.001, 0), (max(a0, b0)+.001, min(a['size'][1], b['size'][1])), (min(a1, b1)-.001, min(a['size'][1], b['size'][1]))]) if max(a0, b0) > min(a1, b1) else Polygon()
                g = shapely.union_all([pa.buffer(0), pb.buffer(0), bridge]).buffer(.001).buffer(-.001)
                g = max(getattr(g, 'geoms', [g]), key=lambda x: x.area); ring = np.array(g.exterior.coords)[:-1]
                lo, hi = min(a0, b0), max(a1, b1); mid = oa+A[0]*(lo+hi)/2
                merged.append(dict(into=a['id'], merged=b['id'], length=round(hi-lo, 3)))
                a['parts'] = sorted(set(a.get('parts', [a['id']])+b.get('parts', [b['id']])))
                a['outline'] = np.round(oa+ring[:, :1]*A[0]+ring[:, 1:]*np.array([0, 1, 0]), 3).tolist()
                a['center'] = [round(float(mid[0]), 3), a['center'][1], round(float(mid[2]), 3)]
                a['size'] = [round(hi-lo, 3), max(a['size'][1], b['size'][1]), a['size'][2]]; a['rooms'] = sorted(set(a.get('rooms', [])+b.get('rooms', [])))
                walls.remove(b); changed = True; break
            if changed: break
    if not dry and merged:
        sem['walls'] = sorted(walls, key=lambda w: int(w['id'].split('_')[1])); layout.relate(sem); sem['revision'] = sem.get('revision', 0)+1
        wall_openings.cut(sem); p.write_text(json.dumps(sem, indent=1))
    return merged

def ridges(profile, x, rise=.008, smooth=25):
    """Narrow raised bands of a depth profile (toward the room is positive): profile minus its running median over `smooth` bins."""
    from scipy.ndimage import median_filter
    ok = ~np.isnan(profile); p = np.interp(x, x[ok], profile[ok]) if ok.sum() > 3 else np.zeros_like(x)
    up = p-median_filter(p, size=smooth, mode='nearest') > rise; out, i = [], 0
    while i < len(up):
        if up[i]:
            j = i
            while j+1 < len(up) and up[j+1]: j += 1
            out.append((x[i], x[j])); i = j+1
        else: i += 1
    return out

def align_openings(scene, ids=None, dry=False, reach=.3, step=.02):
    d = SPACES/scene; m = json.loads((d/'space.json').read_text()); p = d/m['semantic']; sem = json.loads(p.read_text())
    mesh = scan_mesh(d/m['scan']['mesh']); C = mesh.triangles_center; out = []
    for b in sem['openings']:
        if (ids and b['id'] not in ids) or (not ids and not b['id'].startswith('Window')): continue
        w = wall_of(sem, b)
        if not w: out.append(dict(id=b['id'], note='no wall')); continue
        W = box_frame(w); o = np.array([w['center'][0], 0, w['center'][2]]); c = np.array(b['center'])
        side = 1. if (c-o)@W[2] >= 0 else -1.; n = W[2]*side
        # The room side of the wall is where the box's centre is; depth = distance toward the room from RoomPlan's centre plane.
        uc, hw, yc, hh = (c-o)@W[0], b['size'][0]/2, c[1], b['size'][1]/2
        P = C-o; u, y, dd = P@W[0], C[:, 1], P@n; near = (dd > -.1)&(dd < .25)
        def profile(axis, lo, hi, band):
            xs = np.arange(lo, hi, step); k = near&band; vals = (u if axis == 'u' else y)[k]; dep = dd[k]
            return xs+step/2, np.array([np.median(dep[(vals >= x)&(vals < x+step)]) if ((vals >= x)&(vals < x+step)).any() else np.nan for x in xs])
        xu, pu = profile('u', uc-hw-reach, uc+hw+reach, np.abs(y-yc) < hh*.5)
        xy, py = profile('y', yc-hh-reach, yc+hh+reach, np.abs(u-uc) < hw*.5)
        def edge(bands, at, outward):
            cand = [(lo, hi) for lo, hi in bands if min(abs(lo-at), abs(hi-at)) < reach or lo <= at <= hi]
            if not cand: return at, False
            lo, hi = min(cand, key=lambda r: min(abs(r[0]-at), abs(r[1]-at)) if not r[0] <= at <= r[1] else 0)
            return (hi+step/2 if outward > 0 else lo-step/2), True
        ru, ry = ridges(pu, xu), ridges(py, xy)
        (u0, f0), (u1, f1) = edge(ru, uc-hw, -1), edge(ru, uc+hw, 1); (y0, f2), (y1, f3) = edge(ry, yc-hh, -1), edge(ry, yc+hh, 1)
        new_c = o+W[0]*(u0+u1)/2+np.array([0, (y0+y1)/2, 0])+n*((c-o)@n); size = [round(u1-u0, 3), round(y1-y0, 3), b['size'][2]]
        out.append(dict(id=b['id'], wall=w['id'], found=dict(left=f0, right=f1, bottom=f2, top=f3),
                        moved_cm=round(float(np.linalg.norm(new_c-c))*100, 1), size_from=b['size'][:2], size_to=size[:2]))
        out[-1].update(_box=b, _wall=w, _u=[u0, u1], _rest=(o, W, n, (c-o)@n, (y0+y1)/2, size))
    # Neighbours sharing one frame member (two windows with one mullion between them) meet at its middle instead of overlapping.
    placed = [r for r in out if '_u' in r]
    for r in placed:
        for q in placed:
            if q is r or q['_wall'] is not r['_wall']: continue
            lo, hi = max(r['_u'][0], q['_u'][0]), min(r['_u'][1], q['_u'][1])
            if lo < hi:
                mid = (lo+hi)/2
                if r['_u'][0] < q['_u'][0]: r['_u'][1] = mid; q['_u'][0] = mid
                else: q['_u'][1] = mid; r['_u'][0] = mid
    for r in placed:
        b, w, (u0, u1), (o, W, n, depth, ym, size) = r.pop('_box'), r.pop('_wall'), r.pop('_u'), r.pop('_rest')
        size = [round(u1-u0, 3), size[1], size[2]]; new_c = o+W[0]*(u0+u1)/2+np.array([0, ym, 0])+n*depth
        r['moved_cm'] = round(float(np.linalg.norm(new_c-np.array(b['center'])))*100, 1); r['size_to'] = size[:2]
        if not dry: b['center'] = np.round(new_c, 3).tolist(); b['size'] = size; b['yaw'] = w['yaw']; b['aligned'] = 'scan-frame'
    if not dry:
        # Boxes moved: editors that loaded an older layout must reload (boxesRevision, see spaces.save_layout).
        layout.relate(sem); sem['revision'] = sem['boxesRevision'] = sem.get('revision', 0)+1; wall_openings.cut(sem); p.write_text(json.dumps(sem, indent=1))
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); ap.add_argument('scene')
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('split-ceiling'); c.add_argument('id'); c.add_argument('--angle', type=float, default=15); c.add_argument('--min-area', type=float, default=.3)
    c = sub.add_parser('align-openings'); c.add_argument('ids', nargs='*'); c.add_argument('--dry-run', action='store_true')
    c = sub.add_parser('merge-walls'); c.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    try:
        r = {'split-ceiling': lambda: split_ceiling(a.scene, a.id, a.angle, a.min_area), 'align-openings': lambda: align_openings(a.scene, a.ids, a.dry_run),
             'merge-walls': lambda: merge_walls(a.scene, a.dry_run)}[a.cmd]()
        print(json.dumps(r, indent=1))
    except ValueError as e: sys.exit(f'error: {e}')
