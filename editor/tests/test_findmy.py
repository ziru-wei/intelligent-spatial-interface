import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import findmy,agent_store as store
class FindMyTest(unittest.TestCase):
 def test_resolution_uses_authoritative_box_and_requires_enabled_mod(self):
  with tempfile.TemporaryDirectory() as tmp,store.lock:
   space=Path(tmp);d=space/'scenarios'/'take';d.mkdir(parents=True);(space/'scan').mkdir()
   (space/'scan'/'semantic.json').write_text(json.dumps({'objects':[{'id':'cabinet3','label':'cabinet 3','center':[1,2,3],'size':[.5,.6,.7],'yaw':20}]}))
   (d/'context.json').write_text(json.dumps({'stored_items':[{'id':'brush','label':'Brush','box_id':'cabinet3'}]}))
   result=findmy.resolve(d,{'status':'found','item_id':'brush'});self.assertEqual(result['target']['center'],[1,2,3]);self.assertEqual(result['occlusion'],'hands-only')
   for selection in [{'status':'found','item_id':'unknown'},{'status':'found','item_id':'brush','target':{}},{'status':'ambiguous','item_id':'brush'}]:
    with self.assertRaises(ValueError):findmy.resolve(d,selection)
   c=store.create(d);q=store.ask(d,c['id'],0,0,'brush?',findmy_mod=False)
   with self.assertRaises(ValueError):store.add_response(d,{'question_id':q['id'],'part':'ui','findmy':{'status':'found','item_id':'brush'}})
   q=store.ask(d,c['id'],0,0,'brush?',findmy_mod=True)
   saved=store.add_response(d,{'question_id':q['id'],'part':'ui','findmy':{'status':'found','item_id':'brush'}});self.assertEqual(saved['findmy']['target']['id'],'cabinet3')
 def test_unresolved_does_not_highlight(self):
  self.assertEqual(findmy.resolve(Path('/tmp'),{'status':'not_found'})['status'],'not_found')
