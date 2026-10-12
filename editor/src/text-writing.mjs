// Writing effect for answer text: characters appear one after another at a set pace (chars per second), whatever chunks the model streams
// them in (Gemini sends an answer in a few large bursts, much faster than it can be read). With `strokes`, each character is drawn as if
// by a pen: for the hand-lettered info font (Mansalva, assets/fonts), a round pen traces the glyph's contours in the font's order and the
// stroke then fills in; for other fonts (the system font has no outlines the page can read) and characters Mansalva lacks (CJK), a soft
// wipe left to right. Without `strokes`, each character just appears.
// The outlines come from HarfBuzz (harfbuzzjs, WebAssembly), the shaper the browser itself uses: Mansalva swaps in contextual alternates
// (calt) for many letters, so the glyph a character really got depends on its neighbours; shaping each line the same way gives the very
// glyphs the canvas drew.
//
// The answer's texture canvas (src/agent.mjs glowTexture) carries `ink`: {lines: [{text, font, size, x, y (top)}], glow: [[blur, colour]]};
// drawWritten(canvas, n) redraws that canvas with the first n characters (fractional: the current one partly drawn) and returns how many
// there are in all. Spaces take no time.
const FONT_URL=new URL('../assets/fonts/Mansalva-Regular.ttf',import.meta.url);
let shaper=null,shaperLoading=null;
export function loadOutlines(){
  return shaperLoading??=Promise.all([import('harfbuzzjs'),fetch(FONT_URL).then(r=>{if(!r.ok)throw Error(r.statusText);return r.arrayBuffer();})])
    .then(([hb,data])=>{const face=new hb.Face(new hb.Blob(data));shaper={hb,font:new hb.Font(face),upem:face.upem};})
    .catch(e=>console.warn('Mansalva outlines',e));
}
export const outlinesReady=()=>!!shaper;
const PEN=.075,FILL_FROM=.85,STEPS=8;   // pen width (em: about half a Mansalva stroke, so tracing both sides of a stroke fills it); share of a character's time spent tracing before its shape fills in

// Glyph outline commands (font units, y up) placed at (x, baseline) and scaled to size px: a Path2D and contours of points with running
// lengths ({pts: [[x, y]], len: [..]}).
function outline(commands,x,baseline,scale){
  const path=new Path2D(),out=[];let cur=null,px=0,py=0,sx=0,sy=0;
  const P=(u,v)=>[x+u*scale,baseline-v*scale];
  const to=(qx,qy)=>{cur.len.push(cur.len.at(-1)+Math.hypot(qx-px,qy-py));cur.pts.push([qx,qy]);px=qx;py=qy;};
  for(const {type,values:v} of commands){
    if(type==='M'){[px,py]=P(v[0],v[1]);[sx,sy]=[px,py];cur={pts:[[px,py]],len:[0]};out.push(cur);path.moveTo(px,py);}
    else if(type==='L'){const [a,b]=P(v[0],v[1]);path.lineTo(a,b);to(a,b);}
    else if(type==='Q'){const [cx,cy]=P(v[0],v[1]),[ex,ey]=P(v[2],v[3]),x0=px,y0=py;path.quadraticCurveTo(cx,cy,ex,ey);
      for(let i=1;i<=STEPS;i++){const t=i/STEPS,u=1-t;to(u*u*x0+2*u*t*cx+t*t*ex,u*u*y0+2*u*t*cy+t*t*ey);}}
    else if(type==='C'){const [c1x,c1y]=P(v[0],v[1]),[c2x,c2y]=P(v[2],v[3]),[ex,ey]=P(v[4],v[5]),x0=px,y0=py;path.bezierCurveTo(c1x,c1y,c2x,c2y,ex,ey);
      for(let i=1;i<=STEPS;i++){const t=i/STEPS,u=1-t;to(u*u*u*x0+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*ex,u*u*u*y0+3*u*u*t*c1y+3*u*t*t*c2y+t*t*t*ey);}}
    else if(type==='Z'&&cur){path.closePath();to(sx,sy);}
  }
  return {path,strokes:out.filter(c=>c.pts.length>1)};
}
// Every character to write, in reading order: {x, top, w, h, size, path?: Path2D, strokes?: contours, length?}. A character is a shaping
// cluster (a ligature's letters are written as one); x from the canvas's own measure (true also beside fallback-font runs).
function glyphs(ctx,ink){
  const out=[];
  for(const l of ink.lines){
    ctx.font=l.font;ctx.textBaseline='top';const topAscent=ctx.measureText('H').actualBoundingBoxAscent;
    ctx.textBaseline='alphabetic';const baseline=l.y+ctx.measureText('H').actualBoundingBoxAscent-topAscent;ctx.textBaseline='top';
    // Shaped clusters of the line: start index → glyphs with their offsets from the cluster's pen position (font units).
    const clusters=new Map();
    // Word by word, as the browser shapes (Blink's word shape cache): alternates depend on neighbours within a word only.
    if(shaper&&/Mansalva/.test(l.font))for(const m of l.text.matchAll(/\S+/g)){const {hb,font}=shaper,buffer=new hb.Buffer();buffer.addText(m[0]);buffer.guessSegmentProperties();hb.shape(font,buffer);
      const infos=buffer.getGlyphInfos(),pos=buffer.getGlyphPositions();let pen=0;
      infos.forEach((g,i)=>{const at=m.index+g.cluster;let c=clusters.get(at);if(!c){c={pen,glyphs:[]};clusters.set(at,c);}
        c.glyphs.push({id:g.codepoint,dx:pen-c.pen+pos[i].xOffset,dy:pos[i].yOffset});pen+=pos[i].xAdvance;});}
    const starts=[...clusters.keys()].sort((a,b)=>a-b);
    const units=clusters.size?starts.map((s,i)=>[s,l.text.slice(s,starts[i+1]??l.text.length).trimEnd()]):[...new Intl.Segmenter().segment(l.text)].map(g=>[g.index,g.segment]);
    for(const [index,ch] of units){
      if(!ch.trim())continue;
      const x=l.x+ctx.measureText(l.text.slice(0,index)).width,w=ctx.measureText(ch).width,g={x,top:l.y-l.size*.15,w,h:l.size*1.45,size:l.size};
      const c=clusters.get(index);
      if(c&&c.glyphs.every(q=>q.id>0)){const scale=l.size/shaper.upem,path=new Path2D(),strokes=[];
        for(const q of c.glyphs){const o=outline(shaper.font.glyphToJson(q.id),x+q.dx*scale,baseline-q.dy*scale,scale);path.addPath(o.path);strokes.push(...o.strokes);}
        Object.assign(g,{path,strokes,length:strokes.reduce((s,c)=>s+c.len.at(-1),0)});}
      out.push(g);
    }
  }
  return out;
}
// The first `upTo` of a glyph's outline length, as a polyline path.
function traced(g,upTo){
  const p=new Path2D();let left=upTo;
  for(const c of g.strokes){if(left<=0)break;const total=c.len.at(-1);p.moveTo(...c.pts[0]);
    for(let i=1;i<c.pts.length;i++){if(c.len[i]<=left){p.lineTo(...c.pts[i]);continue;}
      const [ax,ay]=c.pts[i-1],[bx,by]=c.pts[i],t=(left-c.len[i-1])/Math.max(1e-6,c.len[i]-c.len[i-1]);p.lineTo(ax+(bx-ax)*t,ay+(by-ay)*t);break;}
    left-=total;}
  return p;
}
function cache(canvas){
  const ink=canvas.ink;let c=canvas.writing;
  if(c&&c.outlines===!!shaper)return c;
  const full=new OffscreenCanvas(canvas.width,canvas.height),fx=full.getContext('2d');fx.fillStyle='#ffffff';fx.textBaseline='top';
  for(const l of ink.lines){fx.font=l.font;if(l.bullet)fx.fillText('·',l.bulletX,l.y);fx.fillText(l.text,l.x,l.y);}
  const mask=new OffscreenCanvas(canvas.width,canvas.height);
  // A bullet is written with its line's first character.
  const list=glyphs(mask.getContext('2d'),ink);
  return canvas.writing={outlines:!!shaper,full,mask,glyphs:list};
}
/** Redraws the texture canvas with n characters written; returns the number of characters. strokes: pen-drawn (else each just appears). */
export function drawWritten(canvas,n,{strokes=true}={}){
  if(!canvas.ink)return 0;
  const c=cache(canvas),m=c.mask.getContext('2d'),ctx=canvas.getContext('2d'),done=Math.floor(n),p=n-done;
  m.globalCompositeOperation='source-over';m.clearRect(0,0,c.mask.width,c.mask.height);m.fillStyle=m.strokeStyle='#fff';m.lineCap=m.lineJoin='round';
  const whole=g=>{if(g.path){m.lineWidth=g.size*.08;m.fill(g.path);m.stroke(g.path);}else m.fillRect(g.x-g.size*.06,g.top,g.w+g.size*.12,g.h);};
  for(let i=0;i<Math.min(done,c.glyphs.length);i++)whole(c.glyphs[i]);
  const g=c.glyphs[done];
  if(g&&p>0&&strokes){
    if(g.path){m.lineWidth=g.size*PEN;m.stroke(traced(g,g.length*Math.min(1,p/FILL_FROM)));
      if(p>FILL_FROM){m.globalAlpha=(p-FILL_FROM)/(1-FILL_FROM);whole(g);m.globalAlpha=1;}}
    else{const x0=g.x-g.size*.06,w=(g.w+g.size*.12)*p,grad=m.createLinearGradient(x0+w-g.size*.12,0,x0+w,0);
      grad.addColorStop(0,'#fff');grad.addColorStop(1,'rgba(255,255,255,0)');m.fillStyle=grad;m.fillRect(x0,g.top,w,g.h);m.fillStyle='#fff';}
  }
  m.globalCompositeOperation='source-in';m.drawImage(c.full,0,0);
  ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const [blur,color] of canvas.ink.glow){ctx.shadowBlur=blur;ctx.shadowColor=color;ctx.drawImage(c.mask,0,0);}
  ctx.restore();
  return c.glyphs.length;
}
/** The number of characters to write in a texture canvas. */
export const writtenLength=canvas=>canvas.ink?cache(canvas).glyphs.length:0;
/** Redraws it complete (as glowTexture drew it). */
export function drawComplete(canvas){if(canvas.ink)drawWritten(canvas,Infinity);}
