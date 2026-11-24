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
    def test_a_question_is_named_by_its_day_and_number(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);a=store.draft(d,c['id'],None,0,1.5,'one');b=store.ask(d,c['id'],0,1.5,'two')
            day=__import__('datetime').datetime.now().strftime('%m%d')
            self.assertEqual((a['label'],b['label']),(f'q-{day}-1',f'q-{day}-2'))
            store.delete_question(d,c['id'],b['id'])
            self.assertEqual(store.ask(d,c['id'],0,1.5,'three')['label'],f'q-{day}-3')   # a deleted question's name is not given again

    def test_a_deleted_questions_id_is_never_given_again(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);a=store.draft(d,c['id'],None,0,1.5,'one');b=store.draft(d,c['id'],None,0,1.5,'two')
            store.delete_question(d,c['id'],b['id'])
            self.assertGreater(store.draft(d,c['id'],None,0,1.5,'three')['id'],b['id'])   # its recording, named by its id, is not another's

    def test_a_conversation_keeps_its_themes_and_parts_carry_theirs(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.draft(d,c['id'],None,0,1.5,'weather this');t=store.take_next(d)
            self.assertEqual(t['n'],1)                                                                   # its number in the conversation
            self.assertEqual(store.themes(d,q['id']),dict(themes=None))
            book={'next':2,'asked':1,'themes':[{'id':1,'sentences':[{'q':q['id'],'i':0,'text':'weather this'}],'mods':{'weather':.9}}]}
            store.set_themes(d,q['id'],book);self.assertEqual(store.themes(d,q['id'])['themes'],book)
            with self.assertRaisesRegex(ValueError,'Bad themes'):store.set_themes(d,q['id'],{'themes':'x'})
            import weather;entry=weather.context(d,['weather'])['weather']['forecast'][0]['id']
            r=store.add_response(d,dict(question_id=q['id'],part='ui',mod={'id':'weather'},weather={'forecast_ids':[entry]},theme={'ids':[1,'x'],'focus':1}))
            self.assertEqual(r['theme'],dict(ids=[1],focus=True))

    def test_a_text_written_anew_is_marked_writing_until_its_stream_ends(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.draft(d,c['id'],None,0,1.5,'weather this');store.take_next(d)
            text=lambda seq,status,body:store.add_response(d,dict(question_id=q['id'],part='text',title='Weekend',body=body,stream=dict(seq=seq,status=status),referenced_item_ids=[]))
            text(1,'streaming','Rain');r=text(2,'complete','Rain on Saturday');self.assertIn('to',r['writing'])   # the first write: its stream
            self.assertEqual(store.mark_writing(d,q['id'],['text:']),dict(changed=1))                             # begun anew: no words yet
            w=store.read(d,c['id'])['responses'][0]['writing'];self.assertNotIn('to',w)
            text(1,'streaming','Sun');r=text(2,'complete','Sun all day');self.assertEqual(r['writing']['from'],w['from']);self.assertIn('to',r['writing'])
            store.mark_writing(d,q['id'],['text:']);self.assertEqual(store.mark_writing(d,q['id'],['text:'],False),dict(changed=1))   # given up

    def test_a_deleted_questions_sentences_leave_the_themes(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);a=store.draft(d,c['id'],None,0,1.5,'weather this');b=store.draft(d,c['id'],None,0,1.5,'weather again')
            book={'next':3,'asked':2,'themes':[{'id':1,'sentences':[{'q':a['id'],'i':0,'text':'weather this'},{'q':b['id'],'i':0,'text':'weather again'}]},
              {'id':2,'sentences':[{'q':b['id'],'i':1,'text':'send it'}]}]}
            store.set_themes(d,a['id'],book);store.delete_question(d,c['id'],b['id'])   # a Rerun replaced it
            self.assertEqual([[s['text'] for s in t['sentences']] for t in store.themes(d,a['id'])['themes']['themes']],[['weather this']])

    def test_a_drafts_text_is_dimmed_when_stale_and_written_again_in_its_place(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.draft(d,c['id'],None,0,1.5,'weather this');store.take_next(d)
            text=lambda seq,status,body:store.add_response(d,dict(question_id=q['id'],part='text',title='Weekend',body=body,stream=dict(seq=seq,status=status),referenced_item_ids=[]))
            a=text(1,'streaming','Rain');text(2,'complete','Rain on Saturday')
            self.assertEqual(store.mark_stale(d,q['id'],['text:']),dict(changed=1))                  # it no longer answers what is asked
            r=store.read(d,c['id'])['responses'][0];self.assertIn('stale_at',r)
            self.assertEqual(store.mark_stale(d,q['id'],['text:']),dict(changed=0))
            b=text(1,'streaming','Sun')                                                               # written anew: the same part, a new stream
            self.assertEqual(b['id'],a['id']);self.assertNotIn('stale_at',b);self.assertEqual(b['stream']['updates'][-1]['body'] if b['stream'].get('updates') else b['body'],'Sun')
            old=store.status(d,c['id'])['withdrawn'];self.assertEqual(len(old),1);self.assertEqual(old[0]['body'],'Rain on Saturday');self.assertIn('stale_at',old[0])   # the text before, kept for replays
            store.mark_stale(d,q['id'],['text:']);self.assertEqual(store.mark_stale(d,q['id'],['text:'],stale=False),dict(changed=1))   # it answers again
            # the theme it answers and whether it is the focus: from when it is written, later changes logged (a replay shows each moment)
            c2=store.create(d);q2=store.draft(d,c2['id'],None,0,1.5,'weather');store.take_next(d)
            t=store.add_response(d,dict(question_id=q2['id'],part='text',title='Rain',body='b',theme={'ids':[3],'focus':True},stream=dict(seq=1,status='streaming'),referenced_item_ids=[]))
            self.assertEqual((t['theme'],len(t['focus_log'])),(dict(ids=[3],focus=True),1))
            self.assertEqual(store.mark_focus(d,q2['id'],['text:'],False),dict(changed=1));self.assertEqual(store.mark_focus(d,q2['id'],['text:'],False),dict(changed=0))
            r=[x for x in store.read(d,c2['id'])['responses'] if x['part']=='text'][0];self.assertEqual([v for _,v in r['focus_log']],[True,False]);self.assertFalse(r['theme']['focus'])

    def _age(self,d,cid,qid,s):
        c=store.read(d,cid);q=next(x for x in c['questions'] if x['id']==qid);q['run_at']-=s;store._write(d,c)   # its last run began s earlier

    def test_a_draft_is_answered_revision_by_revision_its_parts_replaced_in_place_then_asked(self):
        import weather
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);entries=[e['id'] for e in weather.context(d,['weather'])['weather']['forecast'][:2]];entry=entries[0]
            q=store.draft(d,c['id'],None,0,1.5,'weather this')
            self.assertEqual((q['status'],q['rev']),('drafting',1))
            taken=store.take_next(d);self.assertEqual((taken['id'],taken['taken_rev']),(q['id'],1));self.assertIsNone(store.take_next(d))   # once per revision
            ui=lambda rev,e=entry:dict(question_id=q['id'],part='ui',rev=rev,mod={'id':'weather'},weather={'forecast_ids':[e]})
            a=store.add_response(d,ui(1))
            store.draft(d,c['id'],q['id'],0,1.5,'weather this weekend',pause=True)
            self.assertEqual(store.add_response(d,ui(1))['id'],a['id'])                                        # typed on: rev 1 still finishes (the same, nothing new)
            store.draft(d,c['id'],q['id'],0,1.5,'weather this weekend',pause=True)
            self.assertIsNone(store.take_next(d));self.assertGreater(store.next_draft_in(d),1)                 # not before RECOMPUTE_S
            self._age(d,c['id'],q['id'],store.RECOMPUTE_S)
            self.assertEqual(store.take_next(d)['taken_rev'],3)                                                  # the newest text next, rev 2 skipped
            with self.assertRaises(store.Stale):store.add_response(d,ui(1))                                     # now rev 1 is late
            self.assertEqual(store.revision(d,q['id']),dict(rev=3,status='drafting'))
            b=store.add_response(d,ui(3,entries[1]))
            parts=[r for r in store.read(d,c['id'])['responses'] if r['question_id']==q['id']]
            self.assertEqual(len(parts),1);self.assertEqual(a['id'],b['id']);self.assertEqual(b['key'],'weather:weather')   # the same part, new data
            self.assertGreaterEqual(b['updated_at'],b['created']);self.assertEqual(b['created'],a['created'])
            self.assertEqual(store.retract(d,q['id'],['weather:weather'],rev=3),dict(removed=1))
            with self.assertRaises(store.Stale):store.retract(d,q['id'],['x'],rev=1)
            # what left the surface is kept with the moment it left, for replaying how it grew (not among the live responses)
            st=store.status(d,c['id']);gone=st['withdrawn']
            self.assertEqual(len(gone),2);self.assertTrue(all(g['withdrawn_at']>=g['created'] and g['question_id']==q['id'] and g['id']<0 for g in gone))
            self.assertEqual([r for r in st['responses'] if r.get('question_id')==q['id']],[]);self.assertNotIn('withdrawn',st['questions'][0])
            asked=store.finalize(d,c['id'],q['id'],'weather this weekend?',{'read_s':3})
            self.assertEqual((asked['status'],asked['rev'],asked['text']),('queued',4,'weather this weekend?'))
            self.assertEqual([(r['rev'],r.get('pause',False),r.get('final',False)) for r in asked['revisions']],[(1,False,False),(2,True,False),(3,True,False),(4,False,True)])
            run=store.take_next(d);self.assertEqual((run['status'],run['taken_rev'],run['trace']),('running',4,[]))
            # a spoken question's recording: kept in the space beside the conversations, with when it began against the question
            wav=b'RIFF'+b'\0'*4+b'WAVE'+b'\0'*16+(32000).to_bytes(4,'little')+b'\0'*12+b'\0'*16000;a=store.set_audio(d,q['id'],wav,(q['created']+.25)*1000)
            self.assertEqual(a,dict(file=f"agent/audio/{q['id']}.wav",at=.25,duration=.5));self.assertEqual((d/a['file']).read_bytes(),wav)
            v=store.set_audio(d,q['id'],wav,(q['created']+.25)*1000,7.5,(q['created']+.5)*1000,9,(q['created']+2)*1000,.5)['video'];self.assertEqual(v,dict(t=7.5,at=.5,t_end=9,at_end=2,rate=.5))   # Space down, Space up, the speed
            with self.assertRaisesRegex(ValueError,'WAV'):store.set_audio(d,q['id'],b'not audio',0)
            # each revision's run kept (the revision it answered, when it began, its steps) for replaying the pipeline
            store.add_trace(d,q['id'],dict(kind='tool',tool='modos_mods',text='[]',at=5))
            r=store.runs(d,q['id'])['runs'];self.assertEqual([x['rev'] for x in r],[1,3,4]);self.assertTrue(all(isinstance(x['at'],float) for x in r))
            self.assertEqual(r[-1]['steps'][0]['tool'],'modos_mods');self.assertNotIn('traces',store.status(d,c['id'])['questions'][0])
            with self.assertRaisesRegex(ValueError,'already asked'):store.draft(d,c['id'],q['id'],0,1.5,'x')
            store.delete_conversation(d,c['id']);self.assertFalse((d/a['file']).exists())   # its recording goes with it
