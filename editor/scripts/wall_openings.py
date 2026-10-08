"""Openings (doors, windows) cut into the layout's walls: a pre-processing step of scene setup, run before every segmentation
(scripts/segment_surfaces.py run) so the cuts follow the opening boxes as they are edited.

Doors and windows are part of the room's shell, like the walls, so the cut lives in the floor plan (scan/semantic.json), where every
consumer reads it (the 3D view's Walls layer, segmentation, the agent's context, later placement on free wall), rather than being
redone by each of them. Per wall:
  outline   the wall's full shape (RoomPlan, merged or cut under a slope by scripts/structure.py); never changed here
  region    outline minus its openings: [[exterior ring, hole ring, ...], ...] of 3D points (a door reaching the floor makes a notch;
            one spanning the full height splits the wall in parts)
  openings  ids of the doors and windows cut into it
An opening belongs to the wall parallel to its face, within 15 cm of it and overlapping it along the wall. Recomputed from `outline`
every time, so it can run any number of times. No dependencies beyond numpy and shapely.
"""
import math
import numpy as np, shapely
from shapely.geometry import Polygon

def frame(b):
    a = math.radians(b.get('yaw', 0)); return np.array([[math.cos(a), 0, -math.sin(a)], [0, 1, 0], [math.sin(a), 0, math.cos(a)]])

def wall_of(sem, box):
    """The wall a door or window sits in: parallel to the box's face, within 15 cm of it, overlapping it along the wall."""
    R = frame(box); c = np.array(box['center']); best = None
    for w in sem.get('walls', []):
        W = frame(w); o = np.array(w['center'])
        if abs(W[2]@R[2]) < .95: continue
        off = abs((c-o)@W[2]); along = abs((c-o)@W[0])
        if off < .15 and along < w['size'][0]/2+.05 and (best is None or off < best[0]): best = (off, w)
    return best and best[1]

def wall_plane(w):
    """Origin on the floor below the wall's centre, unit vector along the wall; points map to (along, height)."""
    W = frame(w); return np.array([w['center'][0], 0, w['center'][2]]), W[0]

def cut(sem):
    """Set every wall's region and openings from its outline and the openings in it. Returns {wall id: m² cut}."""
    by_wall = {}
    for b in sem.get('openings', []):
        if b.get('parent'): continue   # a part of another opening (a window's glass) is inside its hole already
        w = wall_of(sem, b)
        if w: by_wall.setdefault(w['id'], []).append(b)
    report = {}
    for w in sem.get('walls', []):
        o, along = wall_plane(w); up = np.array([0., 1, 0]); P = np.array(w.get('outline') or [])
        if len(P) < 3: continue
        shell = Polygon(np.c_[(P-o)@along, P[:, 1]]).buffer(0)
        holes = []
        for b in by_wall.get(w['id'], []):
            uc, hw, yc, hh = (np.array(b['center'])-o)@along, b['size'][0]/2, b['center'][1], b['size'][1]/2
            holes.append(Polygon([(uc-hw, yc-hh), (uc+hw, yc-hh), (uc+hw, yc+hh), (uc-hw, yc+hh)]))
        region = shell.difference(shapely.union_all(holes)) if holes else shell
        parts = [g for g in getattr(region, 'geoms', [region]) if g.geom_type == 'Polygon' and g.area > 1e-4]
        lift = lambda ring: np.round(o+np.array(ring)[:-1, :1]*along+np.array(ring)[:-1, 1:]*up, 3).tolist()
        w['region'] = [[lift(g.exterior.coords)]+[lift(r.coords) for r in g.interiors] for g in parts]
        w['openings'] = sorted(b['id'] for b in by_wall.get(w['id'], []))
        if holes: report[w['id']] = round(shell.area-sum(g.area for g in parts), 3)
    return report

def region_polygon(w, o, u, v):
    """A wall's region (or its outline, before any cut) as one shapely polygon in the coordinates (u, v) of a plane through o."""
    to2 = lambda ring: np.c_[(np.array(ring)-o)@u, (np.array(ring)-o)@v]
    if w.get('region'): return shapely.union_all([Polygon(to2(part[0]), [to2(h) for h in part[1:]]).buffer(0) for part in w['region']])
    return Polygon(to2(w['outline'])).buffer(0)
