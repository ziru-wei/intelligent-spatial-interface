import base64, json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import composition

class CompositionTest(unittest.TestCase):
    def test_save_stores_imported_files_and_refuses_stale_revisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp); glb = 'data:model/gltf-binary;base64,'+base64.b64encode(b'glTF-test').decode()
            r = composition.save(d, [dict(id='c1', component='calibration-cube', position=[0, 0, -2], yaw=10, scale=1, params={'size': .3}),
                                     dict(id='c2', component='file', name='lamp.glb', src=glb, position=[1, 0, 0], start=2.5)], 0)
            self.assertEqual(r['revision'], 1); self.assertEqual(r['srcs'], {'c2': 'assets/c2.glb'}); self.assertEqual((d/'assets'/'c2.glb').read_bytes(), b'glTF-test')
            doc = json.loads((d/'composition.json').read_text()); self.assertEqual(doc['components'][1]['start'], 2.5); self.assertEqual(doc['components'][0]['params'], {'size': .3})
            with self.assertRaises(composition.Conflict): composition.save(d, [], 0)
            composition.save(d, [dict(id='c1', component='calibration-cube', position=[0, 0, 0])], 1)
            self.assertFalse((d/'assets'/'c2.glb').exists())   # no longer used

    def test_saved_transform_defaults_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            baseline = dict(position=[1, 2, 3], rotation=[10, 20, 30], scale=[1, 1.2, .8])
            spec = dict(id='c1', component='calibration-cube', position=[4, 5, 6], initial=baseline)
            composition.save(d, [spec], 0)
            saved = json.loads((d/'composition.json').read_text())
            self.assertEqual(saved['components'][0]['initial'], baseline)
            self.assertEqual(saved['components'][0]['position'], [4, 5, 6])
            composition.save(d, saved['components'], saved['revision'])
            self.assertEqual(json.loads((d/'composition.json').read_text())['components'][0]['initial'], baseline)

    def test_opportunistic_assets_stay_in_their_recording(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); a = root/'take-a'; b = root/'take-b'; a.mkdir(); b.mkdir()
            glb = 'data:model/gltf-binary;base64,'+base64.b64encode(b'glTF-test').decode()
            spec = dict(id='cup', component='file', category='opportunistic', scope='scene', src=glb, position=[1, 2, 3])
            composition.save(a, [spec], 0)
            saved = json.loads((a/'composition.json').read_text())['components'][0]
            self.assertEqual(saved['category'], 'opportunistic')
            self.assertEqual(saved['scope'], 'recording')
            self.assertTrue((a/saved['src']).is_file())
            self.assertFalse((b/'composition.json').exists())
            composition.save(a, [saved], 1)
            self.assertEqual(json.loads((a/'composition.json').read_text())['components'][0]['category'], 'opportunistic')

    def test_rejects_bad_specs(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ([dict(id='a', component='nope', position=[0, 0, 0])], [dict(id='a', component='calibration-cube', position=[0, 0])],
                        [dict(id='a', component='file', src='../../etc/passwd', position=[0, 0, 0])], [dict(id='a', component='calibration-cube', position=[0, 0, 0], scale=0)],
                        [dict(id='a', component='calibration-cube', position=[0, 0, 0])]*2):
                with self.assertRaises(ValueError): composition.save(Path(tmp), bad)

    def test_scene_object_library_is_placed_per_recording(self):
        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp); take = scene/'scenarios'/'t1'; take.mkdir(parents=True); (scene/'space.json').write_text('{}')
            box = composition.add_object(scene, 'Tea box', 'box', [.2, .1, .15])
            self.assertEqual(box['id'], 'tea-box'); self.assertEqual(box['component']['defaultScale'], [.2, .1, .15])
            self.assertEqual(composition.add_object(scene, 'Tea box', 'box', [.1, .1, .1])['id'], 'tea-box-2')
            glb = 'data:model/gltf-binary;base64,'+base64.b64encode(b'glTF-test').decode()
            cup = composition.add_object(scene, 'Cup', 'gltf', src=glb)
            self.assertEqual((scene/'components'/cup['id']/'model.glb').read_bytes(), b'glTF-test')
            with self.assertRaises(ValueError): composition.add_object(scene, 'Huge', 'box', [9, 1, 1])
            composition.save(take, [dict(id='c1', component='tea-box', category='opportunistic', position=[0, 0, 0], scale=[.2, .1, .15])], 0)
            with self.assertRaises(ValueError): composition.remove_object(scene, 'tea-box')   # placed in t1
            composition.remove_object(scene, 'tea-box-2'); self.assertFalse((scene/'components'/'tea-box-2').exists())

    def test_object_keeps_its_first_pose_and_one_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp)
            box = composition.add_object(scene, 'Mug', 'box', [.1, .1, .1], origin='t1', pose=dict(position=[1, 0, 2], rotation=[0, 30, 0]))
            self.assertEqual(box['component']['origin'], 't1'); self.assertEqual(box['component']['pose']['rotation'], [0, 30, 0])
            r = composition.update_object(scene, 'mug', name='Blue mug', shape=[.08, .12, .08])
            self.assertEqual((r['component']['name'], r['component']['defaultScale']), ('Blue mug', [.08, .12, .08]))
            with self.assertRaises(ValueError): composition.update_object(scene, 'mug', shape=1.5)   # a box's shape is a size
            with self.assertRaises(ValueError): composition.update_object(scene, 'mug', name=' ')

    def test_box_object_replaced_by_model_keeps_its_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp); take = scene/'scenarios'/'t1'; take.mkdir(parents=True); (scene/'space.json').write_text('{}')
            composition.add_object(scene, 'Mug', 'box', [.1, .2, .1])
            composition.save(take, [dict(id='c1', component='mug', category='opportunistic', position=[1, 0, 0], scale=[.1, .2, .1])], 0)
            glb = 'data:model/gltf-binary;base64,'+base64.b64encode(b'glTF-mug').decode()
            r = composition.replace_object(scene, 'mug', glb, [.5, .5, .5], [0, .25, 0])
            self.assertEqual((r['component']['kind'], r['component']['defaultScale'], r['revisions']), ('gltf', .2, {'t1': 2}))
            placed = json.loads((take/'composition.json').read_text())['components'][0]
            self.assertEqual((placed['scale'], placed['position']), (.2, [1, 0, 0]))   # fits the 0.1 m side; same place
            with self.assertRaises(ValueError): composition.replace_object(scene, 'mug', glb, [.5, .5, .5], [0, 0, 0])   # no longer a box

if __name__ == '__main__': unittest.main()
