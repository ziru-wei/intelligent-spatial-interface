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
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Weather?',weather_mod=True);store.take_next(d)
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
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Weather?',weather_mod=True);store.take_next(d)
            entry=weather.context(d,['weather'])['weather']['forecast'][0]['id']
            store.add_response(d,dict(question_id=q['id'],part='ui',weather={'forecast_ids':[entry]}))
            final=store.finish(d,q['id'],'UI ready; language response failed.')
            self.assertEqual(final['status'],'answered');self.assertIn('ui',final['parts'])
