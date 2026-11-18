import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import agent_store as store, gallery, spaces

class GalleryTest(unittest.TestCase):
    def test_examples_are_tagged_conversations_and_a_new_one_replaces_the_old(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); old_spaces, old_gallery = spaces.SPACES, gallery.GALLERY
            spaces.SPACES = root/'spaces'; gallery.GALLERY = root/'gallery'
            try:
              with store.lock:
                  d = spaces.SPACES/'lab'/'scenarios'/'rec'; d.mkdir(parents=True); (d/'session.json').write_text('{}')
                  tag = gallery.clean_tag({'name': 'weather-lab', 'mod': 'Weather'})
                  with self.assertRaises(ValueError): gallery.clean_tag({'name': 'Bad Name'})
                  plain = store.create(d, 'Mine')                       # not an example
                  a = store.create(d, 'Gallery · weather-lab', gallery_example=tag)
                  q = store.ask(d, a['id'], 3, .1, 'rain later?'); store.take_next(d)
                  c = store.read(d, a['id']); c['questions'][0]['status'] = 'answered'; store._write(d, c)
                  found = gallery.rebuild()
                  self.assertEqual([(e['name'], e['mod'], e['question'], e['conversation']) for e in found], [('weather-lab', 'Weather', 'rain later?', a['id'])])
                  self.assertEqual(json.loads((gallery.GALLERY/'examples.json').read_text())['examples'][0]['session'], './spaces/lab/scenarios/rec/session.json')
                  self.assertTrue((gallery.GALLERY/'examples.js').read_text().startswith('window.GALLERY='))
                  b = store.create(d, 'Gallery · weather-lab', gallery_example=tag)
                  self.assertEqual(gallery.replace('weather-lab', b['id']), dict(removed=1))
                  ids = [x['id'] for x in store.listing(d)]
                  self.assertIn(plain['id'], ids); self.assertIn(b['id'], ids); self.assertNotIn(a['id'], ids)
                  with self.assertRaisesRegex(ValueError, 'JPEG'): gallery.save_still(d, b['id'], 'data:image/png;base64,AAAA')
                  with self.assertRaisesRegex(ValueError, 'Not a gallery'): gallery.save_still(d, plain['id'], 'data:image/jpeg;base64,AAAA')
            finally: spaces.SPACES, gallery.GALLERY = old_spaces, old_gallery

    def test_an_example_made_in_the_editor_is_one_or_several_questions_in_a_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); old = spaces.SPACES, gallery.GALLERY, gallery.SPEC
            spaces.SPACES = root/'spaces'; gallery.GALLERY = root/'gallery'; gallery.SPEC = root/'spec.json'
            gallery.SPEC.write_text(json.dumps(dict(space='lab', examples=[dict(name='send-this-to-ana', mod='Send', recording='rec', ask_at=1, question='x')])))
            try:
              with store.lock:
                  d = spaces.SPACES/'lab'/'scenarios'/'rec'; d.mkdir(parents=True); (d/'session.json').write_text('{}')
                  c = store.create(d, 'Mine'); ids = []
                  for t, text, mod in [(1, 'send this to Ana', 'send'), (4, 'and what about Ryo?', 'worldinfo'), (9, 'is it raining', 'weather')]:
                      q = store.ask(d, c['id'], int(t*10), t, text); store.take_next(d); ids.append(q['id'])
                  c = store.read(d, c['id'])
                  for q in c['questions']: q['status'] = 'answered'
                  c['responses'] = [dict(id=1, question_id=ids[0], part='ui', mod=dict(id='send')), dict(id=2, question_id=ids[0], part='text', title='a'),
                                    dict(id=3, question_id=ids[1], part='text', title='b', text_mod=dict(id='worldinfo')), dict(id=4, question_id=ids[2], part='text', text_mod=dict(id='weather'))]
                  store._write(d, c)
                  with self.assertRaisesRegex(ValueError, 'follow one another'): gallery.add(d, c['id'], [ids[0], ids[2]])
                  r = gallery.add(d, c['id'], [ids[1], ids[0]])
                  # under the first one's MOD; the name: its MOD and whole words of its question, not one taken already
                  self.assertEqual(r['example'], dict(name='send-send-this-to-ana', mod='Send', recording='rec',
                                                      questions=[dict(ask_at=1, question='send this to Ana'), dict(ask_at=4, question='and what about Ryo?')]))
                  self.assertEqual(json.loads(gallery.SPEC.read_text())['examples'][-1]['name'], 'send-send-this-to-ana')
                  copy = store.read(d, r['conversation'])
                  self.assertEqual(copy['gallery_example'], dict(name='send-send-this-to-ana', mod='Send'))
                  self.assertEqual([q['text'] for q in copy['questions']], ['send this to Ana', 'and what about Ryo?'])
                  self.assertEqual(len(copy['responses']), 3); self.assertNotIn(ids[0], [q['id'] for q in copy['questions']])
                  e = next(e for e in gallery.entries() if e['name'] == 'send-send-this-to-ana')
                  self.assertEqual(e['questions'], ['send this to Ana', 'and what about Ryo?'])
                  self.assertEqual(gallery.add(d, c['id'], [ids[2]])['example']['ask_at'], 9)
            finally: spaces.SPACES, gallery.GALLERY, gallery.SPEC = old
