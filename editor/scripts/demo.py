"""Generate a synthetic Record3D "EXR + JPG sequence" export with known poses and exact depth, then import it.

The scene is a floor (y=0) and a wall (z=-6) seen from a camera sweeping sideways,
in the same convention as ARKit: y up, meters, camera looking down -z.
"""
import json,math,shutil,tempfile
from pathlib import Path
import numpy as np, OpenEXR
from PIL import Image,ImageDraw
from import_record3d import convert
root=Path(__file__).resolve().parents[1]
source=Path(tempfile.mkdtemp(prefix='record3d-demo-'));(source/'rgb').mkdir();(source/'depth').mkdir()
w,h=640,480;fx=fy=500;cx=320;cy=240;dw,dh=160,120;WALL=-6
poses=[];stamps=[]
for i in range(90):
    t=i/15;px=.55*math.sin(t*.9);py=.85;pz=.1;angle=.12*math.sin(t*.7)
    # Yaw about +y; R maps camera to world.
    R=np.array([[math.cos(angle),0,math.sin(angle)],[0,1,0],[-math.sin(angle),0,math.cos(angle)]]);c=np.array([px,py,pz])
    def project(p):
        v=R.T@(np.array(p)-c)
        if -v[2]<.1:return None
        return (fx*v[0]/-v[2]+cx,cy-fy*v[1]/-v[2])
    im=Image.new('RGB',(w,h),'#263735');d=ImageDraw.Draw(im)
    def line(a,b,color,width=1):
        a,b=project(a),project(b)
        if a and b:d.line([a,b],fill=color,width=width)
    for x in np.arange(-5,5.1,.5):line([x,0,-.5],[x,0,WALL],'#50645c')
    for z in np.arange(-.5,WALL-.1,-.5):line([-5,0,z],[5,0,z],'#50645c')
    for x in range(-4,5):line([x,0,WALL],[x,3,WALL],'#61776d')
    for y in np.arange(0,3.1,.5):line([-4,y,WALL],[4,y,WALL],'#61776d')
    # Ground truth target where default virtual cube is placed; grid gives parallax.
    for a,b in [((-.3,0,-2.5),(.3,0,-2.5)),((0,0,-2.2),(0,0,-2.8))]:line(a,b,'#efbd76',3)
    for n,p in enumerate([(-1.1,0,-3.2),(1.2,0,-4),(0,.8,WALL)]):
        q=project(p)
        if q:d.ellipse([q[0]-6,q[1]-6,q[0]+6,q[1]+6],fill='#b8d9c8');d.text((q[0]+10,q[1]),f'TARGET {n+1}',fill='#d8e8df')
    d.text((20,20),'SYNTHETIC SAMPLE / KNOWN CAMERA TRAJECTORY',fill='#c8dacd');d.text((20,42),f'FRAME {i:03d} | {t:.2f}s',fill='#96b3a4')
    im.save(source/'rgb'/f'{i}.jpg',quality=92)
    # Exact axial depth: intersect each depth pixel's ray with the floor and wall planes.
    s=dw/w;u,v=np.meshgrid((np.arange(dw)+.5)/s,(np.arange(dh)+.5)/s)
    ray=np.stack([(u-cx)/fx,-(v-cy)/fy,-np.ones_like(u)],-1)@R.T
    with np.errstate(divide='ignore',invalid='ignore'):
        floor=np.where(ray[...,1]<0,-py/ray[...,1],np.inf);wall=np.where(ray[...,2]<0,(WALL-pz)/ray[...,2],np.inf)
    depth=np.minimum(floor,wall);depth[~np.isfinite(depth)|(depth>20)]=0
    OpenEXR.File({'compression':OpenEXR.ZIP_COMPRESSION,'type':OpenEXR.scanlineimage},{'R':depth.astype(np.float16)}).write(str(source/'depth'/f'{i}.exr'))
    q=[0,math.sin(angle/2),0,math.cos(angle/2)];poses.append(q+[px,py,pz]);stamps.append(t)
(source/'metadata.json').write_text(json.dumps(dict(w=w,h=h,dw=dw,dh=dh,fps=15,K=[fx,0,0,0,fy,0,cx,cy,1],poses=poses,frameTimestamps=stamps)))
dest=root/'spaces/demo/scenarios/demo'
(root/'spaces/demo').mkdir(parents=True,exist_ok=True)
if not (root/'spaces/demo/space.json').exists():(root/'spaces/demo/space.json').write_text(json.dumps(dict(version=1,name='demo',scan=None)))
if dest.exists():shutil.rmtree(dest)
m=convert(source,dest,depth=True,synthetic=True)
# Only disposable generated source is removed; normalized demo retained.
shutil.rmtree(source)
print(json.dumps(m['report']))
