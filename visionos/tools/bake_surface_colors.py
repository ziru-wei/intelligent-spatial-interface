"""Bakes the scan's colours onto the surfaces answer text may go on (surfaces.json, export-space.mjs), for the Vision Pro app: the
headset gives no camera image, so the text's colour and the clutter behind it (editor/src/legibility.mjs, surface-quality.mjs) are
judged from what the scan saw there instead.

For each surface, a grid every CELL metres over its rectangle (width x height, from its origin along right and up): a ray from
LIFT in front of the surface, back along its normal, up to DEPTH behind it, onto the scan's textured mesh; the cell takes the texture's
colour where it hits (alpha 255), or stays transparent (no scan there, or nothing within reach, or outside the surface's outline:
alpha 0). Written as one RGBA PNG per surface (row 0 at the top: up = +y), named by the surface's index in surfaces.json, plus
colors.json {cell, files: {surface id: file}}.

    editor/.venv-mesh/bin/python visionos/tools/bake_surface_colors.py [space=atlas]
"""
import json, sys
from pathlib import Path
import numpy as np
import open3d as o3d
import trimesh
from PIL import Image

CELL, LIFT, DEPTH, MAX_SIDE = .025, .25, .25, 600
HERE = Path(__file__).resolve().parent
EDITOR = HERE.parent.parent/'editor'

def textured_scan(glb):
    """The scan's meshes in scene coordinates, each with what colours it: (vertices, faces, uv or None, texture (H x W x 3) or None,
    flat colour)."""
    scene = trimesh.load(glb, force='scene'); parts = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]; g = scene.geometry[name]
        v = trimesh.transformations.transform_points(g.vertices, transform)
        uv = getattr(g.visual, 'uv', None); mat = getattr(g.visual, 'material', None)
        tex = getattr(mat, 'baseColorTexture', None) if mat is not None else None
        factor = getattr(mat, 'baseColorFactor', None) if mat is not None else None
        flat = np.array([200, 200, 200] if factor is None else factor, float)[:3]
        if flat.max() <= 1: flat = flat*255
        parts.append((np.asarray(v, np.float32), np.asarray(g.faces, np.int32), None if uv is None or tex is None else np.asarray(uv, np.float32),
                      None if tex is None or uv is None else np.asarray(tex.convert('RGB')), flat))
    return parts

def main(space='atlas'):
    res = HERE.parent/'SpaceData'/space
    surfaces = json.loads((res/'surfaces.json').read_text())['surfaces']
    manifest = json.loads((EDITOR/'spaces'/space/'space.json').read_text())
    parts = textured_scan(EDITOR/'spaces'/space/manifest['scan']['mesh'])
    rc = o3d.t.geometry.RaycastingScene()
    ids = [rc.add_triangles(o3d.core.Tensor(v), o3d.core.Tensor(f.astype(np.uint32))) for v, f, *_ in parts]
    by_id = dict(zip(ids, parts))
    out = res/'colors'; out.mkdir(exist_ok=True)
    for old in out.glob('*.png'): old.unlink()
    files = {}
    for i, s in enumerate(surfaces):
        if s['kind'] == 'ceiling': continue   # no text there
        o, n, r, u = (np.array(s[k], np.float32) for k in ('origin', 'normal', 'right', 'up'))
        cell = max(CELL, max(s['width'], s['height'])/MAX_SIDE)
        w, h = max(1, int(np.ceil(s['width']/cell))), max(1, int(np.ceil(s['height']/cell)))
        xs = (np.arange(w)+.5)*cell-s['width']/2; ys = s['height']/2-(np.arange(h)+.5)*cell
        X, Y = np.meshgrid(xs, ys)
        pts = o+X[..., None]*r+Y[..., None]*u
        rays = np.concatenate([(pts+n*LIFT).reshape(-1, 3), np.broadcast_to(-n, (h*w, 3))], 1).astype(np.float32)
        hit = rc.cast_rays(o3d.core.Tensor(rays))
        t = hit['t_hit'].numpy(); gid = hit['geometry_ids'].numpy(); pid = hit['primitive_ids'].numpy(); bary = hit['primitive_uvs'].numpy()
        rgba = np.zeros((h*w, 4), np.uint8)
        ok = np.isfinite(t) & (t <= LIFT+DEPTH)
        # Inside the outline (holes cut out): barycentric test against the surface's own triangles.
        tri = np.array(s['triangles'], np.float32).reshape(-1, 3, 2); P = np.stack([X.ravel(), Y.ravel()], 1); inside = np.zeros(len(P), bool)
        for a, b, c in tri:
            d = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(d) < 1e-12: continue
            l1 = ((b[1]-c[1])*(P[:, 0]-c[0])+(c[0]-b[0])*(P[:, 1]-c[1]))/d; l2 = ((c[1]-a[1])*(P[:, 0]-c[0])+(a[0]-c[0])*(P[:, 1]-c[1]))/d
            inside |= (l1 >= -1e-6) & (l2 >= -1e-6) & (1-l1-l2 >= -1e-6)
        ok &= inside
        for g in np.unique(gid[ok]):
            v, f, uv, tex, flat = by_id[int(g)]; m = ok & (gid == g)
            if uv is None: rgba[m, :3] = flat.astype(np.uint8); rgba[m, 3] = 255; continue
            face = f[pid[m]]; b1, b2 = bary[m, 0:1], bary[m, 1:2]
            p = uv[face[:, 0]]*(1-b1-b2)+uv[face[:, 1]]*b1+uv[face[:, 2]]*b2
            H, W = tex.shape[:2]
            px = np.clip((p[:, 0] % 1)*W, 0, W-1).astype(int); py = np.clip((1-(p[:, 1] % 1))*H, 0, H-1).astype(int)
            rgba[m, :3] = tex[py, px]; rgba[m, 3] = 255
        name = f'{i:04d}.png'; Image.fromarray(rgba.reshape(h, w, 4)).save(out/name, optimize=True)
        files[s['id']] = dict(file=name, cell=cell, columns=w, rows=h, coverage=round(float(ok.mean()), 3))
    (res/'colors.json').write_text(json.dumps(dict(cell=CELL, files=files)))
    covered = [f['coverage'] for f in files.values()]
    print(f'{space}: {len(files)} surfaces baked, median coverage {np.median(covered):.2f}, {sum(c < .2 for c in covered)} under 20%')

POINTS = 400_000

def scan_points(space='atlas'):
    """The scan as points with normals, for fine alignment on the headset (ICP of its live mesh against them): POINTS samples spread
    evenly over the scan's surface (by area), float32 x, y, z, nx, ny, nz each (space coordinates), in SpaceData/<space>/scan-points.bin."""
    manifest = json.loads((EDITOR/'spaces'/space/'space.json').read_text())
    mesh = trimesh.load(EDITOR/'spaces'/space/manifest['scan']['mesh'], force='scene').dump(concatenate=True)
    pts, faces = trimesh.sample.sample_surface_even(mesh, POINTS, seed=1) if hasattr(trimesh.sample, 'sample_surface_even') else trimesh.sample.sample_surface(mesh, POINTS, seed=1)
    data = np.concatenate([pts, mesh.face_normals[faces]], 1).astype(np.float32)
    out = HERE.parent/'SpaceData'/space/'scan-points.bin'; out.write_bytes(data.tobytes())
    print(f'{space}: {len(data)} scan points → {out.relative_to(HERE.parent.parent)}')

if __name__ == '__main__':
    main(*sys.argv[1:])
    scan_points(*sys.argv[1:])
