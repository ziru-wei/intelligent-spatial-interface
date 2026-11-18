import {pickStyle} from './legibility.mjs';
// Causal style selection: solve the current composite before displaying it.
// Retain polarity only while it remains legible without introducing extra backing.
export function createLegibilityTracker(){
 let current=null;
 const clone=s=>s?({...s,text:[...s.text],glass:s.glass?{mix:s.glass.mix,tint:[...s.glass.tint]}:null}):null;
 return {
  reset(){current=null;},
  sample({pixels,w,h},clutter){
   const best=pickStyle(pixels,w,h,clutter);
   const retained=current?pickStyle(pixels,w,h,clutter,current.side):null;
   // Never keep an unsuitable colour and compensate with a panel. A feasible
   // previous polarity is a tie-breaker; contrast and bare text take priority.
   const next=retained&&!retained.glass&&!best.glass?retained:best;
   current={...next,glassAlpha:next.glass?1:0};
   return clone(current);
  },
  value(){return clone(current);}
 };
}
