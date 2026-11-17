import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import modos_registry, modos_cache, modos_context
import agent_store as store

def space_with_session(tmp):
    """A minimal space (no scan) with one scenario folder, as the server lays them out."""
    space = Path(tmp)/'space'; d = space/'scenarios'/'take'
    d.mkdir(parents=True)
    (space/'space.json').write_text(json.dumps({'version': 1, 'name': 'space'}))
    (space/'scan').mkdir(); (space/'scan'/'semantic.json').write_text(json.dumps({'rooms': [{'id': 'lab-2f', 'name': 'Lab'}], 'objects': []}))
    (space/'info').mkdir(); (space/'info'/'context.json').write_text(json.dumps({'entries': {'Lab info': {'text': 'A lab.'}}}))
    return space, d

class RegistryTest(unittest.TestCase):
    def test_system_mods_are_valid(self):
        mods = modos_registry.all_mods()
        self.assertEqual({'weather', 'findmy', 'worldinfo', 'wayfinding', 'bookcompanion', 'stepguide', 'objectstatus', 'agenda', 'iotcontrol', 'livecoach', 'reminder', 'delegate'}, set(mods))   # the foundational MODs; LabInfo is the atlas space's own

    def test_validation_refuses_broken_mods(self):
        good = modos_registry.all_mods()['weather']
        for change, message in [
            ({'slots': [{'id': 'a', 'use': 'hologram', 'anchor': {'kind': 'object'}}]}, 'unknown primitive'),
            ({'slots': [{'id': 'a', 'use': 'highlight', 'data': 'nothing', 'anchor': {'kind': 'object'}}]}, 'unknown selector'),
            ({'selectors': {'x': {'kind': 'guess'}}}, 'must be enum'),
            ({'text': 'sky'}, 'situated-text'),
            ({'scope': 'everywhere'}, 'scope')]:
            with self.subTest(message), self.assertRaisesRegex(ValueError, message):
                modos_registry.validate(dict(good, **change))

    def test_a_space_mod_extends_a_foundational_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            space = Path(tmp); (space/'modos'/'mods').mkdir(parents=True)
            src = Path(__file__).resolve().parents[1]/'modos'/'examples'/'atlas'/'mods'/'labinfo.json'
            (space/'modos'/'mods'/'labinfo.json').write_text(src.read_text())
            lab = modos_registry.all_mods(space)['labinfo']
            self.assertEqual((lab['extends'], lab['variant'], sorted(s['id'] for s in lab['slots'])), ('worldinfo', 'diorama', ['answer', 'diorama']))
            self.assertNotIn('voice', lab['variants'])                              # removed with null
            self.assertEqual(modos_registry.customize(space, 'labinfo', {'variant': 'text'})['slots'][0]['id'], 'answer')
            (space/'modos'/'mods'/'bad.json').write_text(json.dumps({'id': 'bad', 'extends': 'nothing'}))
            with self.assertRaisesRegex(ValueError, 'unknown MOD'): modos_registry.all_mods(space)

    def test_variants_settings_overrides_and_forks(self):
        with tempfile.TemporaryDirectory() as tmp:
            space = Path(tmp)
            w = modos_registry.all_mods(space)['weather']
            self.assertEqual((w['variant'], [s['id'] for s in w['slots']], w['text']), ('full', ['sky', 'controls', 'answer'], 'answer'))
            self.assertEqual(w['slots'][0]['params']['lock'], {'fixed': 'follow'})            # a setting's default is settled
            t = modos_registry.customize(space, 'weather', {'variant': 'text', 'settings': {'answer': {'duration': '5s'}}})
            self.assertEqual([s['id'] for s in t['slots']], ['answer'])
            self.assertEqual(t['slots'][0]['anchor'].get('order', [None])[0], 'surface:window')  # relative to a hidden slot: its anchor
            self.assertEqual(t['slots'][0]['params']['duration'], {'fixed': '5s'})
            for change, message in [({'variant': 'radio'}, 'no variant'), ({'settings': {'answer': {'duration': 'forever'}}}, 'cannot be'),
                                    ({'settings': {'sky': {'effect': 'rain'}}}, 'cannot be set by hand'), ({'scope': 'nowhere'}, 'scope'),
                                    ({'variant': 'text', 'text': False}, 'needs slots')]:
                with self.subTest(message), self.assertRaisesRegex(ValueError, message): modos_registry.customize(space, 'weather', change)
            self.assertEqual(modos_registry.all_mods(space)['weather']['variant'], 'text')     # a refused change is not saved
            f = modos_registry.fork(space, 'weather', 'weather-bedroom', 'Weather (bedroom)')
            self.assertEqual((f['from'], f['provider'], f['variant'], f['origin']), ('weather', 'user', 'text', 'fork'))
            modos_registry.customize(space, 'weather-bedroom', {'variant': 'controls', 'scope': ['zone:bedroom']})
            self.assertEqual(modos_registry.reset(space, 'weather')['variant'], 'full')
            self.assertEqual(modos_registry.all_mods(space)['weather-bedroom']['scope'], ['zone:bedroom'])
            with self.assertRaisesRegex(ValueError, 'taken'): modos_registry.fork(space, 'weather', 'weather-bedroom', 'x')
            with self.assertRaisesRegex(ValueError, 'Only a fork'): modos_registry.remove_fork(space, 'weather')
            modos_registry.remove_fork(space, 'weather-bedroom')
            self.assertNotIn('weather-bedroom', modos_registry.all_mods(space))
            v = modos_registry.customize(space, 'worldinfo', {'variant': 'voice'})
            self.assertEqual((v['text'], v['slots'][0]['use']), ('voice', 'ego-object'))
            row = next(m for m in modos_registry.catalog(space) if m['id'] == 'worldinfo')
            self.assertEqual(next(s for s in row['settings'] if s['param'] == 'effect')['value'], 'auto')

    def test_install_caches_the_feeds_a_mod_needs(self):
        with tempfile.TemporaryDirectory() as tmp:
            space, _ = space_with_session(tmp)
            self.assertIsNone(modos_cache.read(space, 'weather'))
            self.assertEqual(modos_registry.install(space, 'weather'), ['weather'])
            cached = modos_cache.read(space, 'weather')
            self.assertEqual(cached['type'], 'timeseries'); self.assertEqual(cached['fetcher'], 'mock')
            self.assertEqual([m['id'] for m in modos_registry.installed(space)], ['weather'])

class MemoryTest(unittest.TestCase):
    def test_items_come_from_info_authored_user_and_feeds_not_weather_as_user_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            space, d = space_with_session(tmp)
            (space/'modos').mkdir()
            (space/'modos'/'items.json').write_text(json.dumps({'items': [{'info_key': 'Lab info', 'about': ['zone:lab-2f'], 'summary': 'What the lab is.'}]}))
            snap = modos_context.snapshot(d)
            ids = {i['id']: i for i in snap['items']}
            self.assertEqual(ids['info:Lab info']['about'], ['zone:lab-2f'])
            self.assertEqual(ids['info:Lab info']['summary'], 'What the lab is.')
            self.assertIn('feed:weather', ids); self.assertEqual(ids['feed:weather']['type'], 'timeseries')
            self.assertFalse(any(i['id'].startswith('user:') and i.get('group') == 'weather' for i in snap['items']))
            self.assertIn('worldinfo', [m['id'] for m in snap['mods']])
            self.assertEqual(modos_context.body(d, 'info:Lab info', snap['mods'])['text'], 'A lab.')

class PartsTest(unittest.TestCase):
    def test_two_mods_each_add_a_ui_part(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            space, d = space_with_session(tmp)
            (d/'session.json').write_text(json.dumps({'frames': [{'t': 0, 'position': [0, 0, 0], 'quaternion': [0, 0, 0, 1]}]}))
            modos_registry.install(space, 'weather'); modos_registry.install(space, 'findmy')
            c = store.create(d); q = store.ask(d, c['id'], 0, 0, 'Weather and my umbrella?'); store.take_next(d)
            forecast = modos_cache.read(space, 'weather')['data']['forecast']
            store.add_response(d, dict(question_id=q['id'], part='ui', weather={'forecast_ids': [forecast[0]['id']]}))
            store.add_response(d, dict(question_id=q['id'], part='ui', findmy={'status': 'not_found'}))
            again = store.add_response(d, dict(question_id=q['id'], part='ui', findmy={'status': 'not_found'}))
            conv = store.read(d, c['id'])
            uis = [r for r in conv['responses'] if r.get('part') == 'ui']
            self.assertEqual(sorted('weather' if r.get('weather') else 'findmy' for r in uis), ['findmy', 'weather'])
            self.assertIn(again['id'], [r['id'] for r in uis])
            self.assertEqual(set(conv['questions'][0]['mod_parts']), {'weather', 'findmy'})

if __name__ == '__main__': unittest.main()
