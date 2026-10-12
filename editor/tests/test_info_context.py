import base64, json, sys, tempfile, unittest, unittest.mock
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import info_context, layout

def data_url(b): return 'data:application/octet-stream;base64,'+base64.b64encode(b).decode()

class InfoContextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.d = Path(self.tmp.name)/'home'; self.d.mkdir(); (self.d/'space.json').write_text('{}')
    def tearDown(self): self.tmp.cleanup()

    def test_key_is_last_part_of_the_label(self):
        self.assertEqual(info_context.key(' fridge / manual '), 'manual')
        self.assertIsNone(info_context.key(' / '))

    def test_text_and_file_values_and_clearing(self):
        self.assertEqual(info_context.read(self.d), dict(entries={}, lib=[]))
        info_context.set_value(self.d, 'wifi', dict(text='network: attic'))
        with self.assertRaises(ValueError): info_context.set_value(self.d, 'manual', dict(file='missing.pdf'))
        info_context.add_file(self.d, 'oven manual.pdf', data_url(b'%PDF'))
        with self.assertRaises(ValueError): info_context.add_file(self.d, 'oven manual.pdf', data_url(b'x'))   # not replaced
        out = info_context.set_value(self.d, 'manual', dict(file='oven manual.pdf'))
        self.assertEqual(out, dict(entries=dict(wifi=dict(text='network: attic'), manual=dict(file='oven manual.pdf')), lib=['oven manual.pdf']))
        self.assertEqual(info_context.lookup(self.d, 'kitchen/manual')['path'], str((self.d/'info'/'lib'/'oven manual.pdf').resolve()))
        self.assertEqual(json.loads((self.d/'info'/'context.json').read_text())['entries']['wifi'], dict(text='network: attic'))
        self.assertEqual(info_context.set_value(self.d, 'wifi', None)['entries'], dict(manual=dict(file='oven manual.pdf')))
        self.assertEqual(info_context.set_value(self.d, 'manual', dict(text='  '))['entries'], {})

    def test_rejects_bad_keys_values_and_paths(self):
        for k in ('', 'a/b', None): self.assertRaises(ValueError, info_context.set_value, self.d, k, dict(text='t'))
        self.assertRaises(ValueError, info_context.set_value, self.d, 'k', dict(text='t', file='f'))
        self.assertRaises(ValueError, info_context.set_value, self.d, 'k', 'text')
        (self.d/'secret.txt').write_text('no'); (self.d/'info'/'lib').mkdir(parents=True)
        self.assertRaises(ValueError, info_context.set_value, self.d, 'k', dict(file='../../secret.txt'))
        self.assertRaises(ValueError, info_context.add_file, self.d, '../x', data_url(b'x'))

    def test_scenario_folder_reads_its_space(self):
        info_context.set_value(self.d, 'wifi', dict(text='t'))
        take = self.d/'scenarios'/'take1'; take.mkdir(parents=True)
        self.assertEqual(info_context.read(take)['entries'], dict(wifi=dict(text='t')))

class InformationBoxesTest(unittest.TestCase):
    def test_old_information_boxes_become_furniture_carrying_their_name(self):
        rooms = [dict(id='kitchen', triangles=[[[0, 0], [4, 0], [4, 4]], [[0, 0], [4, 4], [0, 4]]])]
        oven = dict(id='oven', label='oven', center=[1,.5,1], size=[.6,.9,.6], info='oven manual')
        old = dict(id='custom_0', label='oven/manual', category='information', center=[1,1,1], size=[.2,.2,.2], parent='oven')
        out = layout.update(dict(rooms=rooms, information=[old]), [oven], [], [old])
        self.assertNotIn('information', out)
        byid = {b['id']: b for b in out['objects']}
        self.assertEqual(byid['oven']['info'], 'oven manual')
        self.assertEqual((byid['custom_0']['info'], byid['custom_0']['category'], byid['custom_0']['parent']), ('manual', 'custom', 'oven'))
        self.assertRaises(ValueError, layout.update, dict(rooms=rooms), [dict(oven, info='a/b')], [])
        sem = layout.migrate_information(dict(objects=[], information=[old]))
        self.assertEqual([b['info'] for b in sem['objects']], ['manual'])

if __name__ == '__main__': unittest.main()

class PayloadAndSelectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.d = Path(self.tmp.name)/'home'; self.d.mkdir(); (self.d/'space.json').write_text('{}')
    def tearDown(self): self.tmp.cleanup()

    def test_payload_text_file_types(self):
        self.assertEqual(info_context.payload(self.d, 'none'), dict(key='none', missing=True))
        info_context.set_value(self.d, 'wifi', dict(text='attic'))
        self.assertEqual(info_context.payload(self.d, 'wifi'), dict(key='wifi', text='attic'))
        for name, data in (('notes.md', b'# Router'), ('manual.pdf', b'%PDF-1'), ('box.bin', b'\0')):
            info_context.add_file(self.d, name, data_url(data)); info_context.set_value(self.d, name.split('.')[0], dict(file=name))
        self.assertEqual(info_context.payload(self.d, 'notes')['file'], dict(name='notes.md', mime_type='text/markdown', text='# Router'))
        pdf = info_context.payload(self.d, 'manual')['file']
        self.assertEqual((pdf['mime_type'], base64.b64decode(pdf['data'])), ('application/pdf', b'%PDF-1'))
        self.assertTrue(info_context.payload(self.d, 'box')['file']['unreadable'])

    def test_selection_targets_furniture_objects_and_zones_and_takes_the_key_they_carry(self):
        sem = dict(objects=[dict(id='custom_1', label='kitchen/flyer', info='wifi'), dict(id='oven', label='oven')],
                   rooms=[dict(id='kitchen', info='kitchen rules')])
        (self.d/'composition.json').write_text(json.dumps(dict(components=[dict(id='lamp1', category='persistent', info='lamp manual')])))
        s = info_context.selection(self.d, sem, dict(box_id='layout:custom_1', key='forged', score=.81234, cues=dict(gaze=1)), 'score')
        self.assertEqual(s, dict(box_id='layout:custom_1', key='wifi', score=.812, cues=dict(gaze=1.0, point=0.0, touch=0.0), mode='score'))
        self.assertEqual(info_context.selection(self.d, sem, dict(box_id='custom_1', score=.9), 'jev')['box_id'], 'layout:custom_1')   # older id
        self.assertEqual(info_context.selection(self.d, sem, dict(box_id='comp:lamp1', score=.9), 'score')['key'], 'lamp manual')
        z = info_context.selection(self.d, sem, dict(box_id='zone:kitchen', score=.4, cues=dict(zone=1)), 'score')
        self.assertEqual((z['key'], z['mode'], z['cues']['zone']), ('kitchen rules', 'jev', 1.0))   # a zone is always judged by Jev
        for bad in (dict(box_id='layout:oven', score=.9), dict(box_id='layout:custom_1', score=2), 'x'):
            self.assertRaises(ValueError, info_context.selection, self.d, sem, bad, 'jev')
        self.assertRaises(ValueError, info_context.selection, self.d, sem, dict(box_id='layout:custom_1', score=.9), 'always')

class ActiveInfoTest(unittest.TestCase):
    def test_follow_up_sees_the_last_answered_turn_only(self):
        import agent_store
        c = dict(questions=[dict(id=1, created=1, status='answered', info=dict(key='wifi', source='selection', interaction_id='i1')),
                            dict(id=2, created=2, status='answered'), dict(id=3, created=3, status='running')])
        self.assertIsNone(agent_store.active_info(c, c['questions'][2]))
        self.assertEqual(agent_store.active_info(c, c['questions'][1]), dict(key='wifi', source='selection', interaction_id='i1', question_id=1))

class ResponseInfoTest(unittest.TestCase):
    def test_info_answer_is_tied_to_the_selected_box_of_its_key(self):
        import agent_store
        q1 = dict(id=1, created=1, selection=dict(box_id='b1', key='wifi')); q2 = dict(id=2, created=2); q3 = dict(id=3, created=3, selection=dict(box_id='b9', key='router'))
        c = dict(questions=[q1, q2, q3])
        self.assertEqual(agent_store.response_info(c, q2, dict(key='wifi')), dict(key='wifi', box_id='b1'))   # follow-up: the earlier selection
        self.assertEqual(agent_store.response_info(c, q3, dict(key='router')), dict(key='router', box_id='b9'))
        self.assertEqual(agent_store.response_info(c, q2, dict(key='manual')), dict(key='manual', box_id=None))
        self.assertRaises(ValueError, agent_store.response_info, c, q2, dict(key=''))

class CarriersPersistTest(unittest.TestCase):
    def test_a_scene_object_keeps_its_info_key_through_saving(self):
        import composition
        spec = dict(id='lamp1', component='file', position=[0, 1, 0], category='persistent', info=' lamp manual ', src='assets/x.glb')
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp); (d/'assets').mkdir(); (d/'assets'/'x.glb').write_bytes(b'glb')
            self.assertEqual(composition._spec(spec, d, set())['info'], 'lamp manual')
            self.assertNotIn('info', composition._spec(dict(spec, info='a/b'), d, set()))

class SceneObjectInfoTest(unittest.TestCase):
    def test_a_scene_object_carries_info_for_every_recording_that_places_it(self):
        import composition
        with tempfile.TemporaryDirectory() as tmp:
            space = Path(tmp)/'home'; (space/'components'/'mug').mkdir(parents=True); (space/'space.json').write_text('{}')
            (space/'components'/'mug'/'component.json').write_text(json.dumps(dict(id='mug', name='mug', kind='box', category='opportunistic')))
            with unittest.mock.patch.object(composition, '_object', lambda d, oid: (space/'components'/oid, json.loads((space/'components'/oid/'component.json').read_text()))):
                composition.update_object(space, 'mug', info=' care guide ')
                self.assertEqual(json.loads((space/'components'/'mug'/'component.json').read_text())['info'], 'care guide')
                take = space/'scenarios'/'t1'; take.mkdir(parents=True)
                (take/'composition.json').write_text(json.dumps(dict(components=[dict(id='mug-1', component='mug', category='opportunistic')])))
                self.assertEqual(info_context.targets(space, {}, take), {'comp:mug-1': 'care guide'})
                self.assertEqual(info_context.selection(space, {}, dict(box_id='comp:mug-1', score=.8), 'score', session=take)['key'], 'care guide')
                composition.update_object(space, 'mug', info='')
                self.assertNotIn('info', json.loads((space/'components'/'mug'/'component.json').read_text()))

class PlacementLogTest(unittest.TestCase):
    def test_placement_events_append_per_question(self):
        import agent_store
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            agent_store.log_placement(d, 3, dict(type='placed', pose=dict(kind='info-float')))
            agent_store.log_placement(d, 3, dict(type='locked'))
            lines = (d/'agent'/'placement-log'/'q3.jsonl').read_text().splitlines()
            self.assertEqual([json.loads(l)['type'] for l in lines], ['placed', 'locked'])
            self.assertRaises(ValueError, agent_store.log_placement, d, 'x', {})
            self.assertRaises(ValueError, agent_store.log_placement, d, 3, dict(big='x'*70000))
