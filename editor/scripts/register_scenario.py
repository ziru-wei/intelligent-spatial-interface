#!/usr/bin/env python3
"""Align a scenario recording (or another scan's mesh, --mesh) to its space's reference: find toSpace, the transform from the source's
frame to the reference's.

Both frames are gravity-aligned (ARKit y is up), so the unknown is mostly a yaw and a translation. Two global guesses are refined with
point-to-plane ICP and the better one is kept:
  - yaw sweep: every 10° of yaw, horizontal centroids matched and floors (5th-percentile height) matched;
  - FPFH features + RANSAC.
A scenario's points come from its own LiDAR depth (every few frames, 5 cm voxels); meshes are sampled uniformly by area.
The result is then locked to gravity (yaw only) with the translation re-solved.
Prints JSON: toSpace (row-major 4x4), fitness (share of scenario points within 4 cm of the scan), rmse (m), yaw (deg), tilt (deg, 0 after locking).
Runs in .venv-mesh (open3d, trimesh).
"""
import argparse, json, math
from pathlib import Path
import numpy as np, open3d as o3d, trimesh
from PIL import Image

VOXEL = .05

def scan_points(mesh_path, n=150000):
    tm = trimesh.load(mesh_path, force='mesh')
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(np.asarray(tm.vertices)), o3d.utility.Vector3iVector(np.asarray(tm.faces)))
    return m.sample_points_uniformly(n)

def scenario_points(scenario, step=15, max_depth=4.0):
    """World points (the recording's own frame) from its per-frame depth PNGs (uint16 mm in R/G)."""
    s = json.loads((Path(scenario)/'session.json').read_text()); k = s['intrinsics']; pts = []
    for f in s['frames'][::step]:
        a = np.asarray(Image.open(Path(scenario)/f['depth'])).astype(np.float32); d = (a[..., 0]*256+a[..., 1])/1000
        h, w = d.shape; v, u = np.mgrid[0:h, 0:w]; ok = (d > .1) & (d < max_depth)
        u, v, d = (u[ok]+.5)*k['width']/w, (v[ok]+.5)*k['height']/h, d[ok]
        cam = np.stack([(u-k['cx'])/k['fx']*d, -(v-k['cy'])/k['fy']*d, -d], 1)  # three.js camera: y up, looking down -z
        x, y, z, qw = f['quaternion']
        R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*qw), 2*(x*z+y*qw)], [2*(x*y+z*qw), 1-2*(x*x+z*z), 2*(y*z-x*qw)], [2*(x*z-y*qw), 2*(y*z+x*qw), 1-2*(x*x+y*y)]])
        pts.append(cam@R.T+np.array(f['position']))
    pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(np.concatenate(pts)))
    return pc

def prepare(pc):
    pc = pc.voxel_down_sample(VOXEL); pc.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=VOXEL*3, max_nn=30))
    return pc

def refine(src, dst, init):
    T = init
    for dist in (.3, .12, .05):
        T = o3d.pipelines.registration.registration_icp(src, dst, dist, T, o3d.pipelines.registration.TransformationEstimationPointToPlane(),
            o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=60)).transformation
    ev = o3d.pipelines.registration.evaluate_registration(src, dst, .04, T)
    return T, ev.fitness, ev.inlier_rmse

def lock_gravity(src, dst, T, iters=15, dist=.04):
    """Both frames are gravity-aligned, so any tilt ICP introduces is noise: keep only the yaw, then re-solve the translation by
    point-to-plane least squares over nearest-neighbour correspondences."""
    yaw = math.atan2(T[0, 2], T[0, 0]); L = rot_y(yaw); L[:3, 3] = T[:3, 3]
    P, Q, N = np.asarray(src.points), np.asarray(dst.points), np.asarray(dst.normals); tree = o3d.geometry.KDTreeFlann(dst)
    for _ in range(iters):
        X = P@L[:3, :3].T+L[:3, 3]; A = np.zeros((3, 3)); b = np.zeros(3)
        for x in X:
            k, idx, d2 = tree.search_knn_vector_3d(x, 1)
            if k and d2[0] < dist*dist: n = N[idx[0]]; A += np.outer(n, n); b += n*np.dot(n, Q[idx[0]]-x)
        L[:3, 3] += np.linalg.lstsq(A, b, rcond=None)[0]
    return L

def rot_y(a):
    c, s = math.cos(a), math.sin(a); T = np.eye(4); T[0, 0] = c; T[0, 2] = s; T[2, 0] = -s; T[2, 2] = c; return T

def register(mesh_path, scenario=None, source_mesh=None):
    src = scan_points(source_mesh) if source_mesh else scenario_points(scenario)
    return register_clouds(prepare(src), prepare(scan_points(mesh_path)))

def register_clouds(src, dst):
    P, Q = np.asarray(src.points), np.asarray(dst.points)
    floor = lambda X: np.percentile(X[:, 1], 5)
    candidates = []
    # Yaw sweep with matched horizontal centroids and floors; a coarse ICP picks the promising yaws.
    for deg in range(0, 360, 10):
        T = rot_y(math.radians(deg)); Pr = P@T[:3, :3].T
        T[:3, 3] = [Q[:, 0].mean()-Pr[:, 0].mean(), floor(Q)-floor(Pr), Q[:, 2].mean()-Pr[:, 2].mean()]
        coarse = o3d.pipelines.registration.registration_icp(src, dst, .3, T, o3d.pipelines.registration.TransformationEstimationPointToPlane(),
            o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=30))
        candidates.append((coarse.fitness, coarse.transformation, 'yaw-sweep'))
    feature = lambda pc: o3d.pipelines.registration.compute_fpfh_feature(pc, o3d.geometry.KDTreeSearchParamHybrid(radius=VOXEL*5, max_nn=100))
    ransac = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(src, dst, feature(src), feature(dst), True, VOXEL*1.5,
        o3d.pipelines.registration.TransformationEstimationPointToPoint(False), 3,
        [o3d.pipelines.registration.CorrespondenceCheckerBasedOnDistance(VOXEL*1.5)], o3d.pipelines.registration.RANSACConvergenceCriteria(200000, .999))
    candidates.append((ransac.fitness, ransac.transformation, 'fpfh-ransac'))
    best = None
    for _, T, method in sorted(candidates, key=lambda c: -c[0])[:6]:
        T, fitness, rmse = refine(src, dst, T)
        if best is None or (fitness, -rmse) > (best[1], -best[2]): best = (T, fitness, rmse, method)
    T, fitness, rmse, method = best
    T = lock_gravity(src, dst, T); ev = o3d.pipelines.registration.evaluate_registration(src, dst, .04, T); fitness, rmse = ev.fitness, ev.inlier_rmse
    yaw = math.degrees(math.atan2(T[0, 2], T[0, 0])); tilt = math.degrees(math.acos(max(-1, min(1, T[1, 1]))))
    return dict(toSpace=[round(float(v), 6) for v in T.reshape(-1)], fitness=round(fitness, 3), rmse=round(rmse, 4), yaw=round(yaw, 2), tilt=round(tilt, 2),
        method=method, points=[len(P), len(Q)])

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('scan_mesh', help='reference mesh (its frame is the target)')
    p.add_argument('scenario', nargs='?', help='spaces/<space>/scenarios/<take>'); p.add_argument('--mesh', help='align this mesh instead of a scenario')
    a = p.parse_args()
    if not (a.scenario or a.mesh): p.error('give a scenario folder or --mesh')
    print(json.dumps(register(a.scan_mesh, a.scenario, a.mesh)))
