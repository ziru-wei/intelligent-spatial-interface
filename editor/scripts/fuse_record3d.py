#!/usr/bin/env python3
"""Fuse a Record3D "EXR + JPG sequence" export into a room mesh (.glb) via TSDF.

The mesh is built from the same ARKit poses as import_record3d.py, so it is
already in the session's coordinate system. If the output sits next to a
session.json, it is registered there as roomMesh and the editor loads it.
Requires: open3d, OpenEXR and numpy<2 (open3d 0.18 segfaults with numpy 2); not in requirements.txt.
"""
import argparse, json
from pathlib import Path
import numpy as np, OpenEXR, open3d as o3d
from PIL import Image

# ARKit/three camera (y up, looks -z) -> Open3D/OpenCV camera (y down, looks +z).
FLIP = np.diag([1., -1., -1., 1.])

def c2w(pose):
    x, y, z, w = pose[:4]
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    T = np.eye(4); T[:3, :3] = R; T[:3, 3] = pose[4:7]
    return T

def fuse(source, out, stride=5, voxel=.02, trunc=3.0, max_triangles=200000):
    source = Path(source); meta = json.loads((source/'metadata.json').read_text())
    dw, dh, w = int(meta['dw']), int(meta['dh']), int(meta['w'])
    s = dw/w
    vol = o3d.pipelines.integration.ScalableTSDFVolume(voxel_length=voxel, sdf_trunc=4*voxel, color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8)
    used = 0
    for i in range(0, len(meta['poses']), stride):
        d = OpenEXR.File(str(source/'depth'/f'{i}.exr')).channels()['R'].pixels.astype(np.float32)
        d[~np.isfinite(d)] = 0
        rgb = np.asarray(Image.open(source/'rgb'/f'{i}.jpg').convert('RGB').resize((dw, dh), Image.BILINEAR))
        fx, fy, cx, cy = meta['perFrameIntrinsicCoeffs'][i] if 'perFrameIntrinsicCoeffs' in meta else (meta['K'][0], meta['K'][4], meta['K'][6], meta['K'][7])
        K = o3d.camera.PinholeCameraIntrinsic(dw, dh, fx*s, fy*s, cx*s, cy*s)
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(o3d.geometry.Image(np.ascontiguousarray(rgb)), o3d.geometry.Image(d), depth_scale=1.0, depth_trunc=trunc, convert_rgb_to_intensity=False)
        vol.integrate(rgbd, K, np.linalg.inv(c2w(meta['poses'][i]) @ FLIP))
        used += 1
    mesh = vol.extract_triangle_mesh()
    # Drop small floating fragments from LiDAR noise.
    labels, counts, _ = mesh.cluster_connected_triangles()
    labels, counts = np.asarray(labels), np.asarray(counts)
    mesh.remove_triangles_by_mask(counts[labels] < 200); mesh.remove_unreferenced_vertices()
    if len(mesh.triangles) > max_triangles: mesh = mesh.simplify_quadric_decimation(max_triangles)
    mesh.compute_vertex_normals()
    if not o3d.io.write_triangle_mesh(str(out), mesh): raise RuntimeError('Failed to write '+str(out))
    manifest = Path(out).parent/'session.json'
    if manifest.is_file():
        m = json.loads(manifest.read_text()); m['roomMesh'] = Path(out).name; manifest.write_text(json.dumps(m, indent=2))
    return dict(frames=used, vertices=len(mesh.vertices), triangles=len(mesh.triangles), bounds=[np.round(mesh.get_min_bound(), 3).tolist(), np.round(mesh.get_max_bound(), 3).tolist()])

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('source'); p.add_argument('output')
    p.add_argument('--stride', type=int, default=5); p.add_argument('--voxel', type=float, default=.02); p.add_argument('--trunc', type=float, default=3.0, help='Ignore LiDAR depth beyond this many meters.'); p.add_argument('--max-triangles', type=int, default=200000)
    a = p.parse_args(); print(json.dumps(fuse(a.source, a.output, a.stride, a.voxel, a.trunc, a.max_triangles), indent=2))
