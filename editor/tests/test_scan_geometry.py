import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
try:
    import numpy as np, trimesh  # .venv-mesh only: .venv-mesh/bin/python -m unittest tests/test_scan_geometry.py
    import scan_geometry as sg
except ImportError: sg = None

def quad(c, u, v, n=1):
    """A square patch centred at c spanning ±u, ±v, as two triangles facing u × v."""
    c, u, v = map(np.array, (c, u, v)); V = [c-u-v, c+u-v, c+u+v, c-u+v]; return trimesh.Trimesh(V, [[0, 1, 2], [0, 2, 3]], process=False)

@unittest.skipIf(sg is None, 'needs .venv-mesh (trimesh, shapely)')
class NearTest(unittest.TestCase):
    # A 4 m wall along x at z = 0 (10 cm slab), a zone floor, a flat ceiling at 2.5 m.
    SEM = dict(walls=[dict(id='Wall_0', center=[0, 1.25, 0], size=[4, 2.5, .1], yaw=0, outline=[[-2, 0, 0], [2, 0, 0], [2, 2.5, 0], [-2, 2.5, 0]])],
               rooms=[dict(id='a', floorY=0, polygon=[[[[-2, 0], [2, 0], [2, 3], [-2, 3]]]])],
               ceilings=[dict(id='Ceiling_0', center=[0, 2.5, 1.5], normal=[0, -1, 0], outline=[[-2, 2.5, 0], [2, 2.5, 0], [2, 2.5, 3], [-2, 2.5, 3]])])

    def test_wall_faces_floor_and_ceiling(self):
        wall_face = quad([0, 1, .08], [.3, 0, 0], [0, .3, 0])        # the wall's room-side face, 3 cm off RoomPlan's 5 cm
        cabinet = quad([0, 1, .5], [.3, 0, 0], [0, .3, 0])           # facing like the wall but 50 cm into the room
        floor = quad([0, .01, 1], [.3, 0, 0], [0, 0, -.3])            # facing up
        outside = quad([3, .01, 1], [.3, 0, 0], [0, 0, -.3])          # beyond the zone
        ceiling = quad([0, 2.53, 1], [.3, 0, 0], [0, 0, .3])          # facing down, 3 cm above
        mesh = trimesh.util.concatenate([wall_face, cabinet, floor, outside, ceiling])
        s = {x['id']: x for x in sg.layout_surfaces(self.SEM)}
        self.assertEqual(sorted(sg.near(mesh, s['Wall_0']).tolist()), [0, 1])
        self.assertEqual(sorted(sg.near(mesh, s['Floor_a']).tolist()), [4, 5])
        self.assertEqual(sorted(sg.near(mesh, s['Ceiling_0'], facing=.5).tolist()), [8, 9])

if __name__ == '__main__': unittest.main()
