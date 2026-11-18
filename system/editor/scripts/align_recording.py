#!/usr/bin/env python3
"""Align a recording to its scene from the parts of the scene it shows.

A recording covers only part of the scene and adds what the scan never saw (clutter, people). So the reference is not the whole scan but
what the user selected as seen in the recording (session.json `alignTarget`, or --target): layout surfaces (walls, ceiling pieces, zone
floors: the chosen scan's triangles on each, scripts/scan_geometry.py near) and boxes, doors and windows included (the scan's triangles
inside each box).

  align_recording.py <scene dir> <recording dir> [--target target.json]      target: {"surfaces": [ids], "boxes": [ids]}

Recordings should show some floor: the recording's lowest plane facing up is then tried as the floor first (selecting the floor too
helps); every other pairing of horizontal planes is tried as well, as with little floor in view that plane may be a table top. Source: the recording's own LiDAR depth (every few frames), in its own frame. Both frames are gravity-aligned, so the unknown is a yaw and
a translation. Starting points: every 10° of yaw with the medians of the two clouds matched (the target is what the recording shows, so
their middles correspond; medians ignore clutter), FPFH + RANSAC, and the current alignment if there is one. Each is refined by
point-to-plane ICP with a Tukey loss (points far from every target surface, the clutter, stop pulling), then locked to gravity.
Candidates that put the recorded camera outside a person's reach (5-95% of its heights within 0.3-2.4 m above the floor) are dropped;
the winner explains the selected elements best: the mean, over the selected elements, of the share of each with recording points within
4 cm (a large element, such as a floor the recording barely sees, cannot outvote the rest).
Prints JSON: toSpace (row-major 4x4), explained (that mean), fitness (share of recording points within 4 cm of the target), coverage
(share of the target within 4 cm of the recording), rmse (m), cameraHeight [5%, 95%] (m), yaw (deg), method, points [recording, target].
Runs in .venv-mesh (open3d, trimesh).
"""
import argparse, json, math, sys
from pathlib import Path
import numpy as np, open3d as o3d, trimesh
sys.path.insert(0, str(Path(__file__).resolve().parent))
from register_scenario import scenario_points, prepare, lock_gravity, rot_y, VOXEL
from scan_geometry import box_frame, scan_mesh, layout_surfaces, near

DENSITY = 600   # target samples per m² (about 4 cm apart)

def target_cloud(scene, target):
    """Points with normals on the selected surfaces and in the selected boxes, in scene coordinates, and for each point the index of
    the selected element it belongs to."""
    m = json.loads((scene/'space.json').read_text()); sem = json.loads((scene/m['semantic']).read_text()); parts = []
    mesh = scan_mesh(scene/m['scan']['mesh']) if target.get('surfaces') or target.get('boxes') else None
    if target.get('surfaces'):
        surfaces = {s['id']: s for s in layout_surfaces(sem)}
        for sid in target['surfaces']:
            s = surfaces.get(sid); idx = near(mesh, s, facing=.5 if s and s['kind'] == 'ceiling' else .8) if s else []
            if len(idx): parts.append(mesh.submesh([idx], append=True))
    if target.get('boxes'):
        C = mesh.triangles_center; boxes = {b['id']: b for b in sem.get('objects', [])+sem.get('openings', [])}
        for bid in target['boxes']:
            b = boxes.get(bid)
            if not b: continue
            inside = np.all(np.abs((C-np.array(b['center']))@box_frame(b).T) <= np.array(b['size'])/2+.03, 1)
            if inside.any(): parts.append(mesh.submesh([np.nonzero(inside)[0]], append=True))
    if not parts: raise ValueError('Nothing selected to align to (or the scan has nothing there).')
    pts, nrm, lab = [], [], []
    for i, part in enumerate(parts):
        P, face = trimesh.sample.sample_surface(part, max(300, int(part.area*DENSITY))); pts.append(P); nrm.append(part.face_normals[face]); lab.append(np.full(len(P), i))
    pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(np.concatenate(pts))); pc.normals = o3d.utility.Vector3dVector(np.concatenate(nrm))
    return pc, np.concatenate(lab)

def robust_icp(src, dst, T, dists=(.4, .2, .1, .05)):
    for dist in dists:
        est = o3d.pipelines.registration.TransformationEstimationPointToPlane(o3d.pipelines.registration.TukeyLoss(k=max(.04, dist/2)))
        T = o3d.pipelines.registration.registration_icp(src, dst, dist, T, est, o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=40)).transformation
    return T

def element_cover(src, dst, labels, T, dist=.04):
    """Mean over the selected elements of the share of each one that has recording points within dist: every selected wall, table and
    floor should be explained, so a large one (a floor the recording barely sees) cannot outvote the rest by matching something else (a
    table top). A point counts only where the recording sees that surface from the same side (normals agree): a wall matched from behind, or a
    table top matched upside down, explains nothing."""
    from scipy.spatial import cKDTree
    R, t = T[:3, :3], T[:3, 3]; P = np.asarray(src.points)@R.T+t; Ns = np.asarray(src.normals)@R.T
    Q, Nd = np.asarray(dst.points), np.asarray(dst.normals); d, i = cKDTree(P).query(Q, distance_upper_bound=dist)
    ok = np.isfinite(d); ok[ok] = np.einsum('ij,ij->i', Nd[ok], Ns[i[ok]]) > .3
    return float(np.mean([ok[labels == k].mean() for k in np.unique(labels)]))

class QuickCover:
    """element_cover's ranking twin for many starts: the target's tree is built once and the moved recording points look up their
    nearest target point (normals agreeing); an element's share is the share of its points hit. Coarser, but the same order."""
    def __init__(self, src, dst, labels):
        from scipy.spatial import cKDTree
        self.P, self.Ns = np.asarray(src.points), np.asarray(src.normals); self.tree = cKDTree(np.asarray(dst.points)); self.Nd = np.asarray(dst.normals)
        self.labels = labels; self.sizes = np.bincount(labels).astype(float); self.k = len(self.sizes)
    def __call__(self, T, dist=.08):
        R, t = T[:3, :3], T[:3, 3]; d, i = self.tree.query(self.P@R.T+t, distance_upper_bound=dist); ok = np.isfinite(d)
        ok[ok] = np.einsum('ij,ij->i', self.Nd[i[ok]], self.Ns[ok]@R.T) > .3
        hit = np.unique(i[ok]); return float(np.mean(np.bincount(self.labels[hit], minlength=self.k)/np.maximum(self.sizes, 1)))

def camera_heights(recording, T):
    """Heights of the recorded camera in scene coordinates (floor at y = 0) under T."""
    s = json.loads((recording/'session.json').read_text()); C = np.array([f['position'] for f in s['frames'][::10]])
    return C@T[1, :3]+T[1, 3]

def score(src, dst, T, dist=.04):
    """(recording points within dist of the target, share of the target within dist of the recording, inlier rmse)."""
    ev = o3d.pipelines.registration.evaluate_registration(src, dst, dist, T)
    back = o3d.pipelines.registration.evaluate_registration(dst, src, dist, np.linalg.inv(T))
    return len(ev.correspondence_set), back.fitness, ev.inlier_rmse

def planes(pc, face_to=None, max_planes=8, min_share=.02, dist=.02):
    """Main planes of a cloud: [(unit normal, offset d with n·x = d, inlier count)]. Normals face the room: toward face_to (the camera
    positions, for a recording) or along the cloud's own normals (the scan's surfaces face the room)."""
    from scipy.spatial import cKDTree
    rest = o3d.geometry.PointCloud(pc); out = []; total = len(pc.points)
    for _ in range(max_planes):
        if len(rest.points) < total*min_share: break
        (a, b, c, d), idx = rest.segment_plane(dist, 3, 500)
        if len(idx) < total*min_share: break
        n = np.array([a, b, c]); X = np.asarray(rest.points)[idx]
        ref = (face_to[cKDTree(face_to).query(X.mean(0))[1]]-X.mean(0)) if face_to is not None else np.asarray(rest.normals)[idx].mean(0)
        if n@ref < 0: n, d = -n, -d
        out.append((n, -d, len(idx))); rest = rest.select_by_index(idx, invert=True)
    return out

def plane_starts(src, dst, cams, floor_y=0., along_step=.05):
    """Starting transforms from planes: a vertical plane of the recording on a vertical plane of the target fixes the yaw and the offset
    along that plane's normal; a horizontal one (facing up: floor, table top) on a horizontal one fixes the height; what is left, the
    position along the wall, is swept. Indoors this needs no overall overlap: the target may be whole walls and floors of which the
    recording sees a corner."""
    ps, pt = planes(src, cams), planes(dst)
    vs = [p for p in ps if abs(p[0][1]) < .2]; vt = [p for p in pt if abs(p[0][1]) < .2]
    hs = [p for p in ps if p[0][1] > .9]; ht = [p for p in pt if p[0][1] > .9]
    # Recordings should include some floor: their lowest plane facing up then goes on the scene's floor. That plane may also be a table
    # top (little floor in view), so every horizontal plane of the recording is also tried on every one of the target; the scoring picks.
    floor = min(hs, key=lambda p: p[1]) if hs else None
    pairs = list(dict.fromkeys(([(floor[1], floor_y)] if floor else [])+[(a[1], b[1]) for a in hs[:3] for b in ht[:4]]))
    Q = np.asarray(dst.points); lo, hi = Q.min(0), Q.max(0); out = []
    for ns, ds, _ in vs[:3]:
        for nt, dt, _ in vt[:4]:
            yaw = math.atan2(ns[0], ns[2])-math.atan2(nt[0], nt[2]); R = rot_y(yaw)[:3, :3]
            if np.dot(R@ns, nt) < .99: R = rot_y(-yaw)[:3, :3]
            if np.dot(R@ns, nt) < .99: continue
            u = np.cross([0, 1, 0], nt); u /= np.linalg.norm(u); span = np.ptp(Q@u)+np.ptp(np.asarray(src.points)@R.T@u)
            heights = pairs or [(None, None)]
            for hs_d, ht_d in heights:
                for s_ in np.arange(-span, span+1e-9, along_step):
                    T = np.eye(4); T[:3, :3] = R
                    t = nt*(dt-ds)+u*(s_+(Q.mean(0)-np.asarray(src.points).mean(0)@R.T)@u)
                    t[1] = (ht_d-hs_d) if hs_d is not None else t[1]
                    T[:3, 3] = t; out.append((T, 'selected · planes'))
    return out

def align(scene, recording, target):
    scene, recording = Path(scene), Path(recording)
    src = prepare(scenario_points(recording, step=10)); dst, labels = target_cloud(scene, target)
    # Normals of the recording's points face the camera that saw them (the nearest position on its path): a surface has a front.
    from scipy.spatial import cKDTree
    cams = np.array([f['position'] for f in json.loads((recording/'session.json').read_text())['frames'][::5]])
    Ps, Ns = np.asarray(src.points), np.asarray(src.normals); toward = cams[cKDTree(cams).query(Ps)[1]]-Ps
    Ns[np.einsum('ij,ij->i', Ns, toward) < 0] *= -1; src.normals = o3d.utility.Vector3dVector(Ns)
    P, Q = np.asarray(src.points), np.asarray(dst.points); med = lambda X: np.median(X, 0)
    m = json.loads((scene/'space.json').read_text()); sem = json.loads((scene/m['semantic']).read_text())
    starts = plane_starts(src, dst, cams, min((r.get('floorY', 0) for r in sem.get('rooms', [])), default=0.))
    for deg in range(0, 360, 10):
        T = rot_y(math.radians(deg)); T[:3, 3] = med(Q)-med(P@T[:3, :3].T); starts.append((T, 'selected · yaw sweep'))
    feature = lambda pc: o3d.pipelines.registration.compute_fpfh_feature(pc, o3d.geometry.KDTreeSearchParamHybrid(radius=VOXEL*5, max_nn=100))
    if not dst.has_normals(): dst.estimate_normals()
    ransac = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(src, dst, feature(src), feature(dst), True, VOXEL*1.5,
        o3d.pipelines.registration.TransformationEstimationPointToPoint(False), 3,
        [o3d.pipelines.registration.CorrespondenceCheckerBasedOnDistance(VOXEL*1.5)], o3d.pipelines.registration.RANSACConvergenceCriteria(200000, .999))
    starts.append((ransac.transformation, 'selected · fpfh'))
    s = json.loads((recording/'session.json').read_text())
    if s.get('toSpace'): starts.append((np.array(s['toSpace'], float).reshape(4, 4), 'selected · from current'))
    # The phone was held by a person: its height above the floor stays within a plausible range. Starts that put it elsewhere are out.
    plausible = lambda T: np.all((lambda h: (np.percentile(h, 5) > .3)&(np.percentile(h, 95) < 2.4))(camera_heights(recording, T)))
    # Every start scored as it is (how well each selected element is explained); the best ones get a coarse ICP, then the best of those
    # are refined to the end.
    quick = QuickCover(src, dst, labels)
    ranked = sorted(((quick(T), T, how) for T, how in starts if plausible(T)), key=lambda c: -c[0])[:40]
    coarse = []
    for _, T, how in ranked:
        T = robust_icp(src, dst, T, (.3, .15))
        if plausible(T): coarse.append((element_cover(src, dst, labels, T, .08), T, how))
    if not coarse: raise ValueError('No alignment puts the camera at a plausible height; check the selection.')
    best = None
    for _, T, how in sorted(coarse, key=lambda c: -c[0])[:6]:
        T = lock_gravity(src, dst, robust_icp(src, dst, T))
        if not plausible(T): continue
        e = element_cover(src, dst, labels, T); n, cov, rmse = score(src, dst, T)
        if best is None or e > best[1]: best = (T, e, n, cov, rmse, how)
    if best is None: raise ValueError('No alignment puts the camera at a plausible height; check the selection.')
    T, e, n, cov, rmse, how = best
    yaw = math.degrees(math.atan2(T[0, 2], T[0, 0]))
    h = camera_heights(recording, T)
    return dict(toSpace=[round(float(v), 6) for v in T.reshape(-1)], fitness=round(n/len(P), 3), coverage=round(cov, 3), explained=round(e, 3), rmse=round(rmse, 4),
                cameraHeight=[round(float(np.percentile(h, 5)), 2), round(float(np.percentile(h, 95)), 2)], yaw=round(yaw, 2),
                tilt=0.0, method=how, points=[len(P), len(Q)])

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('scene'); ap.add_argument('recording'); ap.add_argument('--target', help='JSON file {surfaces, boxes}; default: the recording\'s alignTarget')
    a = ap.parse_args()
    target = json.loads(Path(a.target).read_text()) if a.target else json.loads((Path(a.recording)/'session.json').read_text()).get('alignTarget') or {}
    try: print(json.dumps(align(a.scene, a.recording, target)))
    except ValueError as e: sys.exit(f'error: {e}')
