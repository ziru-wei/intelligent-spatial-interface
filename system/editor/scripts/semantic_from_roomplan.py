#!/usr/bin/env python3
"""Labelled layout from a RoomPlan export (Polycam "Room" mode glTF): furniture and appliances as oriented boxes, doors and windows,
and rooms as floor triangles (for "which room is the user in"). Node names carry the categories (bed_0, refrigerator_0, Floor_Kitchen,
Door_1, ...); geometry is already in world coordinates. --to-space applies the scan's row-major 4x4 toSpace.
Prints semantic.json: {version, source, objects:[{id,label,category,center,size,yaw,room}], openings:[...], rooms:[{id,name,floorY,center,triangles}],
walls:[{id,label,center,size,yaw,rooms,outline}], ceilings:[{id,label,room,center,normal,slope,outline}]}. Walls are 10 cm slabs (size = length,
height above the floor, thickness); outline is the wall's mid-plane shape (gable and knee walls under a sloped roof are not rectangles); rooms are
the rooms on either side. Ceilings come in pieces per room; normal points down into the room, slope is degrees from horizontal.
Runs in .venv-mesh (trimesh).
"""
import argparse, json, math, re
import numpy as np, trimesh
from scipy.spatial import ConvexHull
from layout import room_of, relate

LABELS = {'table_other_rect': 'table', 'chair_other_four_back_no': 'chair', 'storage_shelf': 'shelf', 'storage_cabinet_mid1': 'cabinet',
    'storage_cabinet_mid2': 'cabinet', 'washer_dryer': 'washer', 'television': 'TV'}

def category(node): return re.sub(r'_\d+$', '', node)
def label(cat):
    if cat in LABELS: return LABELS[cat]
    base = cat.split('_')[0]; return LABELS.get(base, base.replace('_', ' '))

def oriented_box(v):
    """Gravity-aligned box: minimum-area rectangle of the xz footprint, plus the y extent. Doors and windows are flat (their footprint
    is a line): principal direction for the width, 2 cm thick."""
    xz, cy, h = v[:, [0, 2]], float((v[:, 1].min()+v[:, 1].max())/2), float(np.ptp(v[:, 1]))
    try:
        T, (w, d) = trimesh.bounds.oriented_bounds_2D(xz)
        inv = np.linalg.inv(T); c2 = inv@np.array([0, 0, 1]); yaw = math.degrees(math.atan2(-inv[1, 0], inv[0, 0]))
        return [float(c2[0]), cy, float(c2[1])], [float(w), h, float(d)], yaw
    except Exception:
        c2 = xz.mean(0); _, _, vt = np.linalg.svd(xz-c2); axis = vt[0]; w = float(np.ptp((xz-c2)@axis))
        return [float(c2[0]), cy, float(c2[1])], [w, h, .02], math.degrees(math.atan2(-axis[1], axis[0]))

def outline(v, origin, u, w):
    """Convex outline of points in the plane through origin spanned by unit vectors u, w; as 3D points (mm-rounded)."""
    q = np.c_[(v-origin)@u, (v-origin)@w]
    try: hull = q[ConvexHull(q).vertices]
    except Exception: return []
    return [np.round(origin+a*u+b*w, 3).tolist() for a, b in hull]

def wall(node, v, rooms, floor_y):
    center, size, yaw = oriented_box(v)
    a = math.radians(yaw); along, normal = np.array([math.cos(a), 0, -math.sin(a)]), np.array([math.sin(a), 0, math.cos(a)])
    bottom, top = max(float(v[:, 1].min()), floor_y), float(v[:, 1].max())
    c = np.array([center[0], (bottom+top)/2, center[2]])
    near = set()
    for t in np.linspace(-.4, .4, 5)*size[0]:
        for side in (-1, 1):
            p = c+along*t+normal*side*(size[2]/2+.25); r = room_of(rooms, p)
            if r: near.add(r)
    return dict(id=node, label='wall', center=np.round(c, 3).tolist(), size=[round(size[0], 3), round(top-bottom, 3), round(size[2], 3)], yaw=round(yaw, 1),
        rooms=sorted(near), outline=[[x, round(max(y, bottom), 3), z] for x, y, z in outline(v, c, along, np.array([0., 1, 0]))])

def ceiling(node, v):
    c = v.mean(0); _, _, vt = np.linalg.svd(v-c); n = vt[2]*(-1 if vt[2][1] > 0 else 1)
    u = np.cross(n, [0, 0, 1.]) if abs(n[2]) < .9 else np.cross(n, [1., 0, 0]); u /= np.linalg.norm(u); w = np.cross(n, u)
    slope = round(math.degrees(math.acos(min(1, abs(n[1])))), 1); room = node.split('_')[1].lower()
    return dict(id=node, label='sloped ceiling' if slope > 5 else 'ceiling', room=room, center=np.round(c, 3).tolist(), normal=np.round(n, 3).tolist(),
        slope=slope, outline=outline(v, c, u, w))

def extract(path, to_space=None):
    scene = trimesh.load(path); M = np.array(to_space or np.eye(4).reshape(-1), float).reshape(4, 4)
    world = lambda node: trimesh.transform_points(scene.geometry[scene.graph[node][1]].vertices, M@scene.graph[node][0])
    rooms, objects, openings = [], [], []
    for node in scene.graph.nodes_geometry:
        if node.startswith('Floor_'):
            m = scene.geometry[scene.graph[node][1]]; v = world(node); top = v[:, 1].max()
            tris = [[[round(float(p[0]), 3), round(float(p[2]), 3)] for p in v[f]] for f in m.faces if np.all(np.abs(v[f][:, 1]-top) < 1e-3)]
            name = node[len('Floor_'):]; xz = v[:, [0, 2]]
            rooms.append(dict(id=name.lower(), name=name, floorY=round(float(top), 3), center=np.round(xz.mean(0), 3).tolist(), triangles=tris))
    floor_y = min((r['floorY'] for r in rooms), default=0.0)
    walls = [wall(n, world(n), rooms, floor_y) for n in scene.graph.nodes_geometry if n.startswith('Wall_')]
    ceilings = [ceiling(n, world(n)) for n in scene.graph.nodes_geometry if n.startswith('Ceiling_')]
    for node in scene.graph.nodes_geometry:
        cat = category(node)
        if cat.startswith(('Floor', 'Ceiling', 'Wall', 'Joint')): continue
        center, size, yaw = oriented_box(world(node))
        room = room_of(rooms, center)
        item = dict(id=node, label=label(cat) if cat[0].islower() else cat.lower(), category=cat, center=np.round(center, 3).tolist(),
            size=np.round(size, 3).tolist(), yaw=round(yaw, 1), room=room)
        (openings if cat in ('Door', 'Window') else objects).append(item)
    return relate(dict(version=1, source='roomplan', objects=sorted(objects, key=lambda o: o['id']), openings=sorted(openings, key=lambda o: o['id']), rooms=rooms,
        walls=sorted(walls, key=lambda o: int(o['id'].split('_')[1])), ceilings=sorted(ceilings, key=lambda o: o['id'])))

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('roomplan_glb'); p.add_argument('--to-space', help='JSON list of 16 numbers')
    a = p.parse_args(); print(json.dumps(extract(a.roomplan_glb, json.loads(a.to_space) if a.to_space else None)))
