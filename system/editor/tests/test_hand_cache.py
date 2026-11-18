import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import hand_cache

class HandCacheTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.d=Path(self.tmp.name)
  (self.d/'a.jpg').write_bytes(b'one');(self.d/'b.jpg').write_bytes(b'two')
  (self.d/'session.json').write_text(json.dumps({'frames':[{'image':'a.jpg'},{'image':'b.jpg'}]}))
  self.token=hand_cache.describe(self.d)['token']
 def test_empty_is_persistent_without_mask_files(self):
  hand_cache.write(self.d,0,self.token,dict(width=8,height=8,landmarks=[]))
  self.assertTrue(hand_cache.describe(self.d)['entries']['0']['empty'])
  self.assertEqual(hand_cache.read(self.d,0,self.token)['runs'],[])
  self.assertEqual(list(self.d.rglob('*.json.gz')),[])
  self.assertIsNone(hand_cache.read(self.d,1,self.token))
 def test_positive_roundtrip_and_invalid_masks(self):
  value=dict(width=8,height=8,landmarks=[[dict(x=.5,y=.5,z=0)]*21],runs=[8,48,8])
  hand_cache.write(self.d,1,self.token,value)
  self.assertEqual(hand_cache.read(self.d,1,self.token)['runs'],value['runs'])
  with self.assertRaises(ValueError):hand_cache.write(self.d,0,self.token,{**value,'runs':[1]})
  self.assertNotIn('0',hand_cache.describe(self.d)['entries'])
 def test_source_changes_invalidate_recording_and_cross_recording_tokens(self):
  hand_cache.write(self.d,0,self.token,dict(width=8,height=8,landmarks=[]))
  (self.d/'a.jpg').write_bytes(b'changed')
  with self.assertRaises(ValueError):hand_cache.read(self.d,0,self.token)
  refreshed=hand_cache.describe(self.d);self.assertNotEqual(refreshed['token'],self.token);self.assertEqual(refreshed['entries'],{})
  with self.assertRaises(ValueError):hand_cache.write(self.d,0,self.token,dict(width=8,height=8,landmarks=[]))
