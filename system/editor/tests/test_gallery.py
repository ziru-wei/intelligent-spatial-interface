import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import agent_store as store, gallery, spaces

class GalleryTest(unittest.TestCase):
    def _answer(self, d, cid, text, t=1.0, title='a'):
        q = store.ask(d, cid, int(t*10), t, text); store.take_next(d)
        c = store.read(d, cid); x = next(x for x in c['questions'] if x['id'] == q['id']); x['status'] = 'answered'
        c['responses'].append(dict(id=len(c['responses'])+1, question_id=q['id'], part='text', title=title, text_mod=dict(id='weather')))
        store._write(d, c); return q['id']

    def test_an_example_is_questions_tagged_in_place_and_asked_again_it_takes_their_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); old = spaces.SPACES, gallery.GALLERY, gallery.SPEC
            spaces.SPACES = root/'spaces'; gallery.GALLERY = root/'gallery'; gallery.SPEC = root/'spec.json'
            gallery.SPEC.write_text(json.dumps(dict(space='lab', examples=[])))
            try:
              with store.lock:
                  d = spaces.SPACES/'lab'/'scenarios'/'rec'; d.mkdir(parents=True); (d/'session.json').write_text('{}')
                  with self.assertRaises(ValueError): gallery.clean_tag({'name': 'Bad Name'})
                  c = store.create(d); before = self._answer(d, c['id'], 'hello there', .5); first = self._answer(d, c['id'], 'rain later?'); after = self._answer(d, c['id'], 'and tomorrow?', 2)
                  plain = store.create(d)
                  name = gallery.add(d, c['id'], [first])['example']['name']
                  # tagged where it is: no copy, the conversation starred
                  self.assertEqual(len(store.listing(d)), 2)
                  self.assertEqual({x['id']: x['starred'] for x in store.listing(d)}, {c['id']: True, plain['id']: False})
                  e = next(e for e in gallery.rebuild() if e['name'] == name)
                  self.assertEqual((e['question'], e['conversation'], e['question_ids']), ('rain later?', c['id'], [first]))
                  self.assertEqual(json.loads((gallery.GALLERY/'examples.json').read_text())['examples'][0]['session'], './spaces/lab/scenarios/rec/session.json')
                  self.assertTrue((gallery.GALLERY/'examples.js').read_text().startswith('window.GALLERY='))
                  # asked again (demos/gallery.mjs): in a conversation of its own until answered, then in the old one's place
                  work = store.create(d, gallery_example=gallery.clean_tag(dict(name=name, mod='Weather')))
                  new = self._answer(d, work['id'], 'rain later?', title='b')
                  self.assertEqual(next(e for e in gallery.entries() if e['name'] == name)['conversation'], work['id'])   # the newer stands meanwhile
                  self.assertEqual(gallery.replace(name, work['id']), dict(conversation=c['id'], replaced=1))
                  c2 = store.read(d, c['id'])
                  self.assertEqual([q['id'] for q in c2['questions']], [before, new, after])
                  self.assertEqual(c2['questions'][1]['gallery']['name'], name)
                  self.assertEqual([r['title'] for r in c2['responses'] if r['question_id'] == new], ['b'])
                  self.assertEqual(len({r['id'] for r in c2['responses']}), len(c2['responses']))   # answer ids given anew
                  self.assertNotIn(work['id'], [x['id'] for x in store.listing(d)])
                  self.assertEqual(next(e for e in gallery.entries() if e['name'] == name)['question_id'], new)
                  # a still is the example's (the example view names it); a conversation without one has none
                  with self.assertRaisesRegex(ValueError, 'JPEG'): gallery.save_still(d, c['id'], 'data:image/png;base64,AAAA', name)
                  with self.assertRaisesRegex(ValueError, 'Not a gallery'): gallery.save_still(d, plain['id'], 'data:image/jpeg;base64,AAAA')
                  # an example whose conversation is gone: the re-ask's conversation becomes its own
                  store.delete_conversation(d, c['id'])
                  work = store.create(d, gallery_example=gallery.clean_tag(dict(name=name, mod='Weather'))); again = self._answer(d, work['id'], 'rain later?')
                  self.assertEqual(gallery.replace(name, work['id']), dict(conversation=work['id'], replaced=0))
                  w = store.read(d, work['id']); self.assertNotIn('gallery_example', w); self.assertEqual(w['questions'][0]['gallery']['name'], name)
            finally: spaces.SPACES, gallery.GALLERY, gallery.SPEC = old

    def test_an_example_made_in_the_editor_is_one_or_several_questions_in_a_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); old = spaces.SPACES, gallery.GALLERY, gallery.SPEC
            spaces.SPACES = root/'spaces'; gallery.GALLERY = root/'gallery'; gallery.SPEC = root/'spec.json'
            gallery.SPEC.write_text(json.dumps(dict(space='lab', examples=[dict(name='send-this-to-ana', mod='Send', recording='rec', ask_at=1, question='x')])))
            try:
              with store.lock:
                  d = spaces.SPACES/'lab'/'scenarios'/'rec'; d.mkdir(parents=True); (d/'session.json').write_text('{}')
                  c = store.create(d); ids = []
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
                  self.assertEqual(r['conversation'], c['id'])
                  tagged = [(q['id'], (q.get('gallery') or {}).get('name')) for q in store.read(d, c['id'])['questions']]
                  self.assertEqual(tagged, [(ids[0], 'send-send-this-to-ana'), (ids[1], 'send-send-this-to-ana'), (ids[2], None)])
                  e = next(e for e in gallery.entries() if e['name'] == 'send-send-this-to-ana')
                  self.assertEqual(e['questions'], ['send this to Ana', 'and what about Ryo?'])
                  self.assertEqual(gallery.add(d, c['id'], [ids[2]])['example']['ask_at'], 9)
                  self.assertEqual(len(gallery.entries()), 2)
            finally: spaces.SPACES, gallery.GALLERY, gallery.SPEC = old

    def test_a_question_typed_in_answer_while_typing_goes_to_its_own_category_with_its_revisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); old = spaces.SPACES, gallery.GALLERY, gallery.SPEC
            spaces.SPACES = root/'spaces'; gallery.GALLERY = root/'gallery'; gallery.SPEC = root/'spec.json'
            gallery.SPEC.write_text(json.dumps(dict(space='lab', examples=[])))
            try:
              with store.lock:
                  d = spaces.SPACES/'lab'/'scenarios'/'rec'; d.mkdir(parents=True); (d/'session.json').write_text('{}')
                  c = store.create(d, 'Mine')
                  q = store.draft(d, c['id'], None, 10, 1.0, 'is it')
                  store.draft(d, c['id'], q['id'], 30, 3.0, 'is it gonna rain', pause=True)
                  store.finalize(d, c['id'], q['id'], 'is it gonna rain?')
                  c = store.read(d, c['id']); c['questions'][0]['status'] = 'answered'; store._write(d, c)
                  e = gallery.add(d, c['id'], [q['id']])['example']
                  self.assertEqual((e['mod'], e['ask_at'], e['question']), (gallery.TYPED, 1.0, 'is it gonna rain?'))
                  self.assertEqual([(r['t'], r['text'], r.get('pause', False)) for r in e['typed']], [(1.0, 'is it', False), (3.0, 'is it gonna rain', True)])
                  self.assertEqual(next(x for x in gallery.entries() if x['name'] == e['name'])['first_t'], 1.0)   # where typing began
            finally: spaces.SPACES, gallery.GALLERY, gallery.SPEC = old
