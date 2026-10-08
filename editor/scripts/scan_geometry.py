"""The chosen scan seen through the layout: offline scene setup only (aligning recordings, fixing the layout's structure). At runtime
the editor uses the layout itself plus each recording's LiDAR depth; the scan is not split into surfaces.

  scan_mesh(path)              the scan as one trimesh, in the scene's coordinates
  box_frame(box)               rows: the box's (or wall's) x, y, z axes in the scene
  layout_surfaces(sem)         the layout's walls, ceiling pieces and zone floors as planes with an outline (ids Wall_*, Ceiling_*,
                               Floor_<zone>, as the editor's align panel names them)
  near(mesh, surface, ...)     the scan's triangles on a layout surface: facing like it, inside its outline, within a band of its plane

Runs in .venv-mesh (trimesh, shapely).
"""
import math
import numpy as np, trimesh, shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union
import wall_openings

def scan_mesh(path):
    sc = trimesh.load(path, force='scene')
    parts = [sc.geometry[g].copy().apply_transform(T) for n in sc.graph.nodes_geometry for T, g in [sc.graph[n]]]
    return trimesh.util.concatenate([trimesh.Trimesh(p.vertices, p.faces, process=False) for p in parts])

def box_frame(b):
    a = math.radians(b.get('yaw', 0)); return np.array([[math.cos(a), 0, -math.sin(a)], [0, 1, 0], [math.sin(a), 0, math.cos(a)]])

def layout_surfaces(sem):
    """Each surface: id, kind (wall, ceiling, floor), origin, unit axes u, v and normal, its outline in (u, v) (shapely) and slack (half
    the wall's thickness: a wall is a slab around its mid-plane, the scan sees its faces)."""
    out = []
    for w in sem.get('walls', []):
        R = box_frame(w); c = np.array(w['center']); u, n = R[0], R[2]; v = np.array([0., 1, 0]); o = np.array([c[0], 0, c[2]])
        shape = wall_openings.region_polygon(w, o, u, v) if len(w.get('outline') or []) >= 3 else Polygon([(-w['size'][0]/2, 0), (w['size'][0]/2, 0), (w['size'][0]/2, w['size'][1]), (-w['size'][0]/2, w['size'][1])])
        out.append(dict(id=w['id'], kind='wall', origin=o, u=u, v=v, normal=n, shape=shape, slack=w['size'][2]/2))
    for c in sem.get('ceilings', []):
        o = np.array(c['center']); n = np.array(c.get('normal') or [0, -1, 0], float); n /= np.linalg.norm(n)
        u = np.cross(n, [0, 0, 1.]) if abs(n[2]) < .9 else np.cross(n, [1., 0, 0]); u /= np.linalg.norm(u); v = np.cross(n, u)
        pts = np.array(c.get('outline') or [])
        if len(pts) < 3: continue
        out.append(dict(id=c['id'], kind='ceiling', origin=o, u=u, v=v, normal=n, shape=Polygon(np.c_[(pts-o)@u, (pts-o)@v]).convex_hull, slack=0))
    for z in sem.get('rooms', []):
        parts = z.get('polygon') or [[t] for t in z.get('triangles', [])]
        if not parts: continue
        shape = unary_union([Polygon(p[0], p[1:]) for p in parts]).buffer(0)
        out.append(dict(id='Floor_'+z['id'], kind='floor', origin=np.array([0, z.get('floorY', 0), 0.]), u=np.array([1., 0, 0]), v=np.array([0., 0, 1]),
                        normal=np.array([0., 1, 0]), shape=shape, slack=0))
    return out

def near(mesh, s, behind=.12, front=.12, facing=.8, grow=.05):
    """Indices of the scan triangles on layout surface s: facing like it (cos > facing; a wall either way, it has two faces), with the
    centre inside its outline grown by `grow`, and from `behind` beyond its face to `front` into the room (RoomPlan's planes sit a few cm
    off the real surface)."""
    C, N = mesh.triangles_center, mesh.face_normals; d = (C-s['origin'])@s['normal']; c = N@s['normal']
    if s['kind'] == 'wall': ok = (np.abs(c) > facing)&(np.abs(d) >= max(0, s['slack']-behind))&(np.abs(d) <= s['slack']+front)
    else: ok = (c > facing)&(d >= -behind)&(d <= front)
    idx = np.nonzero(ok)[0]
    if not len(idx): return idx
    uv = np.c_[(C[idx]-s['origin'])@s['u'], (C[idx]-s['origin'])@s['v']]
    return idx[shapely.contains_xy(s['shape'].buffer(grow), uv[:, 0], uv[:, 1])]
