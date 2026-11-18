// A walking route over the twin for Floor Path (modos-system-design.md 4.4): through rooms (semantic.rooms polygons) and only from one
// room into another through a door (semantic.openings of category Door, or a walk-through Opening). No three.js, so it is tested in node.
// The floor is a grid (0.25 m); a cell is walkable when it is inside a room or in a door's footprint. A step may stay in a room, enter or
// leave a door, or pass from one room into the next, as long as it crosses no wall except inside a door's opening (corridors meet without
// doors; semantic.walls gives each wall's base as the first two points of its outline). The grid path is
// then pulled tight (a corner is kept only where the straight line would leave the walkable floor or cross rooms without a door).

const CELL=.25,DOOR_DEPTH=.45;
const ringOf=r=>{const p=r?.polygon?.[0];return Array.isArray(p?.[0]?.[0])?p[0]:p;};
function inside(x,z,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}

/** The doors a person can walk through: doors and openings at floor level, tall enough. */
export const walkableDoors=(openings=[],rooms=[])=>openings.filter(o=>/^(door|opening)$/i.test(o.category||'')&&(o.size?.[1]??0)>=1.8).map(o=>{
  const a=(o.yaw||0)*Math.PI/180;return {id:o.id,center:o.center,half:(o.size?.[0]??.9)/2,w:[Math.cos(a),-Math.sin(a)],n:[Math.sin(a),Math.cos(a)]};});

/** A router for these rooms and doors: route(from:[x,z], to:[x,z]) → [[x,z,floorY], …] from the user to the target, or null. */
export function createRouter(rooms=[],openings=[],walls=[]){
  const ws=walls.map(w=>w.outline?.slice(0,2).map(p=>[p[0],p[2]])).filter(w=>w?.length===2);
  const rs=rooms.map(r=>({id:r.id,ring:ringOf(r),floorY:r.floorY??0})).filter(r=>r.ring?.length>2),doors=walkableDoors(openings);
  if(!rs.length)return {route:()=>null,regionAt:()=>null};
  const xs=rs.flatMap(r=>r.ring.map(p=>p[0])),zs=rs.flatMap(r=>r.ring.map(p=>p[1]));
  const x0=Math.min(...xs)-1,z0=Math.min(...zs)-1,nx=Math.ceil((Math.max(...xs)+1-x0)/CELL),nz=Math.ceil((Math.max(...zs)+1-z0)/CELL);
  // region of each cell: -1 blocked, a room index, or `rs.length + door index` for a door's footprint (doors win over rooms)
  const region=new Int32Array(nx*nz).fill(-1);
  const at=(x,z)=>{for(let d=0;d<doors.length;d++){const o=doors[d],dx=x-o.center[0],dz=z-o.center[2];
      if(Math.abs(dx*o.w[0]+dz*o.w[1])<=o.half&&Math.abs(dx*o.n[0]+dz*o.n[1])<=DOOR_DEPTH)return rs.length+d;}
    for(let k=0;k<rs.length;k++)if(inside(x,z,rs[k].ring))return k;return -1;};
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)region[i*nz+j]=at(x0+(i+.5)*CELL,z0+(j+.5)*CELL);
  const cellOf=(x,z)=>[Math.floor((x-x0)/CELL),Math.floor((z-z0)/CELL)],ok=(i,j)=>i>=0&&j>=0&&i<nx&&j<nz&&region[i*nz+j]>=0;
  const isDoor=g=>g>=rs.length;
  // a step crosses a wall unless it crosses it inside a door's opening
  const inDoor=([x,z])=>doors.some(o=>{const dx=x-o.center[0],dz=z-o.center[2];return Math.abs(dx*o.w[0]+dz*o.w[1])<=o.half&&Math.abs(dx*o.n[0]+dz*o.n[1])<=.3;});
  const cross=(p,q)=>ws.some(([a,b])=>{const d=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]),d1=d(a,b,p),d2=d(a,b,q);
    if(!(d1*d2<0&&d(p,q,a)*d(p,q,b)<0))return false;const f=d1/(d1-d2);return !inDoor([p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f]);});
  const centre=(i,j)=>[x0+(i+.5)*CELL,z0+(j+.5)*CELL];
  // the walkable cell nearest a point (the user may stand a little outside the scanned floor, a target sits on furniture)
  function nearest(x,z){const [ci,cj]=cellOf(x,z);if(ok(ci,cj))return [ci,cj];
    for(let r=1;r<16;r++){let best=null,bd=1e9;for(let i=ci-r;i<=ci+r;i++)for(let j=cj-r;j<=cj+r;j++){if(Math.max(Math.abs(i-ci),Math.abs(j-cj))!==r||!ok(i,j))continue;
      const [px,pz]=centre(i,j),d=(px-x)**2+(pz-z)**2;if(d<bd){bd=d;best=[i,j];}}if(best)return best;}
    return null;}
  // whether the straight line a→b stays on walkable floor and crosses no wall outside a door
  function clear(a,b){if(cross(a,b))return false;const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(CELL/3));
    for(let s=0;s<=n;s++)if(!ok(...cellOf(a[0]+(b[0]-a[0])*s/n,a[1]+(b[1]-a[1])*s/n)))return false;
    return true;}
  function route(from,to){
    const s=nearest(from[0],from[1]),t=nearest(to[0],to[1]);if(!s||!t)return null;
    const N=nx*nz,key=(i,j)=>i*nz+j,g=new Float64Array(N).fill(Infinity),came=new Int32Array(N).fill(-1),closed=new Uint8Array(N);
    const h=(i,j)=>Math.hypot(i-t[0],j-t[1]),open=[[h(...s),key(...s)]];g[key(...s)]=0;
    const D=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]];
    while(open.length){
      let bi=0;for(let k=1;k<open.length;k++)if(open[k][0]<open[bi][0])bi=k;const [,u]=open[bi];open[bi]=open[open.length-1];open.pop();
      if(closed[u])continue;closed[u]=1;const ui=Math.floor(u/nz),uj=u%nz;if(ui===t[0]&&uj===t[1])break;
      for(const [di,dj,c] of D){const vi=ui+di,vj=uj+dj;if(!ok(vi,vj))continue;
        if(di&&dj&&(!ok(ui+di,uj)||!ok(ui,uj+dj)))continue;   // no cutting corners
        if(cross(centre(ui,uj),centre(vi,vj)))continue;const v=key(vi,vj),ng=g[u]+c;if(ng<g[v]){g[v]=ng;came[v]=u;open.push([ng+h(vi,vj),v]);}}
    }
    const goal=key(...t);if(g[goal]===Infinity)return null;
    const cells=[];for(let v=goal;v>=0;v=came[v])cells.unshift(centre(Math.floor(v/nz),v%nz));
    cells[0]=[from[0],from[1]];if(ok(...cellOf(to[0],to[1])))cells[cells.length-1]=[to[0],to[1]];
    // pull tight
    const out=[cells[0]];let i=0;
    while(i<cells.length-1){let j=cells.length-1;while(j>i+1&&!clear(cells[i],cells[j]))j--;out.push(cells[j]);i=j;}
    return out.map(([x,z])=>[x,z,floorAt(x,z)]);
  }
  // the floor height under a point: its room's (a door: the nearer room's)
  function floorAt(x,z){const k=rs.findIndex(r=>inside(x,z,r.ring));if(k>=0)return rs[k].floorY;
    let best=rs[0],bd=1e9;for(const r of rs)for(const p of r.ring){const d=(p[0]-x)**2+(p[1]-z)**2;if(d<bd){bd=d;best=r;}}return best.floorY;}
  return {route,regionAt:(x,z)=>{const [i,j]=cellOf(x,z);if(!ok(i,j))return null;const g=region[i*nz+j];return isDoor(g)?{door:doors[g-rs.length].id}:{room:rs[g].id};}};
}

/** Points every `spacing` metres along a polyline, starting `skip` metres in: [[x,z,floorY,yaw], …]. */
export function along(points,{spacing=.4,skip=.6,max=Infinity}={}){
  const out=[];let travelled=0,next=skip;
  for(let k=0;k+1<points.length;k++){
    const [ax,az,ay]=points[k],[bx,bz,by]=points[k+1],len=Math.hypot(bx-ax,bz-az);if(!len)continue;const yaw=Math.atan2(bx-ax,bz-az);
    while(next<=travelled+len&&next<=max){const f=(next-travelled)/len;out.push([ax+(bx-ax)*f,az+(bz-az)*f,f<.5?ay:by,yaw]);next+=spacing;}
    travelled+=len;
  }
  return out;
}
