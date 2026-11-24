import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import modos_parts

class SendTest(unittest.TestCase):
    def test_a_message_with_nobody_chosen_yet_shows_but_is_not_sent(self):
        with tempfile.TemporaryDirectory() as tmp:
            space = Path(tmp)/'space'; d = space/'scenarios'/'rec'; d.mkdir(parents=True); (space/'modos').mkdir()
            (space/'modos'/'items.json').write_text(json.dumps(dict(items=[dict(id='user:contacts', data=[dict(id='alice', name='Alice Chen', email='alice@example.edu')])])))
            a = modos_parts.resolve_action(d, dict(kind='send', to=[], pick='many'))
            self.assertEqual((a['to'], a['pick'], [p['id'] for p in a['contacts']]), ([], 'many', ['alice']))   # the Choice offers everyone
            with self.assertRaisesRegex(ValueError, 'Choose who'): modos_parts.send(space, a, dict(body='Rain on Saturday.'))
            with self.assertRaisesRegex(ValueError, 'Unknown contact'): modos_parts.resolve_action(d, dict(kind='send', to=['alex']))

if __name__ == '__main__': unittest.main()
