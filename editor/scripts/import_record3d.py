#!/usr/bin/env python3
"""Record3D "EXR + JPG sequence" export -> frame-indexed replay session.

Record3D poses come from ARKit: camera-to-world, right-handed, y-up, meters,
camera looking down -z. That matches three-rh-y-up-meters-camera-minus-z, so
poses are copied without reflection. K is stored column-major (K[6],K[7] = cx,cy)
with a top-left image origin.

--depth also writes per-frame LiDAR depth (axial meters, registered to the RGB
frame) as PNG: uint16 millimeters split into R (high byte) and G (low byte),
0 = no measurement. Requires OpenEXR.
"""
import argparse, json, math, shutil, statistics
from pathlib import Path
from PIL import Image

def write_depth(exr, png):
    import numpy as np, OpenEXR
    d = OpenEXR.File(str(exr)).channels()['R'].pixels.astype(np.float32)
    mm = np.where(np.isfinite(d) & (d > 0), np.clip(np.rint(d*1000), 0, 65535), 0).astype(np.uint16)
    rgb = np.zeros(mm.shape+(3,), np.uint8); rgb[..., 0] = mm >> 8; rgb[..., 1] = mm & 255
    Image.fromarray(rgb).save(png)

def convert(source, dest, stride=1, depth=False, synthetic=False):
    source, dest = Path(source), Path(dest)
    meta = json.loads((source/'metadata.json').read_text())
    w, h = int(meta['w']), int(meta['h'])
    poses, stamps = meta['poses'], meta.get('frameTimestamps')
    coeffs = meta.get('perFrameIntrinsicCoeffs')
    if not poses: raise ValueError('No poses')
    if stamps and len(stamps) != len(poses): raise ValueError('Timestamp/pose count mismatch')
    if coeffs and len(coeffs) != len(poses): raise ValueError('Intrinsics/pose count mismatch')
    accepted = []; rejected = []; prev = -1.0
    for i in range(0, len(poses), stride):
        try:
            image = source/'rgb'/f'{i}.jpg'
            if not image.is_file(): raise ValueError('Missing image')
            if depth and not (source/'depth'/f'{i}.exr').is_file(): raise ValueError('Missing depth')
            q, pos = poses[i][:4], poses[i][4:7]
            if not all(math.isfinite(v) for v in q+pos): raise ValueError('Non-finite pose')
            norm = math.sqrt(sum(v*v for v in q))
            if abs(norm-1) > .02: raise ValueError('Invalid quaternion norm')
            t = float(stamps[i]) if stamps else i/float(meta['fps'])
            if t <= prev: raise ValueError('Non-increasing timestamp')
            prev = t
            accepted.append((i, t, image, pos, [v/norm for v in q]))
        except ValueError as e: rejected.append(dict(row=i, reason=str(e)))
    if not accepted: raise ValueError('No valid image+pose pairs: '+str(rejected[:3]))
    with Image.open(accepted[0][2]) as im:
        if im.size != (w, h): raise ValueError(f'Image size {im.size} != metadata {(w, h)}')
    # The editor takes one intrinsics block; Record3D varies slightly per frame (focus).
    if coeffs:
        used = [coeffs[i] for i, *_ in accepted]
        fx, fy, cx, cy = (statistics.median(c[j] for c in used) for j in range(4))
        spread = max(c[0] for c in used)/min(c[0] for c in used)-1
    else:
        K = meta['K']; fx, fy, cx, cy = K[0], K[4], K[6], K[7]; spread = 0.0
    if dest.exists() and any(dest.iterdir()): raise ValueError('Destination must be empty (preserve prior sessions)')
    (dest/'frames').mkdir(parents=True, exist_ok=True)
    if depth: (dest/'depth').mkdir()
    frames = []; start = accepted[0][1]
    for n, (i, t, image, pos, q) in enumerate(accepted):
        shutil.copyfile(image, dest/'frames'/f'{n:06d}.jpg')
        frame = dict(t=t-start, timestampUs=str(round(t*1e6)), image=f'frames/{n:06d}.jpg', sourceIndex=i, position=pos, quaternion=q)
        if depth:
            write_depth(source/'depth'/f'{i}.exr', dest/'depth'/f'{n:06d}.png')
            frame['depth'] = f'depth/{n:06d}.png'
        frames.append(frame)
    gaps = [b['t']-a['t'] for a, b in zip(frames, frames[1:])]
    median = sorted(gaps)[len(gaps)//2] if gaps else 1/float(meta.get('fps', 30))
    manifest = dict(version=1, name=source.name, synthetic=synthetic, source='record3d-exr-jpg',
        coordinateSystem='three-rh-y-up-meters-camera-minus-z', imageOrigin='top-left', sourceRowOrder='top-down',
        intrinsics=dict(fx=fx, fy=fy, cx=cx, cy=cy, width=w, height=h), frames=frames, duration=frames[-1]['t']+median,
        report=dict(accepted=len(frames), rejected=rejected, stride=stride, maxGapSeconds=max(gaps, default=0), medianGapSeconds=median, focalSpread=spread),
        calibrationStatus='synthetic-ground-truth' if synthetic else 'arkit-intrinsics-median')
    if depth: manifest['depth'] = dict(encoding='png-rg-uint16-mm', kind='axial-meters', width=int(meta['dw']), height=int(meta['dh']), source='synthetic' if synthetic else 'record3d-lidar')
    (dest/'session.json').write_text(json.dumps(manifest, indent=2))
    return manifest

def add_depth(source, dest):
    """Add per-frame depth to a session imported without --depth (frames, placements and room mesh are kept)."""
    source, dest = Path(source), Path(dest)
    meta = json.loads((source/'metadata.json').read_text()); manifest = json.loads((dest/'session.json').read_text())
    missing = [f['sourceIndex'] for f in manifest['frames'] if not (source/'depth'/f'{f["sourceIndex"]}.exr').is_file()]
    if missing: raise ValueError(f'Missing depth for {len(missing)} frames, e.g. {missing[:3]}')
    (dest/'depth').mkdir(exist_ok=True)
    for n, frame in enumerate(manifest['frames']):
        write_depth(source/'depth'/f'{frame["sourceIndex"]}.exr', dest/'depth'/f'{n:06d}.png')
        frame['depth'] = f'depth/{n:06d}.png'
    manifest['depth'] = dict(encoding='png-rg-uint16-mm', kind='axial-meters', width=int(meta['dw']), height=int(meta['dh']), source='synthetic' if manifest.get('synthetic') else 'record3d-lidar')
    (dest/'session.json').write_text(json.dumps(manifest, indent=2))
    return manifest

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('source'); p.add_argument('destination')
    p.add_argument('--stride', type=int, default=1, help='Keep every Nth frame (Record3D records at 60 fps).')
    p.add_argument('--depth', action='store_true', help='Also export per-frame LiDAR depth for depth occlusion.')
    a = p.parse_args(); m = convert(a.source, a.destination, a.stride, a.depth); print(json.dumps(m['report'], indent=2))
