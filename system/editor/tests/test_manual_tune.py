import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import spaces


class ManualTuneTest(unittest.TestCase):
    def test_first_manual_placement_needs_no_automatic_registration(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(spaces, 'SPACES', Path(tmp)):
            scene=Path(tmp)/'atlas'; recording=scene/'scenarios'/'rec'
            recording.mkdir(parents=True)
            (scene/'space.json').write_text('{}')
            path=recording/'session.json'
            frames=[dict(position=[1,2,3],quaternion=[0,0,0,1])]
            path.write_text(json.dumps(dict(frames=frames,roomMesh='room.glb')))
            transform=list(spaces.IDENTITY); transform[3]=4; transform[11]=-2
            spaces.align_manually('atlas','rec',transform,dict(method='fine-tune'))
            saved=json.loads(path.read_text())
            self.assertEqual(saved['toSpace'],transform)
            self.assertEqual(saved['registration']['method'],'fine-tune')
            self.assertEqual(saved['frames'],frames)
            self.assertIsNone(saved['registration']['rmse'])

if __name__ == '__main__': unittest.main()
