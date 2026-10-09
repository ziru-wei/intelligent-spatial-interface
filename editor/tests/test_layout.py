import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import layout

ROOMS = [dict(id='kitchen', triangles=[[[0, 0], [4, 0], [4, 4]], [[0, 0], [4, 4], [0, 4]]])]

class LayoutTest(unittest.TestCase):
    def test_update_recomputes_room_and_cleans_boxes(self):
        out = layout.update(dict(version=1, rooms=ROOMS), [dict(id='fridge_0', label=' fridge ', center=[1, .9, 1], size=[.8, 1.8, 0], yaw=12.34)],
                            [dict(id='Door_0', center=[9, 1, 9], size=[.9, 2, .02])])
        self.assertTrue(out['edited'])
        self.assertEqual(out['objects'][0]['room'], 'kitchen'); self.assertEqual(out['objects'][0]['label'], 'fridge')
        self.assertEqual(out['objects'][0]['size'][2], .02); self.assertEqual(out['objects'][0]['yaw'], 12.3)
        self.assertIsNone(out['openings'][0]['room']); self.assertEqual(out['openings'][0]['label'], 'Door_0')

    def test_rejects_bad_boxes(self):
        for bad in ([dict(id='a', center=[0, 0], size=[1, 1, 1])], [dict(id='a', center=[0, 0, 0], size=[1, 1, float('nan')])],
                    [dict(id='../x', center=[0, 0, 0], size=[1, 1, 1])], [dict(id='a', center=[0, 0, 0], size=[1, 1, 1])]*2):
            with self.assertRaises(ValueError): layout.update(dict(rooms=ROOMS), bad, [])

if __name__ == '__main__': unittest.main()

class SaveConflictTest(unittest.TestCase):
    def test_stale_revision_is_refused(self):
        import json, tempfile, spaces
        with tempfile.TemporaryDirectory() as tmp:
            old, spaces.SPACES = spaces.SPACES, Path(tmp)
            try:
                d = Path(tmp)/'s'; (d/'scan').mkdir(parents=True)
                (d/'space.json').write_text(json.dumps(dict(name='s', semantic='scan/semantic.json')))
                (d/'scan'/'semantic.json').write_text(json.dumps(dict(rooms=ROOMS, objects=[], openings=[])))
                box = dict(id='a', center=[1, 0, 1], size=[1, 1, 1])
                self.assertEqual(spaces.save_layout('s', [box], [], 0)['revision'], 1)   # window A
                with self.assertRaises(spaces.Conflict): spaces.save_layout('s', [], [], 0)  # window B, loaded before A saved
                self.assertEqual(len(json.loads((d/'scan'/'semantic.json').read_text())['objects']), 1)
                self.assertEqual(spaces.save_layout('s', [], [], 1)['revision'], 2)
            finally: spaces.SPACES = old

class RelateTest(unittest.TestCase):
    def test_walls_and_ceilings_follow_zones(self):
        rooms = [dict(id='a', triangles=[[[0, 0], [2, 0], [2, 2]], [[0, 0], [2, 2], [0, 2]]]), dict(id='b', triangles=[[[2, 0], [4, 0], [4, 2]], [[2, 0], [4, 2], [2, 2]]])]
        sem = dict(rooms=rooms, objects=[dict(id='t', center=[3, .5, 1], size=[1, 1, 1])], openings=[],
                   walls=[dict(id='w', center=[2, 1, 1], size=[2, 2, .1], yaw=90)],   # along z at x = 2: between a and b
                   ceilings=[dict(id='c', center=[2, 2.5, 1], outline=[[1, 2.5, 0], [3, 2.5, 0], [3, 2.5, 2], [1, 2.5, 2]])])
        layout.relate(sem)
        self.assertEqual(sem['objects'][0]['room'], 'b'); self.assertEqual(sem['walls'][0]['rooms'], ['a', 'b']); self.assertEqual(sem['ceilings'][0]['rooms'], ['a', 'b'])

class FurnitureModelTest(unittest.TestCase):
    def test_model_kept_beside_the_box_and_removed_with_it(self):
        import base64, json, tempfile, spaces
        with tempfile.TemporaryDirectory() as tmp:
            old, spaces.SPACES = spaces.SPACES, Path(tmp)
            try:
                d = Path(tmp)/'s'; (d/'scan').mkdir(parents=True)
                (d/'space.json').write_text(json.dumps(dict(name='s', semantic='scan/semantic.json')))
                (d/'scan'/'semantic.json').write_text(json.dumps(dict(rooms=ROOMS, objects=[], openings=[])))
                box = dict(id='a', center=[1, 0, 1], size=[1, 1, 1]); spaces.save_layout('s', [box], [], 0)
                src = 'data:model/gltf-binary;base64,'+base64.b64encode(b'glb').decode()
                r = spaces.set_furniture_model('s', 'a', src, [2, 1, 1], [0, .5, 0])
                sem = json.loads((d/'scan'/'semantic.json').read_text())
                self.assertEqual(sem['models']['a']['src'], 'scan/models/a.glb'); self.assertTrue((d/'scan'/'models'/'a.glb').is_file())
                self.assertEqual(sem['objects'][0]['size'], [1, 1, 1])                          # the box itself is unchanged
                self.assertGreater(r['revision'], r['boxesRevision'])                            # the editor's box saves stay valid
                with self.assertRaises(ValueError): spaces.set_furniture_model('s', 'nope', src, [1, 1, 1], [0, 0, 0])
                spaces.set_furniture_model('s', 'a'); self.assertNotIn('a', json.loads((d/'scan'/'semantic.json').read_text())['models'])
                self.assertFalse((d/'scan'/'models'/'a.glb').exists())
                spaces.set_furniture_model('s', 'a', src, [2, 1, 1], [0, .5, 0])
                spaces.save_layout('s', [], [], r['boxesRevision'])                               # the box deleted: its model goes too
                self.assertEqual(json.loads((d/'scan'/'semantic.json').read_text())['models'], {}); self.assertFalse((d/'scan'/'models'/'a.glb').exists())
            finally: spaces.SPACES = old
