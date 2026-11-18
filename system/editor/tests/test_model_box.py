import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import composition

class ModelToBoxTest(unittest.TestCase):
    def test_same_box_as_the_editor(self):
        # src/model-fit.mjs boxFromModel gives position [0, 0.25, -0.5], size [1, 0.5, 2] for this (tests/model-fit.test.mjs).
        pos, size = composition.model_box([0, 0, 0], [0, 90, 0], .5, [2, 1, 4], [1, .5, 0], [0, 0, 0])
        self.assertEqual(size, [1, .5, 2]); self.assertAlmostEqual(pos[0], 0, 4); self.assertAlmostEqual(pos[1], .25, 4); self.assertAlmostEqual(pos[2], -.5, 4)

    def test_object_and_its_placements_become_boxes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp); o = d/'components'/'cup'; o.mkdir(parents=True); (o/'model.glb').write_bytes(b'glb')
            (o/'component.json').write_text(json.dumps(dict(name='cup', kind='gltf', entry='model.glb', category='opportunistic', pivot=[1, .5, 0], defaultScale=1,
                                                           pose=dict(position=[0, 1, 0], rotation=[0, 0, 0]))))
            s = d/'scenarios'/'a'; s.mkdir(parents=True)
            (s/'composition.json').write_text(json.dumps(dict(revision=3, components=[dict(id='c1', component='cup', position=[2, 0, 0], rotation=[0, 0, 0], scale=2,
                                                                                            initial=dict(position=[2, 0, 0], rotation=[0, 0, 0], scale=2))])))
            r = composition.model_to_box(d, 'cup', [2, 1, 4], [1, .5, 0])
            entry = json.loads((o/'component.json').read_text())
            self.assertEqual((entry['kind'], entry['defaultScale']), ('box', [2, 1, 4])); self.assertNotIn('pivot', entry); self.assertFalse((o/'model.glb').exists())
            c = json.loads((s/'composition.json').read_text())['components'][0]
            self.assertEqual((c['position'], c['scale'], c['initial']['scale']), ([2, 0, 0], [4, 2, 8], [4, 2, 8]))   # pivot at the centre: no shift
            self.assertEqual(r['revisions'], {'a': 4})
            with self.assertRaises(ValueError): composition.model_to_box(d, 'cup', [2, 1, 4], [1, .5, 0])   # already a box

if __name__ == '__main__': unittest.main()
