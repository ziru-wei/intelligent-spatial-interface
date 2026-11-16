import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import modos_twin as twin

def space(tmp):
    sp = Path(tmp)/'space'; (sp/'scan').mkdir(parents=True)
    (sp/'space.json').write_text(json.dumps({'version': 1}))
    (sp/'scan'/'semantic.json').write_text(json.dumps({
        'rooms': [{'id': 'lab', 'name': 'Lab', 'floorY': 0, 'ceilingY': 3, 'polygon': [[[[0, 0], [10, 0], [10, 10], [0, 10]]]]},
                  {'id': 'kitchen', 'name': 'Kitchen'}],
        'objects': [{'id': 'shelf', 'label': 'shelf 3', 'category': 'storage_shelf', 'room': 'lab', 'parent': None},
                    {'id': 'shelf-bottom', 'label': 'bottom shelf', 'category': 'storage_shelf', 'room': 'lab', 'parent': 'shelf'},
                    {'id': 'poster', 'label': 'poster', 'category': 'custom', 'room': 'lab', 'parent': None, 'info': 'Poster'}],
        'openings': [{'id': 'door', 'label': 'door 1', 'category': 'Door', 'room': 'lab', 'parent': None}]}))
    return sp

class TwinTest(unittest.TestCase):
    def test_layers_kinds_traits_and_nesting(self):
        with tempfile.TemporaryDirectory() as tmp:
            e = twin.entities(space(tmp))
            self.assertEqual((e['zone:lab']['layer'], e['layout:door']['layer'], e['layout:shelf']['layer']), ('layout', 'fixture', 'fixture'))
            self.assertEqual(e['layout:shelf']['traits'], ['container', 'surface'])
            self.assertEqual(e['layout:poster']['kind'], 'artifact')
            self.assertEqual(e['layout:shelf-bottom']['parent'], 'layout:shelf')

    def test_items_and_devices_are_authored_with_hierarchy_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            sp = space(tmp)
            item = twin.add(sp, {'id': 'item:keys', 'kind': 'item', 'name': 'Keys', 'parent': 'layout:shelf-bottom'})
            self.assertEqual(item['place'], 'zone:lab')            # where its container is
            lamp = twin.add(sp, {'id': 'device:lamp', 'kind': 'device', 'name': 'Lamp', 'place': 'zone:kitchen', 'traits': ['iot']})
            self.assertEqual(lamp['device']['actions'], ['on', 'off'])
            self.assertIn('keys', [b['item_id'] for b in twin.belongings(sp)])
            for bad, msg in [({'parent': 'zone:lab'}, 'only be part of other furniture'),
                             ({'parent': 'item:keys'}, 'inside itself')]:
                with self.subTest(msg), self.assertRaisesRegex(ValueError, msg):
                    twin.update(sp, 'layout:shelf-bottom', bad) if 'itself' not in msg else twin.update(sp, 'layout:shelf', {'parent': 'layout:shelf-bottom'})
            with self.assertRaisesRegex(ValueError, 'belongs to a place'): twin.update(sp, 'layout:door', {'parent': 'layout:shelf'})
            with self.assertRaisesRegex(ValueError, 'another place'): twin.update(sp, 'zone:kitchen', {'parent': 'layout:shelf'})
            twin.update(sp, 'zone:kitchen', {'parent': 'zone:lab'})   # a place may lie in a larger place
            with self.assertRaisesRegex(ValueError, 'inside furniture or another object'): twin.update(sp, 'item:keys', {'parent': 'layout:door'})
            twin.update(sp, 'item:keys', {'parent': 'layout:shelf'})   # an object may be inside furniture
            twin.update(sp, 'layout:shelf', {'traits': ['container', 'iot']})
            self.assertEqual(twin.entities(sp)['layout:shelf']['device']['protocol'], 'mock')
            twin.remove(sp, 'layout:shelf')                            # derived: drop the overrides
            self.assertNotIn('iot', twin.entities(sp)['layout:shelf']['traits'])

if __name__ == '__main__': unittest.main()
