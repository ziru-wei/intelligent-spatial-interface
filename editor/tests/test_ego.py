import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import ego

def scene(tmp, depth_mm=None):
    """A scene with a desk 2 m in front of the camera and a lamp behind it; one persistent object and one opportunistic box."""
    s = Path(tmp)/'home'; d = s/'scenarios'/'take'; d.mkdir(parents=True); (s/'scan').mkdir()
    (s/'space.json').write_text(json.dumps(dict(semantic='scan/semantic.json')))
    (s/'scan'/'semantic.json').write_text(json.dumps(dict(rooms=[dict(id='r', name='Study')], models={'desk': {}},
        objects=[dict(id='desk', label='furniture/desk', center=[0, 1, -2], size=[1, .5, .5], yaw=0, room='r'),
                 dict(id='lamp', label='lamp', center=[0, 1, 3], size=[.3, .3, .3], yaw=0, room='r')],
        openings=[dict(id='Window_0', label='window', center=[2, 1.5, -2], size=[.8, 1, .1], yaw=0)])))
    (s/'composition.json').write_text(json.dumps(dict(components=[dict(id='twin1', component='plant', category='persistent', name='plant', position=[-.5, 1, -2])])))
    (d/'composition.json').write_text(json.dumps(dict(components=[dict(id='c1', component='crate', category='opportunistic', name='crate', position=[.5, 1, -2], scale=[.2, .2, .2]),
                                                                  dict(id='w1', component='pulse-marker', category='widget', position=[0, 0, 0])])))
    (s/'components'/'crate').mkdir(parents=True); (s/'components'/'crate'/'component.json').write_text(json.dumps(dict(name='crate', kind='box')))
    frame = dict(t=0, position=[0, 1, 0], quaternion=[0, 0, 0, 1])   # looking down -z
    if depth_mm is not None:
        from PIL import Image
        im = Image.new('RGB', (32, 24), (depth_mm >> 8, depth_mm & 255, 0)); im.save(d/'d.png'); frame['depth'] = 'd.png'
    (d/'session.json').write_text(json.dumps(dict(intrinsics=dict(fx=300, fy=300, cx=160, cy=120, width=320, height=240), frames=[frame])))
    return d

class EgoTest(unittest.TestCase):
    def test_catalog_kinds_and_models(self):
        with tempfile.TemporaryDirectory() as tmp:
            items = {i['id']: i for i in ego.catalog(scene(tmp))}
            self.assertEqual(set(items), {'layout:desk', 'layout:lamp', 'layout:Window_0', 'comp:twin1', 'comp:c1'})   # no widgets
            self.assertEqual((items['layout:desk']['label'], items['layout:desk']['zone'], items['layout:desk']['has_model']), ('desk', 'Study', True))
            self.assertEqual(items['layout:Window_0']['kind'], 'opening'); self.assertFalse(items['comp:c1']['has_model']); self.assertTrue(items['comp:twin1']['has_model'])
            self.assertNotIn('center', ego.for_jev(list(items.values()))[0])   # Jev sees no geometry

    def test_resolve_checks_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = scene(tmp)
            r = ego.resolve(d, dict(objects=['layout:desk', 'comp:c1'], main='layout:desk', effect=dict(type='bounce')))
            self.assertEqual((r['main'], r['effect'], [o['label'] for o in r['objects']]), ('layout:desk', dict(type='bounce', color='attention'), ['desk', 'crate']))
            for bad in (dict(objects=['layout:nope'], main='layout:nope', effect=dict(type='bounce')), dict(objects=['layout:desk'], main='comp:c1', effect=dict(type='bounce')),
                        dict(objects=['layout:desk'], main='layout:desk', effect=dict(type='explode')), dict(objects=[], main=None, effect={})):
                with self.assertRaises(ValueError): ego.resolve(d, bad)

    def test_visibility_in_view_and_occlusion(self):
        with tempfile.TemporaryDirectory() as tmp:
            v = ego.visibility(scene(tmp), 0, ['layout:desk', 'layout:lamp'])
            self.assertEqual(v['layout:desk'], 1.0); self.assertEqual(v['layout:lamp'], 0.0)   # the lamp is behind the camera
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(ego.visibility(scene(tmp, depth_mm=800), 0, ['layout:desk'])['layout:desk'], 0.0)   # something 0.8 m ahead hides it
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(ego.visibility(scene(tmp, depth_mm=2000), 0, ['layout:desk'])['layout:desk'], 1.0)  # depth on the desk itself (within 25 cm)

if __name__ == '__main__': unittest.main()
