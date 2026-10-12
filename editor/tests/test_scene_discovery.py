import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import spaces
import import_record3d
from record3d_source import part
from PIL import Image


class SceneDiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for key, value in [('ROOT', self.root), ('PRIVATE', self.root/'private'), ('SPACES', self.root/'spaces'), ('NAMES', self.root/'spaces'/'names.json')]:
            p = patch.object(spaces, key, value); p.start(); self.addCleanup(p.stop)

    def source(self, scene, take='take', suffix=''):
        d = spaces.PRIVATE/scene/'recordings'/take
        (d/f'rgb{suffix}').mkdir(parents=True)
        (d/f'depth{suffix}').mkdir()
        (d/f'metadata{suffix}.json').write_text(json.dumps(dict(w=2,h=2,fps=30,K=[1,0,0,0,1,0,1,1,1],poses=[[0,0,0,1,0,0,0]])))
        Image.new('RGB',(2,2)).save(d/f'rgb{suffix}'/'0.jpg')
        return d

    def test_discovers_without_creating_and_keeps_scenes_separate(self):
        a = self.source('atlas', suffix=' 2'); self.source('home')
        scans = spaces.PRIVATE/'atlas'/'scans'; scans.mkdir(); (scans/'atlas.glb').write_bytes(b'glb')
        (spaces.PRIVATE/'_archive'/'scans').mkdir(parents=True)
        listing = spaces.listing()
        self.assertEqual([x['name'] for x in listing], ['atlas','home'])
        self.assertEqual(listing[0]['pendingScans'], [dict(name='atlas.glb',label='atlas')])
        self.assertFalse(spaces.SPACES.exists())
        self.assertEqual(spaces._take('take','atlas'), a)
        self.assertEqual(len(spaces.takes()),2)
        with self.assertRaises(ValueError): spaces._take('take','other')
        d = spaces.ensure_scene('atlas')
        obj = d/'components'/'cup'; obj.mkdir(parents=True)
        (obj/'component.json').write_text(json.dumps(dict(category='opportunistic',name='Cup')))
        self.assertEqual(spaces.listing()[0]['objects'], ['Cup'])
        self.assertEqual(spaces.listing()[1]['objects'], [])

    def test_numbered_recording_import_preserves_sources(self):
        source = self.source('atlas', suffix=' 2')
        result = import_record3d.convert(source, self.root/'out')
        self.assertEqual(len(result['frames']), 1)
        self.assertTrue((source/'metadata 2.json').is_file())
        self.assertFalse((source/'metadata.json').exists())
        (source/'metadata 3.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'Ambiguous'): part(source,'metadata.json')

    def test_scan_import_is_scoped_and_disappears_from_pending(self):
        self.source('atlas')
        scans = spaces.PRIVATE/'atlas'/'scans'; scans.mkdir()
        gltf = dict(asset=dict(version='2.0'),scenes=[dict(nodes=[0])],nodes=[dict(name='mesh')])
        import struct
        body=json.dumps(gltf).encode(); body+=b' '*(-len(body)%4)
        (scans/'atlas.glb').write_bytes(b'glTF'+struct.pack('<II',2,20+len(body))+struct.pack('<I',len(body))+b'JSON'+body)
        result=spaces.import_scan('atlas','atlas.glb')
        self.assertEqual(result['registration']['method'],'defines-space')
        self.assertEqual(spaces.listing()[0]['pendingScans'],[])
        self.assertTrue(spaces.listing()[0]['scans'][0]['primary'])
        with self.assertRaises(ValueError): spaces.import_scan('atlas','../home.glb')

if __name__ == '__main__': unittest.main()
