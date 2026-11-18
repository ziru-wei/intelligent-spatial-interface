import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import agent_store as store

class SessionDeletionTest(unittest.TestCase):
    def test_delete_running_session_preserves_others_and_rejects_late_answer(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d = Path(tmp)
            first = store.create(d, 'Keep')
            second = store.create(d, 'Delete')
            q = store.ask(d, second['id'], 0, 0, 'Question')
            store.take_next(d)
            store.editor_state[str(d)] = dict(conversation=second['id'])
            result = store.delete_conversation(d, second['id'])
            self.assertEqual(result['conversation'], first['id'])
            self.assertFalse((store.folder(d)/f"{second['id']}.json").exists())
            self.assertEqual(store.editor_state[str(d)]['conversation'], first['id'])
            fresh = store.ask(d, first['id'], 0, 0, 'New question')
            self.assertGreater(fresh['id'], q['id'])
            with self.assertRaises(ValueError): store.add_response(d, dict(question_id=q['id'], title='Late answer'))
            self.assertEqual(store.read(d, first['id'])['responses'], [])

    def test_last_session_becomes_empty_session_and_invalid_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d = Path(tmp); c = store.create(d)
            store.ask(d, c['id'], 0, 0, 'Old question')
            result = store.delete_conversation(d, c['id'])
            self.assertNotEqual(result['conversation'], c['id'])
            current = store.read(d, result['conversation'])
            self.assertEqual(current['questions'], [])
            self.assertEqual(current['responses'], [])
            self.assertEqual(len(store._all(d)), 1)
            with self.assertRaises(ValueError): store.delete_conversation(d, '../../escape')

if __name__ == '__main__': unittest.main()

class ResponsePartsTest(unittest.TestCase):
    def test_ui_and_text_are_independent_and_finish_completes_question(self):
        import weather
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Weather?');store.take_next(d)
            entry=weather.context(d,['weather'])['weather']['forecast'][0]['id']
            ui=store.add_response(d,dict(question_id=q['id'],part='ui',weather={'forecast_ids':[entry]}))
            self.assertEqual(store.read(d,c['id'])['questions'][0]['status'],'running')
            self.assertEqual(ui['part'],'ui');self.assertEqual(ui['title'],'')
            text=store.add_response(d,dict(question_id=q['id'],part='text',title='Cloudy',layout_slot=1))
            self.assertNotIn('weather',text);self.assertNotEqual(ui['id'],text['id'])
            self.assertEqual(store.add_response(d,dict(question_id=q['id'],part='text',title='Retry'))['id'],text['id'])
            self.assertEqual(len(store.read(d,c['id'])['responses']),2)
            final=store.finish(d,q['id'],'Done')
            self.assertEqual(final['status'],'answered');self.assertEqual(set(final['parts']),{'ui','text'})
            self.assertGreaterEqual(final['parts']['text']['latency'],final['parts']['ui']['latency'])

    def test_partial_ui_survives_language_failure(self):
        import weather
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Weather?');store.take_next(d)
            entry=weather.context(d,['weather'])['weather']['forecast'][0]['id']
            store.add_response(d,dict(question_id=q['id'],part='ui',weather={'forecast_ids':[entry]}))
            final=store.finish(d,q['id'],'UI ready; language response failed.')
            self.assertEqual(final['status'],'answered');self.assertIn('ui',final['parts'])

class DraftTest(unittest.TestCase):
    def test_a_draft_is_answered_revision_by_revision_its_parts_replaced_in_place_then_asked(self):
        import weather
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);entry=weather.context(d,['weather'])['weather']['forecast'][0]['id']
            q=store.draft(d,c['id'],None,0,1.5,'weather this')
            self.assertEqual((q['status'],q['rev']),('drafting',1))
            taken=store.take_next(d);self.assertEqual((taken['id'],taken['taken_rev']),(q['id'],1));self.assertIsNone(store.take_next(d))   # once per revision
            ui=lambda rev:dict(question_id=q['id'],part='ui',upsert=True,rev=rev,mod={'id':'weather'},weather={'forecast_ids':[entry]})
            a=store.add_response(d,ui(1))
            store.draft(d,c['id'],q['id'],0,1.5,'weather this weekend',pause=True)
            store.add_response(d,ui(1))                                                                          # typed on: rev 1 still finishes
            store.draft(d,c['id'],q['id'],0,1.5,'weather this weekend',pause=True)
            self.assertEqual(store.take_next(d)['taken_rev'],3)                                                  # the newest text next, rev 2 skipped
            with self.assertRaises(store.Stale):store.add_response(d,ui(1))                                     # now rev 1 is late
            self.assertEqual(store.revision(d,q['id']),dict(rev=3,status='drafting'))
            b=store.add_response(d,ui(3))
            parts=[r for r in store.read(d,c['id'])['responses'] if r['question_id']==q['id']]
            self.assertEqual(len(parts),1);self.assertNotEqual(a['id'],b['id']);self.assertEqual(b['key'],'weather:weather')   # replaced, not added
            self.assertEqual(store.retract(d,q['id'],['weather:weather'],rev=3),dict(removed=1))
            with self.assertRaises(store.Stale):store.retract(d,q['id'],['x'],rev=1)
            asked=store.finalize(d,c['id'],q['id'],'weather this weekend?',{'read_s':3})
            self.assertEqual((asked['status'],asked['rev'],asked['text']),('queued',4,'weather this weekend?'))
            self.assertEqual([(r['rev'],r.get('pause',False),r.get('final',False)) for r in asked['revisions']],[(1,False,False),(2,True,False),(3,True,False),(4,False,True)])
            run=store.take_next(d);self.assertEqual((run['status'],run['taken_rev'],run['trace']),('running',4,[]))
            with self.assertRaisesRegex(ValueError,'already asked'):store.draft(d,c['id'],q['id'],0,1.5,'x')
