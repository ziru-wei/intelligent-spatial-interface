import * as THREE from 'three';
import {buildWeatherTargets,polygonTarget} from './weather-scene.mjs';

// The surfaces agent text is placed on: the layout's own geometry (scan/semantic.json), corrected per recording from its LiDAR depth.
// The scan is not used at runtime.
//
// Walls: RoomPlan's walls are 10 cm slabs whose outline is the mid-plane, so a wall becomes its two faces, each half the thickness out
// from the mid-plane and facing its own side (one-sided: text is never put on a face seen from behind). Doors and windows are already cut
// out of them (`region`, scripts/wall_openings.py). Box faces, windows, zone floors and ceilings are as the weather effects use them.
export function buildTextTargets(sem={}){
  const targets=buildWeatherTargets(sem).filter(t=>t.surface!=='wall');
  for(const w of sem.walls||[]){
    const n=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(w.yaw||0)),half=(w.size?.[2]??.1)/2;
    for(const [i,[outer,...holes]] of (w.region||[[w.outline||[]]]).entries()){if(outer.length<3)continue;
      for(const [side,tag] of [[1,'a'],[-1,'b']]){
        const shift=p=>new THREE.Vector3(...p).addScaledVector(n,side*half);
        const t=polygonTarget(`${w.id}:${i}:${tag}`,'vertical',outer.map(shift),n.clone().multiplyScalar(side),w.rooms?.[0],holes.map(r=>r.map(shift)));
        t.surface='wall';t.wall=w.id;t.oneSided=true;targets.push(t);
      }
    }
  }
  return targets;
}

// Per recording, each surface's real position along its normal, from the recording's own depth (the layout's planes sit a few cm off
// the real surfaces, and the recording's alignment adds its own error): depth points within `band` of a surface's plane and inside its
// outline vote for their signed distance (positive toward the room). The real surface is the deepest well-supported layer (whatever
// else faces the same way, a poster, books on a table, a cabinet in front of a wall, is nearer the room), refined by the median around
// it. Surfaces seen too little, or obliquely only, keep the layout's plane.
export const CALIBRATION={band:.15,bin:.01,support:.5,minSamples:150,maxOffset:.12,frames:24,stride:2,minCos:.3};

export function estimateOffset(values,{band=CALIBRATION.band,bin=CALIBRATION.bin,support=CALIBRATION.support,minSamples=CALIBRATION.minSamples}={}){
  if(values.length<minSamples)return null;
  const n=Math.round(2*band/bin),h=new Float64Array(n);
  for(const v of values){const k=Math.floor((v+band)/bin);if(k>=0&&k<n)h[k]++;}
  const s=h.map((_,k)=>(h[k-1]||0)+2*h[k]+(h[k+1]||0)),peak=Math.max(...s);if(!peak)return null;
  const k=s.findIndex(x=>x>=support*peak),center=-band+(k+.5)*bin;
  const near=values.filter(v=>Math.abs(v-center)<=1.5*bin).sort((a,b)=>a-b);
  return near.length?near[Math.floor(near.length/2)]:center;
}

/** Surfaces that only have a front: wall faces, box faces (their normal points out of the box), zone floors. Windows and ceilings are
 *  taken from either side. */
export const frontOnly=t=>!!t.oneSided||t.surface==='box'||t.surface==='floor';
// Precomputed plane, extent and triangles of a target, for fast point tests.
function prepare(t){
  return {t,o:t.origin,n:t.n,r:t.right,u:t.up,hw:t.width/2+.02,hh:t.height/2+.02,tri:t.triangles,front:frontOnly(t)};
}
function insideLocal(tri,x,y){
  if(!tri)return true;
  for(let i=0;i<tri.length;i+=3){const a=tri[i],b=tri[i+1],c=tri[i+2];
    const d1=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x),d2=(c.x-b.x)*(y-b.y)-(c.y-b.y)*(x-b.x),d3=(a.x-c.x)*(y-c.y)-(a.y-c.y)*(x-c.x);
    if((d1>=0&&d2>=0&&d3>=0)||(d1<=0&&d2<=0&&d3<=0))return true;}
  return false;
}
/** Adds to acc (Map id → number[]) the signed distances of world points (flat xyz array) seen from eye to every target they lie on. */
export function collectSamples(prepared,points,eye,acc,{band=CALIBRATION.band,minCos=CALIBRATION.minCos}={}){
  for(let i=0;i<points.length;i+=3){const px=points[i],py=points[i+1],pz=points[i+2];
    const vx=eye.x-px,vy=eye.y-py,vz=eye.z-pz,vl=Math.hypot(vx,vy,vz)||1;
    for(const p of prepared){const dx=px-p.o.x,dy=py-p.o.y,dz=pz-p.o.z,s=dx*p.n.x+dy*p.n.y+dz*p.n.z;if(s>band||s< -band)continue;
      const x=dx*p.r.x+dy*p.r.y+dz*p.r.z;if(x>p.hw||x< -p.hw)continue;const y=dx*p.u.x+dy*p.u.y+dz*p.u.z;if(y>p.hh||y< -p.hh)continue;
      // Seen from the surface's own side and not at a grazing angle (depth error grows there).
      const c=(vx*p.n.x+vy*p.n.y+vz*p.n.z)/vl;if(p.front?c<minCos:Math.abs(c)<minCos)continue;
      if(!insideLocal(p.tri,x,y))continue;
      let list=acc.get(p.t.id);if(!list)acc.set(p.t.id,list=[]);list.push(s);}
  }
}
/** World points (flat xyz) of a depth map ({data (metres), width, height}) seen by camera, every stride-th pixel. */
export function depthPoints(depth,camera,intrinsics,stride=CALIBRATION.stride){
  const {data,width:w,height:h}=depth,k=intrinsics,m=camera.matrixWorld.elements,out=[];
  for(let y=0;y<h;y+=stride)for(let x=0;x<w;x+=stride){const d=data[y*w+x];if(!(d>0))continue;
    const cx=((x+.5)/w*k.width-k.cx)/k.fx*d,cy=-((y+.5)/h*k.height-k.cy)/k.fy*d,cz=-d;
    out.push(m[0]*cx+m[4]*cy+m[8]*cz+m[12],m[1]*cx+m[5]*cy+m[9]*cz+m[13],m[2]*cx+m[6]*cy+m[10]*cz+m[14]);}
  return out;
}
/** Offsets (Map id → {offset, samples}) for targets from a recording: frames (indices with depth), readDepth(i) → depth map,
 *  camera(i) → posed camera. Yields between frames. */
export async function calibrate(targets,{frames,readDepth,camera,intrinsics,limit=CALIBRATION.frames}){
  const prepared=targets.filter(t=>t.kind!=='ceiling').map(prepare),acc=new Map();
  const step=Math.max(1,frames.length/limit),picked=[...new Set(Array.from({length:Math.min(limit,frames.length)},(_,i)=>frames[Math.floor(i*step)]))];
  for(const i of picked){const depth=await readDepth(i);if(!depth)continue;const cam=camera(i);cam.updateMatrixWorld(true);
    collectSamples(prepared,depthPoints(depth,cam,intrinsics),cam.position,acc);await new Promise(r=>setTimeout(r,0));}
  const out=new Map();
  for(const [id,values] of acc){const offset=estimateOffset(values);if(offset!=null&&Math.abs(offset)<=CALIBRATION.maxOffset)out.set(id,{offset,samples:values.length});}
  return out;
}
/** Targets moved along their normals by the recording's offsets (others unchanged). */
export function applyOffsets(targets,offsets){
  return targets.map(t=>{const o=offsets?.get(t.id);if(!o)return t;return {...t,origin:t.origin.clone().addScaledVector(t.n,o.offset),depthOffset:o.offset};});
}
