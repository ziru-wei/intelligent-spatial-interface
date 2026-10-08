// Text colour and backing for glowing text over a video background, computed once from the pixels behind the text (no palette).
// Contrast is OKLab lightness first. Over background lightnesses with 10th / 90th percentiles q10 / q90, text of lightness L has
// worst-case (10th-percentile) contrast L − q90 above the background, or q10 − L below it. So the text colour is solved for:
//   lightness — need beyond the background on the side with more room (light text on dark surroundings, dark text on light ones):
//               L = q90 + need or q10 − need. Exactly enough contrast, so no more prominent than legibility requires;
//   hue       — opposite the background's mean hue (most colour contrast for the chroma);
//   chroma    — the background's median chroma, at most MAX_C: never more colourful than the surroundings (neutral on neutral).
// The glow halo takes the same colour (a soft shadow when the text is dark). When neither side has room — the background spans
// light and dark, or is busy enough (clutter raises `need`) — a frosted-glass backing is added: the video blurred and mixed with a
// tint of the background's own hue. Its mix m and lightness are solved for the least change to the scene (smallest m, tint as
// close to the background's mean lightness as allowed) that leaves room; then the text colour is solved again on the glass.
// sRGB 0..1 <-> linear, linear RGB <-> OKLab (Björn Ottosson).
const toLin=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4,toSrgb=c=>c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055;
export function linToOklab([r,g,b]){
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
export function oklabToLin([L,a,b]){
  const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(v=>Math.min(1,Math.max(0,v)));
}
export const STYLE={need:.36,clutterWeight:1.6,glassClutter:.25,Lmin:.12,Lmax:.97,maxC:.07,percentile:.1};
const quantile=(v,q)=>v[Math.min(v.length-1,Math.max(0,Math.floor(q*v.length)))];
// Statistics of a background (OKLab pixels): lightness quantiles, mean, median chroma.
function stats(lab){
  const n=lab.length,L=Float32Array.from(lab,p=>p[0]).sort(),C=Float32Array.from(lab,p=>Math.hypot(p[1],p[2])).sort();
  const mean=lab.reduce((s,p)=>[s[0]+p[0]/n,s[1]+p[1]/n,s[2]+p[2]/n],[0,0,0]);
  return {q10:quantile(L,STYLE.percentile),q90:quantile(L,1-STYLE.percentile),mean,medianC:quantile(C,.5)};
}
// Room for text on each side: how far past `need` the text can still go within [Lmin, Lmax].
const room=(st,need)=>({light:STYLE.Lmax-(st.q90+need),dark:(st.q10-need)-STYLE.Lmin});
// The text colour for background statistics, or null when neither side has room.
function solveText(st,need,preferredSide=null){
  const r=room(st,need),side=preferredSide||(r.light>=r.dark?'light':'dark');if(r[side]<0)return null;
  const L=side==='light'?st.q90+need:st.q10-need,ab=Math.hypot(st.mean[1],st.mean[2]);
  let C=Math.min(STYLE.maxC,st.medianC);const dir=ab>1e-4?[-st.mean[1]/ab,-st.mean[2]/ab]:[0,0];
  // Keep it in the sRGB gamut at that lightness (halve the chroma until it fits).
  for(let k=0;k<8&&!inGamut([L,C*dir[0],C*dir[1]]);k++)C/=2;
  return {lab:[L,C*dir[0],C*dir[1]],side,contrast:side==='light'?L-st.q90:st.q10-L};
}
function inGamut(lab){
  const l=(lab[0]+.3963377774*lab[1]+.2158037573*lab[2])**3,m=(lab[0]-.1055613458*lab[1]-.0638541728*lab[2])**3,s=(lab[0]-.0894841775*lab[1]-1.291485548*lab[2])**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].every(v=>v>=-1e-4&&v<=1+1e-4);
}
// pixels: RGBA bytes (sRGB) of the background region, w × h (a 3 × 3 box average stands in for the glass blur). clutter: share of
// strong-edge pixels (0 plain … 0.3 busy). Returns {text (linear RGB 0..1), side, glass: null | {tint (linear RGB), mix},
// contrast, need}.
export function pickStyle(pixels,w,h,clutter=0,preferredSide=null,forceGlass=false){
  const n=w*h,lin=[];for(let i=0;i<n;i++)lin.push([toLin(pixels[4*i]/255),toLin(pixels[4*i+1]/255),toLin(pixels[4*i+2]/255)]);
  const st=stats(lin.map(linToOklab)),need=STYLE.need+STYLE.clutterWeight*clutter,bare=forceGlass?null:solveText(st,need,preferredSide);
  if(bare)return {text:oklabToLin(bare.lab),side:bare.side,glass:null,contrast:bare.contrast,need};
  // Glass. The blur removes most edges (clutter × glassClutter); the mix pulls the background's lightnesses toward the tint's.
  const blur=lin.map((_,i)=>{const x=i%w,y=(i/w)|0,s=[0,0,0];let k=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const p=lin[yy*w+xx];s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];k++;}
    return s.map(v=>v/k);});
  const sb=stats(blur.map(linToOklab)),glassNeed=STYLE.need+STYLE.clutterWeight*STYLE.glassClutter*clutter;
  // For each mix m (fine steps) and side, the tint lightness closest to the mean that leaves room, in closed form (mixing lightness
  // as (1−m)·L + m·Lt); cost m + |Lt − mean L|. Then checked on the actual mix (linear RGB, as the shader does), nudging m up if short.
  let plan=null;
  for(let m=.3;m<=.951;m+=.025){
    const lightMax=(STYLE.Lmax-glassNeed-(1-m)*sb.q90)/m,darkMin=(STYLE.Lmin+glassNeed-(1-m)*sb.q10)/m;
    for(const Lt of preferredSide==='light'?[Math.min(sb.mean[0],lightMax)]:preferredSide==='dark'?[Math.max(sb.mean[0],darkMin)]:[Math.min(sb.mean[0],lightMax),Math.max(sb.mean[0],darkMin)]){
      if(Lt<.05||Lt>.98)continue;const cost=m+Math.abs(Lt-sb.mean[0]);if(!plan||cost<plan.cost)plan={m,Lt,cost};}
  }
  plan||={m:.95,Lt:preferredSide==='light'?.06:preferredSide==='dark'?.94:sb.mean[0]>.5?.9:.15};
  for(let m=plan.m;;m=Math.min(.98,m+.05)){
    const tint=oklabToLin([plan.Lt,sb.mean[1]*.5,sb.mean[2]*.5]),mixed=stats(blur.map(p=>linToOklab(p.map((v,i)=>v*(1-m)+tint[i]*m)))),t=solveText(mixed,glassNeed,preferredSide);
    if(t||m>=.98){const f=t||solveText(mixed,0,preferredSide);return {text:oklabToLin(f.lab),side:f.side,glass:{tint,mix:m},contrast:f.contrast,need:glassNeed};}
  }
}
export const linToSrgb=c=>c.map(toSrgb);
