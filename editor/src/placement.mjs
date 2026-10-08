import * as THREE from 'three';
import {staticTextPlacement,visibleFraction,surfaceSupports} from './text-surfaces.mjs';
import {placementVisibility} from './placement-stability.mjs';
import {TEXT_VIEW,textViewMetrics,viewSizedWidth,footprintPoints,centeredPose} from './text-view.mjs';
// Where an agent response appears in the room. A strategy maps (response, ctx) to {position, quaternion, width}: the pose of a text
// plane (local +Z = the side it is read from, +Y = text up) and its width in metres.
// ctx = {frames, surfaceAt(frame, u, v) -> {point, normal} | null, surfacePatch(frame, u, v, radius) -> world points,
//        visible(frame, points) -> booleans (in view and not behind what the frame's depth saw)}. response.aspect: text height / width.
// Only 'user-view' exists now. A spatial placement algorithm plugs in as another strategy that reads response.anchor
// ({object, relation} chosen by the agent) together with object anchors and surfaces.
const UP=new THREE.Vector3(0,1,0);
// Text width (m) for a surface at distance d: legible at any distance.
export const textWidth=d=>THREE.MathUtils.clamp(.42*d,.25,1.6);
export const strategies={
  // On the real surface at the centre of the user's view at the moment of the question. The surface is fitted over the area the
  // text will cover (ctx.surfacePatch: world points around the hit), not taken from one pixel or triangle, and classified:
  // plane → flat text on the fitted plane; curved → text bent onto the fitted smooth quadric; rough (clutter, an edge or corner, or
  // curving too much to read) → text standing on the surface, upright and turned to the user.
  async 'user-view'(response,ctx){
    const f=ctx.frames[response.frame]??ctx.frames[0];
    const eye=new THREE.Vector3(...f.position),forward=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(...f.quaternion));
    const hit=await ctx.surfaceAt?.(response.frame,.5,.5);
    if(!hit?.normal)return {...facing(eye.clone().addScaledVector(forward,1),eye,.42,new THREE.Quaternion(...f.quaternion)),align:'center'};
    const camera=ctx.frameCamera?.(response.frame),viewport=ctx.viewport?.();
    const normal=hit.normal.clone().normalize();if(normal.dot(eye.clone().sub(hit.point))<0)normal.negate();
    const initialBasis=readableSurfaceBasis(normal,new THREE.Quaternion(...f.quaternion));
    const initialQ=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(initialBasis.right,initialBasis.up,normal));
    const width=camera&&viewport?viewSizedWidth(hit.point,initialQ,camera,viewport,response.textMetrics,response.aspect):textWidth(hit.point.distanceTo(eye)),points=await ctx.surfacePatch?.(response.frame,.5,.5,.6*width,hit);
    const fit=points&&fitSurface(points,hit.point,eye);
    const n=(fit?.normal||hit.normal).clone().normalize(),center=fit?fit.at(0,0):hit.point.clone(),toEye=eye.clone().sub(center);if(n.dot(toEye)<0)n.negate();
    const distance=toEye.length(),facingCos=n.dot(toEye)/distance,wall=Math.abs(n.y)<.7;
    // Use the camera's up direction projected onto the receiving surface. The
    // floor's "away from the viewer" rule reverses text when reused on ceilings.
    const {up,right}=readableSurfaceBasis(n,new THREE.Quaternion(...f.quaternion));
    const aspect=response.aspect||.45,visible=ctx.visible&&(pts=>ctx.visible(response.frame,pts));
    const kind=fit?classify(fit,right,up,width,width*aspect):'point',lift=fit?THREE.MathUtils.clamp(.01+2*fit.rms,.012,.04):.03;
    const stand=reason=>standing(hit.point.clone().addScaledVector(n,.03),eye,width,aspect,wall,visible,new THREE.Quaternion(...f.quaternion)).then(p=>({...p,kind,reason}));
    // Seen too obliquely, text on the surface smears into a streak; on a rough surface it would break up: stand it on the surface.
    if(kind==='rough'||facingCos<(wall?.42:.64))return stand(kind==='rough'?'rough':'oblique');
    // On the surface: the largest area near the centre that is this surface and in plain view (not hanging over an edge, not behind
    // a window frame), as wide as the default at most; narrower than legible text: stand instead.
    let cx=0,cy=0,w=width;
    if(fit){const r=await freeRect({fit,right,up,n,lift,W:width,aspect,visible});if(!r)return stand('no room');({cx,cy,w}=r);
      if(w<minWidth(fit.atText(right,up,cx,cy),up,eye))return stand('illegible');}
    const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,n));
    // Lifted off the surface (more on noisier surfaces) so depth noise in the occluders does not cut into the text. On a curved
    // surface, surface(x, y) is the height (along the text's +Z) of the fitted surface at text coordinates (x, y), 0 at the centre.
    const surface=kind==='curved'?(x,y)=>fit.height(right,up,x+cx,y+cy)-fit.height(right,up,cx,cy):null;
    return {position:(fit?fit.atText(right,up,cx,cy):center).addScaledVector(n,lift),quaternion:q,width:w,align:'center',kind,surface};
  }
};
export function projectedSurfaceBasis(normal,position,camera){
 camera.updateMatrixWorld(true);
 const M=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),e=M.elements,p=new THREE.Vector4(position.x,position.y,position.z,1).applyMatrix4(M);
 const gradient=new THREE.Vector3(e[1]*p.w-e[3]*p.y,e[5]*p.w-e[7]*p.y,e[9]*p.w-e[11]*p.y);
 const n=normal.clone().normalize(),right=n.clone().cross(gradient).normalize();
 const dx=new THREE.Vector3(e[0]*p.w-e[3]*p.x,e[4]*p.w-e[7]*p.x,e[8]*p.w-e[11]*p.x);
 if(right.dot(dx)<0)right.negate();
 return {right,up:n.clone().cross(right).normalize()};
}
export function readableSurfaceBasis(normal,viewQuaternion,position,eye,camera){
 if(camera&&position)return projectedSurfaceBasis(normal,position,camera);
 if(position&&eye){
  const n=normal.clone().normalize(),local=position.clone().sub(eye).applyQuaternion(viewQuaternion.clone().invert());
  // A tangent to constant projected y makes the baseline horizontal even with
  // camera roll and an off-centre perspective view, without leaving the plane.
  const constraint=new THREE.Vector3(0,local.z,-local.y).applyQuaternion(viewQuaternion),right=n.clone().cross(constraint);
  if(right.lengthSq()>1e-8){right.normalize();const screenRight=new THREE.Vector3(1,0,0).applyQuaternion(viewQuaternion);if(right.dot(screenRight)<0)right.negate();return {right,up:n.clone().cross(right).normalize()};}
 }
 const n=normal.clone().normalize(),cameraUp=Math.abs(n.y)<.7?UP.clone():new THREE.Vector3(0,1,0).applyQuaternion(viewQuaternion),cameraRight=new THREE.Vector3(1,0,0).applyQuaternion(viewQuaternion);
 let up=cameraUp.clone().addScaledVector(n,-cameraUp.dot(n));
 if(up.lengthSq()<1e-8){const right=cameraRight.clone().addScaledVector(n,-cameraRight.dot(n)).normalize();up=n.clone().cross(right);}
 up.normalize();const right=up.clone().cross(n).normalize();return {up,right};
}
// Legibility floor: the body text's x-height (about 24 px of the 1024 px-wide text texture) must subtend at least minXHeightDeg at
// the eye: 0.3° is about 8 px on a Quest 3 (~25 px per degree). Measured from the eye along the text's up axis, so a text lying on a
// desk, foreshortened, needs to be wider.
export const LEGIBLE={minXHeightDeg:.3,xHeightPerWidth:24/1024};
export function minWidth(p,up,eye){
  const a=p.clone().sub(eye),b=p.clone().addScaledVector(up,LEGIBLE.xHeightPerWidth).sub(eye);
  return LEGIBLE.minXHeightDeg/THREE.MathUtils.radToDeg(a.angleTo(b));
}
// The largest text rectangle (w × aspect·w: the text plane, which holds the glass too) on the fitted surface near its centre whose every point is on
// this surface (an inlier nearby) and visible in the frame (checked conservatively: the cells just past its edges too). A grid of
// W/24 cells over the patch; centres within 0.35 W; score
// w − 0.5·offset, so it leaves the gaze point only for a clearly larger area. Null when no centre fits even 2 cells.
export async function freeRect({fit,right,up,n,lift,W,aspect,visible}){
  const g=W/24,N=Math.ceil(.6*W/g),S=2*N+1,cells=[];for(let j=-N;j<=N;j++)for(let i=-N;i<=N;i++)cells.push([i*g,j*g]);
  const vis=visible?await visible(cells.map(([x,y])=>fit.atText(right,up,x,y).addScaledVector(n,lift))):null;
  const ok=cells.map(([x,y],k)=>(!vis||vis[k])&&fit.covered(right,up,x,y,.75*g)),at=(i,j)=>Math.abs(i)<=N&&Math.abs(j)<=N&&ok[(j+N)*S+i+N];
  const C=Math.round(.35*W/g);let best=null;
  for(let cj=-C;cj<=C;cj++)for(let ci=-C;ci<=C;ci++){
    if(!at(ci,cj))continue;let k=1;
    for(let kk=2;kk<=24;kk++){const ex=Math.ceil(kk/2-1e-9),ey=Math.ceil(kk*aspect/2-1e-9);let all=true;
      for(let j=-ey;j<=ey&&all;j++)for(let i=-ex;i<=ex;i++)if(!at(ci+i,cj+j)){all=false;break;}
      if(!all)break;k=kk;}
    if(k<2)continue;const score=k*g-.5*g*Math.hypot(ci,cj);
    if(!best||score>best.score)best={score,cx:ci*g,cy:cj*g,w:k*g};
  }
  return best;
}
// Text standing at p, upright and turned to the user (bottom edge on a desk, centred on a wall). If something in the frame hides part
// of it, it comes toward the eye (keeping its size in view) until it is in plain view.
async function standing(p,eye,W,aspect,wall,visible,viewQuaternion){
  let pose={...facing(p,eye,W,viewQuaternion),align:wall?'center':'bottom'};
  for(let k=0;k<6&&visible;k++){
    const right=new THREE.Vector3(1,0,0).applyQuaternion(pose.quaternion),h=aspect*pose.width,pts=[];
    for(let i=0;i<=6;i++)for(let j=0;j<=4;j++)pts.push(pose.position.clone().addScaledVector(right,(i/6-.5)*pose.width).addScaledVector(UP,(wall?j/4-.5:j/4)*h));
    if((await visible(pts)).every(Boolean))break;
    const next=pose.position.clone().lerp(eye,.15);pose={...facing(next,eye,pose.width*next.distanceTo(eye)/pose.position.distanceTo(eye),viewQuaternion),align:pose.align};
  }
  return pose;
}
// Fit the smooth surface the centre point lies on, from points around it (which usually span several surfaces: a wall, a door frame,
// a chair). Region growing: start from a small patch around the centre, then widen the radius step by step, each time keeping the
// points within a tolerance of the current fit and refitting. The fit: the inliers' average (PCA) normal, and over it a quadric
// height field z = a x² + b xy + c y² + d x + e y + f (low order, so it is smooth whatever the depth noise). Null with too few points.
export const GROW={seed:.1,steps:5,tol:.012};
export function fitSurface(points,center,eye){
  // Flat arrays and distances to the centre computed once; the region grows by index lists (no per-iteration allocations).
  const N=points.length,P=new Float64Array(3*N),dist=new Float64Array(N);let R=0;
  for(let i=0;i<N;i++){const p=points[i];P[3*i]=p.x;P[3*i+1]=p.y;P[3*i+2]=p.z;dist[i]=p.distanceTo(center);if(dist[i]>R)R=dist[i];}
  const within=r=>{const o=[];for(let i=0;i<N;i++)if(dist[i]<=r)o.push(i);return o;};
  let inl=within(Math.max(GROW.seed,R/4)),res=null,tol=GROW.tol;
  for(let k=1;k<=GROW.steps+1;k++){
    if(inl.length<30){if(!res)return null;break;}
    res=fitQuadric(P,inl,center,eye);if(!res)return null;
    // The tolerance follows the seed patch's noise only, so the region cannot creep onto neighbouring surfaces.
    // (Robust: from the median residual, so an object in the seed patch does not widen it.)
    if(k===1){const r=Float64Array.from(inl,i=>Math.abs(res.residualAt(P,i))).sort();tol=Math.max(GROW.tol,3*1.4826*r[r.length>>1]);}
    if(k>GROW.steps)break;
    const r=R*k/GROW.steps,next=[];for(let i=0;i<N;i++)if(dist[i]<=r&&Math.abs(res.residualAt(P,i))<tol)next.push(i);inl=next;
  }
  // A quartic fitted to the final inliers: much better than the quadric means the surface is not one smooth patch (a corner, an
  // object on a desk), whatever the depth noise (which both fits keep alike).
  const rms4=quarticRms(res.local);res.excess=rms4==null?0:res.rms-rms4;
  const {c,n,t1,t2,coef,quad,x0,y0}=res,bins=new Map();
  return {...res,normal:n,radius:R,
    // Point on the fitted surface at fit coordinates (x0+dx, y0+dy) (offsets from the centre in the tangent plane).
    atText:(right,up,x,y)=>{const d=right.clone().multiplyScalar(x).addScaledVector(up,y);return c.clone().addScaledVector(t1,x0+d.dot(t1)).addScaledVector(t2,y0+d.dot(t2)).addScaledVector(n,quad(x0+d.dot(t1),y0+d.dot(t2)));},
    at:(dx,dy)=>c.clone().addScaledVector(t1,x0+dx).addScaledVector(t2,y0+dy).addScaledVector(n,quad(x0+dx,y0+dy)),
    // Pure curvature (the quadratic form, along n) at an offset from the centre given in text coordinates (x along `right`, y along `up`).
    bend:(right,up,x,y)=>{const d=right.clone().multiplyScalar(x).addScaledVector(up,y),dx=d.dot(t1),dy=d.dot(t2);return coef[0]*dx*dx+coef[1]*dx*dy+coef[2]*dy*dy;},
    // Height of the fitted surface along n at text coordinates, relative to the centre.
    height:(right,up,x,y)=>{const d=right.clone().multiplyScalar(x).addScaledVector(up,y),dx=d.dot(t1),dy=d.dot(t2);return quad(x0+dx,y0+dy)-quad(x0,y0);},
    // Is there surface (an inlier) within `r` of the text point (x, y)?
    // (Inliers are binned once per radius in a grid of r-sized cells, so a query looks at 3 × 3 cells, not every inlier.)
    covered:(right,up,x,y,r)=>{
      let g=bins.get(r);if(!g){g=new Map();for(const [u,v] of res.local){const k=Math.floor(u/r)+','+Math.floor(v/r);(g.get(k)||g.set(k,[]).get(k)).push(u,v);}bins.set(r,g);}
      const px=x0+x*right.dot(t1)+y*up.dot(t1),py=y0+x*right.dot(t2)+y*up.dot(t2),cx=Math.floor(px/r),cy=Math.floor(py/r);
      for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const c=g.get((cx+i)+','+(cy+j));if(c)for(let k=0;k<c.length;k+=2)if((c[k]-px)**2+(c[k+1]-py)**2<=r*r)return true;}
      return false;}};
}
function fitQuadric(P,idx,center,eye){
  const m=idx.length;let cx=0,cy=0,cz=0;for(const i of idx){cx+=P[3*i];cy+=P[3*i+1];cz+=P[3*i+2];}cx/=m;cy/=m;cz/=m;
  const C=[[0,0,0],[0,0,0],[0,0,0]];
  for(const i of idx){const d0=P[3*i]-cx,d1=P[3*i+1]-cy,d2=P[3*i+2]-cz;C[0][0]+=d0*d0;C[0][1]+=d0*d1;C[0][2]+=d0*d2;C[1][1]+=d1*d1;C[1][2]+=d1*d2;C[2][2]+=d2*d2;}
  C[1][0]=C[0][1];C[2][0]=C[0][2];C[2][1]=C[1][2];
  const c=new THREE.Vector3(cx,cy,cz),{values,vectors}=eigenSym3(C),k=values.indexOf(Math.min(...values));
  const n=new THREE.Vector3(...vectors.map(r=>r[k])).normalize();if(n.dot(eye.clone().sub(c))<0)n.negate();
  const t1=new THREE.Vector3().crossVectors(Math.abs(n.y)<.9?UP:new THREE.Vector3(1,0,0),n).normalize(),t2=n.clone().cross(t1);
  const loc=(i,o)=>{const d0=P[3*i]-cx,d1=P[3*i+1]-cy,d2=P[3*i+2]-cz;o[0]=d0*t1.x+d1*t1.y+d2*t1.z;o[1]=d0*t2.x+d1*t2.y+d2*t2.z;o[2]=d0*n.x+d1*n.y+d2*n.z;return o;};
  const local=idx.map(i=>loc(i,[0,0,0]));
  const coef=leastSquares(local.map(([x,y])=>[x*x,x*y,y*y,x,y,1]),local.map(l=>l[2]));if(!coef)return null;
  const quad=(x,y)=>coef[0]*x*x+coef[1]*x*y+coef[2]*y*y+coef[3]*x+coef[4]*y+coef[5];
  const rms=Math.sqrt(local.reduce((s,[x,y,z])=>s+(z-quad(x,y))**2,0)/local.length);
  const dc=center.clone().sub(c),tmp=[0,0,0];
  return {c,n,t1,t2,coef,quad,rms,local,x0:dc.dot(t1),y0:dc.dot(t2),count:m,residualAt:(P,i)=>{loc(i,tmp);return tmp[2]-quad(tmp[0],tmp[1]);}};
}
function quarticRms(local){
  const sc=Math.max(...local.map(([x,y])=>Math.max(Math.abs(x),Math.abs(y))))||1,terms=(x,y)=>{const u=x/sc,v=y/sc,o=[];for(let i=0;i<=4;i++)for(let j=0;i+j<=4;j++)o.push(u**i*v**j);return o;};
  const T=local.map(([x,y])=>terms(x,y)),c4=leastSquares(T,local.map(l=>l[2]));if(!c4)return null;
  return Math.sqrt(local.reduce((s,[,,z],k)=>s+(z-T[k].reduce((t,v,i)=>t+v*c4[i],0))**2,0)/local.length);
}
// Plane, curved or rough, for text of w × h metres along `right` × `up`:
//   rough  — the surface under the centre does not cover the text (it would hang over an edge or onto another object), the quadric
//            fits it badly (rms), or a quartic fits clearly better (excess);
//   curved — it bends more than flatSag across the text, with a radius of curvature under maxCurvedRadius (bottles, kettles, columns,
//            sofa arms: the curves worth following indoors; a gentle bend of metres is a flat surface measured with error), and less
//            than maxSagRatio of the text width (more would wrap the text out of sight: rough);
//   plane  — otherwise.
// The sag is the curvature part only (the tilt is already in the fitted normal), measured from its own mean over the footprint.
export const SURFACE={flatSag:.006,maxCurvedRadius:1.5,maxRms:.02,maxExcess:.003,maxSagRatio:.12,minCover:.85};
export function classify(fit,right,up,w,h){
  const grid=[];for(let i=0;i<=6;i++)for(let j=0;j<=4;j++)grid.push([(i/6-.5)*w,(j/4-.5)*h]);
  fit.cover=grid.filter(([x,y])=>fit.covered(right,up,x,y,.75*w/6)).length/grid.length;
  if(fit.cover<SURFACE.minCover||fit.rms>SURFACE.maxRms||fit.excess>SURFACE.maxExcess)return 'rough';
  const vals=grid.map(([x,y])=>fit.bend(right,up,x,y));
  const mean=vals.reduce((s,v)=>s+v,0)/vals.length,sag=Math.max(...vals.map(v=>Math.abs(v-mean)));
  // Principal curvatures of the quadric: twice the eigenvalues of its quadratic form [[a, b/2], [b/2, c]] (slopes are small there).
  const [a,b,c]=fit.coef,m=(a+c)/2,d=Math.sqrt(((a-c)/2)**2+b*b/4),kmax=2*Math.max(Math.abs(m+d),Math.abs(m-d));
  fit.sag=sag;fit.curveRadius=kmax>0?1/kmax:Infinity;
  if(sag<SURFACE.flatSag||fit.curveRadius>=SURFACE.maxCurvedRadius)return 'plane';
  return sag<SURFACE.maxSagRatio*w?'curved':'rough';
}
// Jacobi eigen decomposition of a symmetric 3×3 matrix (columns of `vectors` are the eigenvectors).
function eigenSym3(A){
  const a=A.map(r=>r.slice()),v=[[1,0,0],[0,1,0],[0,0,1]];
  for(let sweep=0;sweep<30;sweep++){
    let off=0;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)off+=a[i][j]*a[i][j];if(off<1e-20)break;
    for(let p=0;p<3;p++)for(let q=p+1;q<3;q++){
      if(Math.abs(a[p][q])<1e-30)continue;
      const th=(a[q][q]-a[p][p])/(2*a[p][q]),t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)),cs=1/Math.sqrt(t*t+1),sn=t*cs;
      for(let k=0;k<3;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=cs*akp-sn*akq;a[k][q]=sn*akp+cs*akq;}
      for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=cs*apk-sn*aqk;a[q][k]=sn*apk+cs*aqk;}
      for(let k=0;k<3;k++){const vkp=v[k][p],vkq=v[k][q];v[k][p]=cs*vkp-sn*vkq;v[k][q]=sn*vkp+cs*vkq;}
    }
  }
  return {values:[a[0][0],a[1][1],a[2][2]],vectors:v};
}
// Least squares via the normal equations (small, well-conditioned after centring), Gaussian elimination with partial pivoting.
function leastSquares(rows,b){
  const m=rows[0].length,M=Array.from({length:m},()=>new Array(m+1).fill(0));
  rows.forEach((r,k)=>{for(let i=0;i<m;i++){for(let j=0;j<m;j++)M[i][j]+=r[i]*r[j];M[i][m]+=r[i]*b[k];}});
  for(let i=0;i<m;i++)M[i][i]+=1e-9;
  for(let i=0;i<m;i++){let p=i;for(let r=i+1;r<m;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;[M[i],M[p]]=[M[p],M[i]];if(Math.abs(M[i][i])<1e-12)return null;
    for(let r=0;r<m;r++)if(r!==i){const f=M[r][i]/M[i][i];for(let c=i;c<=m;c++)M[r][c]-=f*M[i][c];}}
  return M.map((r,i)=>r[m]/r[i]);
}
// Upright (gravity-aligned) and turned to face the user. Also the fallback without depth or room mesh, 1 m ahead.
function facing(position,eye,width,viewQuaternion){
  if(viewQuaternion){const n=eye.clone().sub(position).normalize(),{right,up}=readableSurfaceBasis(n,viewQuaternion);return {position,quaternion:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,n)),width};}
  return {position,quaternion:new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(eye.x-position.x,eye.z-position.z)),width};
}
// Recorded-view optimization is constrained to real surfaces. It may search nearby
// surfaces or vary size / a small normal lift. Optional view fallback is applied only after this search fails.
// A noisy scan of a laptop lid still represents a broad usable support. Fit a
// dominant plane and a robust inlier extent, rather than following every ridge.
export function smoothScanTarget(fit,id){
 if(!fit||fit.rms>.045||fit.excess>.012||fit.local.length<50)return null;
 const range=k=>{const v=fit.local.map(p=>p[k]).sort((a,b)=>a-b);return [v[Math.floor(v.length*.05)],v[Math.floor(v.length*.95)]];};
 const [x0,x1]=range(0),[y0,y1]=range(1),width=x1-x0,height=y1-y0;
 if(Math.min(width,height)<.12)return null;
 const bend=Math.max(Math.abs(fit.coef[0]*width*width/4),Math.abs(fit.coef[1]*width*height/4),Math.abs(fit.coef[2]*height*height/4));
 if(bend>.06)return null;
 const origin=fit.c.clone().addScaledVector(fit.t1,(x0+x1)/2).addScaledVector(fit.t2,(y0+y1)/2);
 return {id,origin,n:fit.normal.clone(),right:fit.t1.clone(),up:fit.t2.clone(),width,height,surface:'scan',source:'smoothed-scan'};
}
async function centralScanPlacement(response,ctx,basis){
 const camera=ctx.frameCamera(response.frame),aspect=response.aspect||.45;
 for(const [u,v] of [[.5,.5],[.5,.65]]){
  const hit=await ctx.surfaceAt?.(response.frame,u,v);if(!hit?.normal||hit.source==='plane'||hit.normal.y<.6)continue;
  const b=basis(hit.normal,camera.quaternion,hit.point,camera.position),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.right,b.up,hit.normal));
  const width=viewSizedWidth(hit.point,q,camera,ctx.viewport(),response.textMetrics,aspect);
  const points=await ctx.surfacePatch?.(response.frame,u,v,Math.min(.8,width*.7),hit);if(!points)continue;
  const fit=fitSurface(points,hit.point,camera.position),target=smoothScanTarget(fit,`scan:${response.frame}:${u}:${v}`);if(!target)continue;
  const pose=await staticTextPlacement(response,{...ctx,getStaticSurfaces:()=>[target]},basis);if(pose)return pose;
 }
 return null;
}
async function surfacePlacement(response,ctx){
 const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45,eye=camera.position;
 const viewQ=camera.getWorldQuaternion(new THREE.Quaternion());
 // A world anchor survives noisy depth and small view changes. Only sustained
 // readability/visibility loss releases it; acquisition and retention differ.
 const previous=response.previousPose,state=response.anchorState||{},stability=ctx.getSettings?.(response)?.stability??0;
 let retained=null;
 const now=ctx.frames?.[response.frame]?.t??response.frame/30;
 if(state.lastTime!=null&&(now<state.lastTime||now-state.lastTime>1))state.badSince=null;
 state.lastTime=now;
 if(previous?.surfaceAnchor&&!previous.unreadable){
  const centered=centeredPose(previous,aspect),metrics=textViewMetrics(centered,camera,viewport,response.textMetrics);
  const view=placementVisibility(centered,camera);
  const visibility=ctx.visible?visibleFraction(await ctx.visible(response.frame,footprintPoints(previous,aspect,8,4),{staticSurface:previous.source==='parametric-layout'})):1;
  const layoutStillExists=!!previous.supportTarget||!previous.surfaceId||!ctx.getStaticSurfaces||ctx.getStaticSurfaces().some(t=>t.id===previous.surfaceId&&Math.abs(previous.surfaceAnchor.clone().sub(t.origin).dot(t.n))<.06&&surfaceSupports(t,previous,aspect));
  const quality=await ctx.getSurfaceQuality?.(response.frame),currentQuality=quality?.(previous,aspect);
  const crowded=currentQuality&&currentQuality.cost>1.25;
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(previous.quaternion),desired=readableSurfaceBasis(normal,viewQ,previous.position,eye,camera);
  const oldUp=new THREE.Vector3(0,1,0).applyQuaternion(previous.quaternion),aligned=oldUp.angleTo(desired.up)<Math.PI/60;
  const readable=metrics.minPx>=TEXT_VIEW.minPx*.8&&metrics.maxPx<=TEXT_VIEW.maxPx*1.4&&view.coverage>=.8;
  if(readable&&visibility>=.8&&layoutStillExists)retained={...previous,reusedSurface:true};
  if(readable&&visibility>=.8&&layoutStillExists&&!crowded&&aligned){state.badSince=null;return {...previous,reusedSurface:true,viewMetrics:{...metrics,points:undefined,visible:visibility}};}
  state.badSince??=now;
  if(layoutStillExists&&now-state.badSince<Math.max(.8*stability,.8*(readable?0:1)))return {...previous,reusedSurface:true,anchorGrace:true};
 }
 // Revalidation above is cheap and runs every frame. Failed searches are bounded
 // by the caller; never reuse an uncertified pose while waiting for the next search.
 if(response.allowSearch===false)return retained||{position:eye.clone(),quaternion:viewQ,width:.1,align:'center',kind:'unavailable',unreadable:true,reason:'Awaiting surface search'};
 response.onSearch?.();
 // Clutter relocation must not change the size of an already readable panel.
 response={...response,lockWidth:!!retained,sizeReference:retained?textViewMetrics(centeredPose(previous,aspect),camera,viewport,response.textMetrics):null};
 // Same supporting face has first refusal, including a previously smoothed scan.
 if(previous?.surfaceId&&stability>0){
  const targets=[...(ctx.getStaticSurfaces?.()||[]),...(previous.supportTarget?[previous.supportTarget]:[])];
  const same=await staticTextPlacement({...response,onlySurfaceId:previous.surfaceId},{...ctx,getStaticSurfaces:()=>targets},readableSurfaceBasis);
  if(same){
   const quality=await ctx.getSurfaceQuality?.(response.frame),old=quality?.(previous,aspect);
   if(old&&same.surfaceQuality&&old.cost-same.surfaceQuality.cost<.45&&previous.surfaceAnchor){
    const m=textViewMetrics(centeredPose(previous,aspect),camera,viewport,response.textMetrics);
    if(m.readable&&previous.quaternion.angleTo(same.quaternion)<Math.PI/60){state.badSince=null;return {...previous,reusedSurface:true};}
   }
   state.badSince=null;return same;
  }
 }
 const staticPose=await staticTextPlacement(response,ctx,readableSurfaceBasis);
 const projected=staticPose?.position.clone().project(camera);
 if(staticPose&&(staticPose.surfaceQuality?.cost<.65||Math.hypot(projected.x,projected.y)<.2&&!ctx.getSurfaceQuality)){state.badSince=null;return staticPose;}
 const central=await centralScanPlacement(response,ctx,readableSurfaceBasis);
 if(central&&(!staticPose||(central.surfaceQuality?.cost??0)+.25<(staticPose.surfaceQuality?.cost??0))){state.badSince=null;return central;}
 if(staticPose){state.badSince=null;return staticPose;}
 const probes=[[.5,.5],[.35,.5],[.65,.5],[.5,.35],[.5,.65],[.35,.35],[.65,.35],[.35,.65],[.65,.65],[.5,.2],[.2,.3],[.8,.3],[.2,.7],[.8,.7],[.5,.8]];
 let best=null,sliceStart=performance.now();const diagnostics=[];
 for(const [u,v] of probes){
  if(performance.now()-sliceStart>6){await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();}
  const hit=await ctx.surfaceAt?.(response.frame,u,v);if(!hit?.normal||hit.source==='plane')continue;
  let normal=hit.normal.clone().normalize();if(normal.dot(eye.clone().sub(hit.point))<0)normal.negate();
  const basis=readableSurfaceBasis(normal,viewQ,hit.point,eye,camera),quaternion=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(basis.right,basis.up,normal));
  if(normal.dot(eye.clone().sub(hit.point).normalize())<.2)continue;
  const width=viewSizedWidth(hit.point,quaternion,camera,viewport,response.textMetrics,aspect);
  if(!Number.isFinite(width)||width>8)continue;
  const points=await ctx.surfacePatch?.(response.frame,u,v,.65*width,hit),fit=points&&fitSurface(points,hit.point,eye);
  if(!fit||fit.rms>SURFACE.maxRms||fit.excess>SURFACE.maxExcess){diagnostics.push({u,v,reason:'fit',rms:fit?.rms,excess:fit?.excess});continue;}
  normal=fit.normal.clone();const {up,right}=readableSurfaceBasis(normal,viewQ,hit.point,eye,camera);
  const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,normal));
  const wanted=viewSizedWidth(fit.at(0,0),q,camera,viewport,response.textMetrics,aspect);
  for(const fraction of [1,.85]){
   const W=response.lockWidth?previous.width:previous?.surfaceAnchor?THREE.MathUtils.clamp(wanted*fraction,previous.width*.85,previous.width*1.15):wanted*fraction,kind=classify(fit,right,up,W,W*aspect);
   if(kind==='rough'&&fit.sag>SURFACE.maxSagRatio*W)continue;
   const lift=THREE.MathUtils.clamp(.012+2*fit.rms,.012,.04);
   const rect=await freeRect({fit,right,up,n:normal,lift,W,aspect,visible:null});
   if(!rect){diagnostics.push({u,v,reason:'no-rectangle'});continue;}
   if(response.lockWidth&&Math.abs(rect.w-previous.width)>1e-6)continue;
   if(previous?.surfaceAnchor&&rect.w<previous.width*.85-1e-6)continue;
   const {cx,cy,w}=rect,surface=kind==='curved'?(x,y)=>fit.height(right,up,x+cx,y+cy)-fit.height(right,up,cx,cy):null;
   const contact=fit.atText(right,up,cx,cy),pose={position:contact.clone().addScaledVector(normal,lift),quaternion:q,width:w,align:'center',kind:surface?'curved':'plane',surface,surfaceAnchor:contact.clone(),normalLift:lift,probe:[u,v]};
   const m=textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics);
   if(response.sizeReference&&(m.maxPx>response.sizeReference.maxPx*1.15||m.minPx<response.sizeReference.minPx*.85))continue;
   if(!m.readable){diagnostics.push({u,v,reason:'size',min:m.minPx,max:m.maxPx,inView:m.inView});continue;}
   const visible=ctx.visible?await ctx.visible(response.frame,footprintPoints(pose,aspect)):[];
   if(visibleFraction(visible)<.8){diagnostics.push({u,v,reason:'occluded',visible:visible.filter(Boolean).length/visible.length});continue;}
   pose.viewMetrics={...m,points:undefined,visible:visibleFraction(visible)};
   const score=Math.abs(m.minPx-TEXT_VIEW.targetPx)+Math.hypot(u-.5,v-.5)*6;
   if(!best||score<best.score)best={pose,score};
   if(u===.5&&v===.5)return pose;
   break;
  }
  if(best)break;
 }
 return best?.pose||retained||{position:eye.clone(),quaternion:viewQ,width:.1,align:'center',kind:'unavailable',unreadable:true,reason:'No readable visible surface',diagnostics};
}
export async function place(response,ctx,strategy='user-view'){
 if(strategy==='user-view'&&ctx.frameCamera&&ctx.viewport){
  const surface=await surfacePlacement(response,ctx);
  if(!surface.unreadable||!ctx.getSettings?.(response)?.surfaceFallback)return surface;
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45;
  const quaternion=camera.getWorldQuaternion(new THREE.Quaternion());
  const position=new THREE.Vector3(0,0,-1.25).applyMatrix4(camera.matrixWorld);
  const width=viewSizedWidth(position,quaternion,camera,viewport,response.textMetrics,aspect);
  const pose={position,quaternion,width,align:'center',kind:'view-fallback'};
  const metrics=textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics);
  // Do not replace an unavailable surface with an oversized or clipped panel.
  return metrics.readable?{...pose,viewMetrics:{...metrics,points:undefined},reason:surface.reason}:surface;
 }
 return (strategies[strategy]||strategies['user-view'])(response,ctx);
}
