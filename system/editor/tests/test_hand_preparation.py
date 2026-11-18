import json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import spaces

class PreparationTests(unittest.TestCase):
 def test_add_recording_prepares_hands_after_import_and_alignment(self):
  calls=[]
  with patch.object(spaces,'import_take',side_effect=lambda *a:calls.append('import')), patch.object(spaces,'MESH_PYTHON',Path('/missing-runtime')), patch.object(spaces,'_align_quietly',side_effect=lambda *a:calls.append('align')), patch.object(spaces,'prepare_hands',side_effect=lambda *a:calls.append('hands') or {'completed':5}):
   result=spaces.add_scenario('home','take')
  self.assertEqual(calls,['import','align','hands']);self.assertEqual(result['hands']['completed'],5)
 def test_complete_cache_skips_detector_and_records_ready_state(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);p=d/'scenarios'/'take'/'session.json';p.parent.mkdir(parents=True);p.write_text(json.dumps({'frames':[]}))
   info={'entries':{'0':{}},'total':1,'version':'test'}
   with patch.object(spaces,'space_dir',return_value=d), patch.object(spaces.hand_cache,'describe',return_value=info), patch.object(spaces.subprocess,'run') as run:
    spaces.prepare_hands('home','take')
   run.assert_not_called();self.assertEqual(json.loads(p.read_text())['handsPreparation']['status'],'ready')
 def test_failure_is_recorded_and_not_reported_as_ready(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);p=d/'scenarios'/'take'/'session.json';p.parent.mkdir(parents=True);p.write_text(json.dumps({'frames':[]}))
   with patch.object(spaces,'space_dir',return_value=d), patch.object(spaces.hand_cache,'describe',return_value={'entries':{},'total':1,'version':'test'}), patch.object(spaces.shutil,'which',return_value=None):
    with self.assertRaises(ValueError):spaces.prepare_hands('home','take')
   self.assertEqual(json.loads(p.read_text())['handsPreparation']['status'],'error')
