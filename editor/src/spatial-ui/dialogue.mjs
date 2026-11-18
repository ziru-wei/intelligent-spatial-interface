import * as THREE from 'three';

// Object-centric Dialogue (modos-system-design.md 4.4): a text form of the library. When a thing is clearly pointed at and asked in the
// second person, its MOD's answer is written in the first person in a speech bubble on that thing (placed by src/placement.mjs
// bubblePlacement, drawn by src/agent.mjs). The thing itself is not moved, copied or tinted.
// The bubble's outline (src/agent.mjs draws it, filled and stroked, behind the answer's text), in the text plane's metres: a rounded
// box (x0..x1, y0..y1; corner radius r) with a tail whose tip is `tip` ({x, y}), its base (2·baseHalf wide) on the side facing the tip,
// where the line from the box's centre to the tip leaves it, kept clear of the corners. No tail when the tip is null or inside the box.
// Returns the closed outline, counter-clockwise, as THREE.Vector2s.
export function bubbleOutline({x0,x1,y0,y1},r,tip=null,baseHalf=0){
  r=Math.max(0,Math.min(r,(x1-x0)/2,(y1-y0)/2));const cx=(x0+x1)/2,cy=(y0+y1)/2,V=(x,y)=>new THREE.Vector2(x,y);
  let edge=-1,along=0;
  if(tip&&(tip.x<x0||tip.x>x1||tip.y<y0||tip.y>y1)){
    const dx=tip.x-cx,dy=tip.y-cy,tx=dx?((dx>0?x1:x0)-cx)/dx:Infinity,ty=dy?((dy>0?y1:y0)-cy)/dy:Infinity;
    // Edges in outline order: 0 bottom, 1 right, 2 top, 3 left; `along` is the hit point's coordinate along that edge.
    if(tx<ty){edge=dx>0?1:3;along=cy+dy*tx;}else{edge=dy>0?2:0;along=cx+dx*ty;}
  }
  const corner=(x,y,a0)=>{const out=[];for(let k=1;k<4;k++){const a=a0+k*Math.PI/8;out.push(V(x+r*Math.cos(a),y+r*Math.sin(a)));}return out;};
  // Each edge from its start to its end (counter-clockwise), with the tail inserted on the edge that faces the tip.
  const edges=[[V(x0+r,y0),V(x1-r,y0)],[V(x1,y0+r),V(x1,y1-r)],[V(x1-r,y1),V(x0+r,y1)],[V(x0,y1-r),V(x0,y0+r)]];
  const corners=[corner(x1-r,y0+r,-Math.PI/2),corner(x1-r,y1-r,0),corner(x0+r,y1-r,Math.PI/2),corner(x0+r,y0+r,Math.PI)];
  const pts=[];
  edges.forEach(([a,b],i)=>{
    pts.push(a);
    if(i===edge){
      const horizontal=i%2===0,lo=horizontal?Math.min(a.x,b.x):Math.min(a.y,b.y),hi=horizontal?Math.max(a.x,b.x):Math.max(a.y,b.y);
      const h=Math.min(baseHalf,(hi-lo)/2),c=THREE.MathUtils.clamp(along,lo+h,hi-h),dir=horizontal?Math.sign(b.x-a.x):Math.sign(b.y-a.y);
      const at=v=>horizontal?V(v,a.y):V(a.x,v);
      if(h>0)pts.push(at(c-dir*h),V(tip.x,tip.y),at(c+dir*h));
    }
    pts.push(b,...corners[i]);
  });
  return pts;
}

