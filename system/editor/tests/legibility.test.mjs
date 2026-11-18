import {test} from 'node:test';import assert from 'node:assert/strict';import {pickStyle,linToOklab,oklabToLin,STYLE} from '../src/legibility.mjs';
// A w × h RGBA background from a per-pixel sRGB function.
function bg(f,w=32,h=16){const p=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [r,g,b]=f(x,y);p.set([r,g,b,255],4*(y*w+x));}return [p,w,h];}
const lin=v=>v<=10?v/255/12.92:((v/255+.055)/1.055)**2.4,lab=c=>linToOklab(c),L=c=>lab(c)[0],C=c=>Math.hypot(lab(c)[1],lab(c)[2]),hue=c=>Math.atan2(lab(c)[2],lab(c)[1])*180/Math.PI;
const apart=(a,b)=>Math.abs(((a-b)%360+540)%360-180); // 0 = same hue, 180 = opposite
test('OKLab round trip',()=>{for(const c of [[.2,.5,.8],[1,1,1],[.01,.3,.02]])oklabToLin(linToOklab(c)).forEach((v,i)=>assert.ok(Math.abs(v-c[i])<1e-4));});
test('dark wood: light text, exactly `need` above the background, no glass',()=>{
  const s=pickStyle(...bg((x,y)=>[70+(x*7%20),45,30]),.02);assert.equal(s.glass,null);assert.equal(s.side,'light');
  assert.ok(Math.abs(s.contrast-s.need)<1e-6,'just enough contrast, no more');assert.ok(C(s.text)<=STYLE.maxC+1e-6);
});
test('white wall: dark text, no glass (a plain background never needs it)',()=>{
  const s=pickStyle(...bg(()=>[236,232,222]),.01);assert.equal(s.glass,null);assert.equal(s.side,'dark');assert.ok(L(s.text)<.6);
  assert.ok(C(s.text)<.02,'near-neutral wall → near-neutral text');
});
test('colour: never more colourful than the surroundings, hue opposite theirs',()=>{
  assert.ok(C(pickStyle(...bg(()=>[60,60,60]),.02).text)<.002,'grey → neutral');
  const wall=[120,50,20],s=pickStyle(...bg(()=>wall),.02);assert.equal(s.glass,null);
  assert.ok(C(s.text)>.03&&C(s.text)<=STYLE.maxC+1e-6,'muted, not neutral');assert.ok(apart(hue(s.text),hue(wall.map(lin)))>150,'opposite hue');
});
test('busy: a fine black/white pattern needs glass; so does a smooth background spanning light and dark',()=>{
  const busy=pickStyle(...bg((x,y)=>((x>>1)+(y>>1))%2?[245,245,245]:[25,25,25]),.3);assert.ok(busy.glass);assert.ok(busy.contrast>=busy.need-1e-6);
  const span=pickStyle(...bg(x=>x<16?[245,245,245]:[20,20,20]),.01);assert.ok(span.glass,'half white, half black');
});
test('glass is tinted with the background\'s hue and changes it as little as legibility allows',()=>{
  const s=pickStyle(...bg((x,y)=>((x>>1)+(y>>1))%2?[250,235,200]:[60,40,20]),.25);assert.ok(s.glass);
  const [,a,b]=lab(s.glass.tint);assert.ok(b>0,'warm background → warm tint');assert.ok(s.glass.mix<.98);
});
test('fast: well under a millisecond-scale budget per answer',()=>{const t=performance.now();for(let i=0;i<50;i++)pickStyle(...bg((x,y)=>[(x*13)%255,(y*29)%255,128]),.1);assert.ok((performance.now()-t)/50<3,`${((performance.now()-t)/50).toFixed(2)} ms`);});
