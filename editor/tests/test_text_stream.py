import sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import agent_store as store, conversation_context

class TextStreamTest(unittest.TestCase):
    def send(self, d, q, seq, status='streaming', **fields):
        return store.add_response(d, dict(question_id=q['id'],part='text',title='Read',body='Continue ',stream=dict(seq=seq,status=status),**fields))

    def test_one_record_preserves_first_arrival_and_rejects_stale_or_late_updates(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock, patch.object(store.time,'time',return_value=100) as clock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Read?');store.take_next(d)
            clock.return_value=101;r=self.send(d,q,1);rid=r['id'];first=r['latency']
            clock.return_value=102;r=self.send(d,q,2,status='complete',anchor=dict(object='Table 2',relation='above'),referenced_item_ids=['to-the-lighthouse'])
            self.assertEqual(r['id'],rid);self.assertEqual(r['latency'],first);self.assertEqual(len(r['stream']['updates']),2)
            self.assertEqual(r['stream']['updates'][1]['at'],2);self.assertEqual(len(r['referenced_entities']),1)
            stale=self.send(d,q,1);self.assertEqual(stale['stream']['seq'],2)
            final=store.finish(d,q['id'],'Done');self.assertEqual(final['status'],'answered');self.assertEqual(final['parts']['text']['latency'],1)
            self.assertEqual(self.send(d,q,2)['id'],rid)
            with self.assertRaises(ValueError):self.send(d,q,3)
            self.assertEqual(len(store.read(d,c['id'])['responses']),1)

    def test_drafts_cannot_publish_item_references_or_mods_and_unfinished_streams_fail(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Read?');store.take_next(d)
            with self.assertRaises(ValueError):self.send(d,q,1,referenced_item_ids=['to-the-lighthouse'])
            with self.assertRaises(ValueError):self.send(d,q,1,anchor=dict(object='Table 2'))
            with self.assertRaises(ValueError):self.send(d,q,1,weather={})
            self.send(d,q,1)
            final=store.finish(d,q['id'],'Interrupted');self.assertEqual(final['status'],'failed')
            r=store.read(d,c['id'])['responses'][0];self.assertEqual(r['stream']['status'],'failed');self.assertEqual(r['title'],'Answer unavailable');self.assertEqual(r['referenced_entities'],[])

    def test_history_at_next_question_does_not_include_a_later_completion_or_reference(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock, patch.object(store.time,'time',return_value=100) as clock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Read?');store.take_next(d)
            clock.return_value=101;self.send(d,q,1)
            clock.return_value=102;follow=store.ask(d,c['id'],0,0,'Where?')
            clock.return_value=103;self.send(d,q,2,status='complete',anchor=dict(object='Table 2',relation='above'),referenced_item_ids=['to-the-lighthouse'])
            state=conversation_context.snapshot(store.read(d,c['id']),follow)
            self.assertEqual(state['recent_turns'][0]['assistant'][0]['title'],'Read');self.assertEqual(state['referents'],[])
            clock.return_value=104;later=store.ask(d,c['id'],0,0,'Where is the book?')
            self.assertEqual(conversation_context.snapshot(store.read(d,c['id']),later)['referents'][0]['item_id'],'to-the-lighthouse')

    def test_server_restart_withdraws_unfinished_text_but_preserves_replay_prefix(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Read?');store.take_next(d);self.send(d,q,1)
            store.recovered.discard(str(d));store.listing(d)
            r=store.read(d,c['id'])['responses'][0]
            self.assertEqual(r['stream']['status'],'failed');self.assertEqual(r['stream']['updates'][0]['status'],'streaming');self.assertEqual(r['stream']['updates'][-1]['status'],'failed')
