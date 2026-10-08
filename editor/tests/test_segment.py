import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
try:
    import numpy as np, trimesh, shapely  # .venv-mesh only: .venv-mesh/bin/python -m unittest tests/test_segment.py
    import segment_surfaces as seg
except ImportError: seg = None

@unittest.skipUnless(seg, 'needs .venv-mesh (trimesh, shapely)')
class SegmentTest(unittest.TestCase):
    def test_wall_floor_and_a_cabinet_against_the_wall(self):
        # Single-sided surfaces, like a scan: a 4 x 4 m floor at y = 0, a 4 x 2.5 m wall at z = -2 facing +z, and a 1 m cabinet against it.
        def quad(*corners):
            q = trimesh.Trimesh(np.array(corners, float), [[0, 1, 2], [0, 2, 3]]); return trimesh.Trimesh(*trimesh.remesh.subdivide_to_size(q.vertices, q.faces, .1))
        floor = quad((-2, 0, 2), (2, 0, 2), (2, 0, -2), (-2, 0, -2)); wall = quad((-2, 0, -2), (2, 0, -2), (2, 2.5, -2), (-2, 2.5, -2))
        cab = trimesh.creation.box((1, 1, .5)); cab.apply_translation((1, .5, -1.75)); cab = trimesh.Trimesh(*trimesh.remesh.subdivide_to_size(cab.vertices, cab.faces, .1))
        mesh = trimesh.util.concatenate([floor, wall, cab])
        sem = dict(rooms=[dict(id='room', name='Room', floorY=0, triangles=[[[-2, -2], [2, -2], [2, 2]], [[-2, -2], [2, 2], [-2, 2]]])],
                   walls=[dict(id='Wall_0', center=[0, 1.25, -2], size=[4, 2.5, .1], yaw=0, rooms=['room'], outline=[[-2, 0, -2], [2, 0, -2], [2, 2.5, -2], [-2, 2.5, -2]])],
                   objects=[dict(id='cabinet_0', label='cabinet', center=[1, .5, -1.75], size=[1, 1, .5], yaw=0, parent=None)], openings=[], ceilings=[])
        _, info, excluded, boxed = seg.segment(mesh, sem)
        by = {s['id']: s for s in info}
        self.assertAlmostEqual(by['Wall_0']['area'], 4*2.5-1, delta=.2)        # the cabinet's back (1 m²) is not wall
        self.assertAlmostEqual(by['Floor_room']['area'], 16-.5, delta=.3)      # nor its footprint floor
        self.assertGreater(excluded['cabinet'], .8)
        self.assertEqual(by['Wall_0']['uvMin'][1], 0); self.assertAlmostEqual(by['Wall_0']['uvMax'][0]-by['Wall_0']['uvMin'][0], 4, delta=.01)

if __name__ == '__main__': unittest.main()

@unittest.skipUnless(seg, 'needs .venv-mesh (trimesh, shapely)')
class RidgesTest(unittest.TestCase):
    def test_frame_members_stand_out_from_a_flush_or_slightly_proud_window(self):
        import structure
        x = np.arange(-.5, 1.5, .02); depth = np.full(len(x), .06)
        depth[(x > 0) & (x < 1)] = .073                      # blinds 1.3 cm proud across the whole window: not a frame
        for lo in (-.1, 1.0): depth[(x >= lo) & (x < lo+.1)] = .085   # 10 cm casings, 2.5 cm proud
        found = structure.ridges(depth, x)
        self.assertEqual(len(found), 2)
        self.assertAlmostEqual(found[0][0], -.1, delta=.03); self.assertAlmostEqual(found[1][1], 1.08, delta=.03)
