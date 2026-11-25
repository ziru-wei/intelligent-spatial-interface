import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import reset_space, spaces

class ResetSpaceTest(unittest.TestCase):
    def test_devices_back_to_their_initial_state_and_the_mock_outbox_emptied_settings_left(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = spaces.SPACES; spaces.SPACES = Path(tmp)
            try:
                d = Path(tmp)/'lab'/'modos'; d.mkdir(parents=True); (d.parent/'space.json').write_text('{}')
                lamp = {'inputs': {'power': {'type': 'toggle', 'value': 'on'}, 'brightness': {'type': 'level', 'value': 20}}, 'outputs': {}}
                (d/'initial.json').write_text(json.dumps({'devices': {'layout:lamp': lamp}}))
                dimmed = json.loads(json.dumps(lamp)); dimmed['inputs']['brightness']['value'] = 80
                (d/'entities.json').write_text(json.dumps({'version': 1, 'entities': {'layout:lamp': {'traits': ['iot'], 'device': dimmed}}}))
                (d/'outbox.json').write_text(json.dumps({'sent': [{'to': ['a@example.edu'], 'photo': 'outbox-photo-1.jpg'}]})); (d/'outbox-photo-1.jpg').write_bytes(b'x')
                (d/'custom.json').write_text('{"overrides": {"weather": {}}}')
                done = reset_space.reset('lab')
                self.assertEqual(done, ['layout:lamp inputs.brightness: {"type": "level", "value": 80} → {"type": "level", "value": 20}', 'outbox: 1 message(s) and 1 photo(s) cleared'])
                e = json.loads((d/'entities.json').read_text())['entities']['layout:lamp']
                self.assertEqual((e['device'], e['traits']), (lamp, ['iot']))
                self.assertEqual(json.loads((d/'outbox.json').read_text()), {'sent': []}); self.assertFalse((d/'outbox-photo-1.jpg').exists())
                self.assertEqual((d/'custom.json').read_text(), '{"overrides": {"weather": {}}}')   # MOD settings are not the space's state
                self.assertEqual(reset_space.reset('lab'), [])
                (Path(tmp)/'plain').mkdir(); self.assertEqual(reset_space.reset_all(), {'lab': []})   # on start: every space with an initial state
            finally: spaces.SPACES = old
