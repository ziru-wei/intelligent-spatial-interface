import sys,unittest,tempfile,json,math
from pathlib import Path
import numpy as np, OpenEXR
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_record3d import convert,add_depth

POSES=[[0,math.sin(.1),0,math.cos(.1),.1*i,1.5,-.2] for i in range(4)]
class Record3DImportTest(unittest.TestCase):
 def make_source(self,base,**meta):
  s=Path(base)/'raw';(s/'rgb').mkdir(parents=True);(s/'depth').mkdir()
  for i in range(4):
   Image.new('RGB',(4,2),(60*i,0,0)).save(s/'rgb'/f'{i}.jpg')
   OpenEXR.File({'compression':OpenEXR.ZIP_COMPRESSION,'type':OpenEXR.scanlineimage},{'R':np.array([[1.234,0],[np.inf,2.5]],np.float16)}).write(str(s/'depth'/f'{i}.exr'))
  m=dict(w=4,h=2,dw=2,dh=2,fps=60,K=[10,0,0,0,11,0,2.1,0.9,1],poses=POSES,frameTimestamps=[.5+i/60 for i in range(4)]);m.update(meta)
  (s/'metadata.json').write_text(json.dumps(m))
  return s
 def test_pose_passthrough_and_column_major_k(self):
  with tempfile.TemporaryDirectory() as t:
   m=convert(self.make_source(t),Path(t)/'out')
   self.assertEqual(m['intrinsics'],dict(fx=10,fy=11,cx=2.1,cy=.9,width=4,height=2))
   f=m['frames'][2];self.assertEqual(f['position'],POSES[2][4:]);self.assertAlmostEqual(f['quaternion'][1],math.sin(.1))
   self.assertAlmostEqual(f['t'],2/60);self.assertTrue((Path(t)/'out'/f['image']).is_file());self.assertNotIn('depth',m)
 def test_per_frame_intrinsics_median(self):
  with tempfile.TemporaryDirectory() as t:
   m=convert(self.make_source(t,perFrameIntrinsicCoeffs=[[10,10,2,1],[12,12,2,1],[11,11,2,1],[11,11,2,1]]),Path(t)/'out')
   self.assertEqual(m['intrinsics']['fx'],11);self.assertAlmostEqual(m['report']['focalSpread'],.2)
 def test_missing_image_rejected_and_stride(self):
  with tempfile.TemporaryDirectory() as t:
   s=self.make_source(t);(s/'rgb'/'2.jpg').unlink()
   m=convert(s,Path(t)/'out');self.assertEqual([f['sourceIndex'] for f in m['frames']],[0,1,3]);self.assertEqual(m['report']['rejected'][0]['row'],2)
   m=convert(self.make_source(Path(t)/'b'),Path(t)/'out2',stride=2);self.assertEqual([f['sourceIndex'] for f in m['frames']],[0,2])
 def test_depth_png_round_trip(self):
  with tempfile.TemporaryDirectory() as t:
   m=convert(self.make_source(t),Path(t)/'out',depth=True)
   self.assertEqual(m['depth']['width'],2)
   a=np.asarray(Image.open(Path(t)/'out'/m['frames'][0]['depth'])).astype(int);mm=a[...,0]*256+a[...,1]
   # float16(1.234)=1.2343; non-finite depth becomes 0 (no measurement).
   self.assertEqual(mm.tolist(),[[1234,0],[0,2500]])
 def test_add_depth_to_existing_session(self):
  with tempfile.TemporaryDirectory() as t:
   s=self.make_source(t);out=Path(t)/'out';convert(s,out,stride=2);(out/'room.glb').write_text('kept')
   m=add_depth(s,out)
   self.assertEqual([f['depth'] for f in m['frames']],['depth/000000.png','depth/000001.png']);self.assertEqual(m['depth']['height'],2)
   self.assertEqual(json.loads((out/'session.json').read_text())['depth']['encoding'],'png-rg-uint16-mm');self.assertEqual((out/'room.glb').read_text(),'kept')
   (s/'depth'/'2.exr').unlink()
   with self.assertRaises(ValueError):add_depth(s,out)
 def test_non_empty_destination_preserved(self):
  with tempfile.TemporaryDirectory() as t:
   out=Path(t)/'out';out.mkdir();(out/'keep').write_text('x')
   with self.assertRaises(ValueError):convert(self.make_source(t),out)
if __name__=='__main__':unittest.main()
