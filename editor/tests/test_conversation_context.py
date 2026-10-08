import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import agent_store as store, conversation_context
from unittest.mock import patch
import server

class ConversationContextTest(unittest.TestCase):
    def first_turn(self,d,c):
        q=store.ask(d,c['id'],0,0,'What should I read tonight?');store.take_next(d)
        r=store.add_response(d,dict(question_id=q['id'],part='text',title='Continue To the Lighthouse',body='Around page 68.',referenced_item_ids=['to-the-lighthouse']))
        store.finish(d,q['id'],'Done');return q,r

    def test_persisted_reference_survives_reload_and_stays_in_session(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);self.first_turn(d,c)
            follow=store.ask(d,c['id'],0,0,'OK, where is it?')
            state=conversation_context.snapshot(store.read(d,c['id']),follow)
            self.assertEqual(state['referents'][0]['item_id'],'to-the-lighthouse')
            self.assertEqual(state['referents'][0]['context_groups'],['personal','storage'])
            self.assertEqual(len(state['recent_turns']),1)
            other=store.create(d);q=store.ask(d,other['id'],0,0,'Where is it?')
            self.assertEqual(conversation_context.snapshot(store.read(d,other['id']),q)['referents'],[])

    def test_only_visible_answers_before_question_are_used_and_deletion_clears_memory(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);first,r=self.first_turn(d,c)
            follow=store.ask(d,c['id'],0,0,'Where is it?')
            fresh=store.read(d,c['id']);fresh['responses'][0]['created']=follow['created']+10
            self.assertEqual(conversation_context.snapshot(fresh,follow)['referents'],[])
            store.delete_question(d,c['id'],first['id'])
            self.assertEqual(conversation_context.snapshot(store.read(d,c['id']),follow)['referents'],[])

    def test_unmentioned_current_book_and_unknown_ids_do_not_enter_memory(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);q=store.ask(d,c['id'],0,0,'Hello');store.take_next(d)
            with self.assertRaises(ValueError):store.add_response(d,dict(question_id=q['id'],part='text',title='Hello',referenced_item_ids=['made-up']))
            store.add_response(d,dict(question_id=q['id'],part='text',title='Hello'))
            store.finish(d,q['id'],'Done');follow=store.ask(d,c['id'],0,0,'Where is it?')
            self.assertEqual(conversation_context.snapshot(store.read(d,c['id']),follow)['referents'],[])

    def test_history_is_bounded_and_contains_multiple_referents(self):
        turns=[dict(id=i,text='Question '+str(i),created=i) for i in range(6)]
        entities=[dict(item_id='book-a',label='Book A',context_groups=['storage']),dict(item_id='book-b',label='Book B',context_groups=['storage'])]
        c=dict(questions=turns,responses=[dict(question_id=i,created=i+.1,title='Answer',referenced_entities=entities) for i in range(5)])
        state=conversation_context.snapshot(c,turns[-1])
        self.assertEqual(len(state['recent_turns']),3)
        self.assertEqual({r['item_id'] for r in state['referents']},{'book-a','book-b'})

    def test_catalog_carries_question_specific_memory_without_loading_sections(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d=Path(tmp);c=store.create(d);self.first_turn(d,c)
            follow=store.ask(d,c['id'],0,0,'OK, where is it?')
            other=store.create(d);unrelated=store.ask(d,other['id'],0,0,'Where is it?')
            with patch.object(server,'session_dir',return_value=d), patch.object(server,'frame_pose',return_value={}):
                catalog=server.agent_context('fixture',[],str(follow['id']))
                self.assertEqual(catalog['loaded_groups'],[])
                self.assertNotIn('preferences',catalog);self.assertNotIn('stored_items',catalog)
                self.assertEqual(catalog['conversation']['referents'][0]['item_id'],'to-the-lighthouse')
                self.assertEqual(server.agent_context('fixture',[],unrelated['id'])['conversation']['referents'],[])

    def test_ui_only_response_records_item_but_next_turn_reads_current_location(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            space=Path(tmp);d=space/'scenarios'/'take';d.mkdir(parents=True);(space/'scan').mkdir()
            layout=space/'scan'/'semantic.json'
            layout.write_text(json.dumps({'objects':[{'id':'table2','label':'Table 2','center':[1,2,3],'size':[1,1,1]}]}))
            context=d/'context.json'
            context.write_text(json.dumps({'stored_items':[{'id':'book','label':'Book','box_id':'table2','location':'Table 2 drawer'}]}))
            c=store.create(d);q=store.ask(d,c['id'],0,0,'Where is Book?',findmy_mod=True);store.take_next(d)
            r=store.add_response(d,dict(question_id=q['id'],part='ui',findmy={'status':'found','item_id':'book'}))
            self.assertEqual(r['referenced_entities'][0]['item_id'],'book')
            self.assertNotIn('target',r['referenced_entities'][0]);self.assertNotIn('location',r['referenced_entities'][0])
            store.finish(d,q['id'],'UI ready')
            follow=store.ask(d,c['id'],0,0,'Where is it now?',findmy_mod=True)
            context.write_text(json.dumps({'stored_items':[{'id':'book','label':'Book','box_id':'table2','location':'Table 2 top'}]}))
            layout.write_text(json.dumps({'objects':[{'id':'table2','label':'Table 2','center':[4,5,6],'size':[1,1,1]}]}))
            with patch.object(server,'session_dir',return_value=d), patch.object(server,'frame_pose',return_value={}):
                current=server.agent_context('fixture',['storage'],follow['id'])
            self.assertEqual(current['conversation']['referents'][0]['item_id'],'book')
            self.assertEqual(current['stored_items'][0]['location'],'Table 2 top')
            self.assertEqual(store.findmy.resolve(d,{'status':'found','item_id':'book'})['target']['center'],[4,5,6])
