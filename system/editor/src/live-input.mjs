// Answer while typing (modos-system-design.md 12): when a question being typed is worth answering again. No model and no punctuation
// rule: a revision goes out each time a word is finished (a space after it) and when the user pauses, a pause being longer than their
// own rhythm: PAUSE_K times the median gap between their recent keystrokes, kept within [PAUSE_MIN, PAUSE_MAX] ms. Whether the intent is
// clear is the decision model's (src/../modos/pipeline.mjs liveChoice), not this module's: it only says when to ask.
//   createBreaks({onRevision(text, pause)}).feed(text)   on every input event; reset() when the question is asked or dropped
export const PAUSE_K=2.5,PAUSE_MIN=180,PAUSE_MAX=1200,RHYTHM=20;

export function createBreaks({onRevision,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let gaps=[],last=null,timer=null,sent=null,sentPause=false;
  const words=t=>t.trim().split(/\s+/).filter(Boolean).join(' ');
  const emit=(text,pause)=>{if(!text||(text===sent&&(pause===sentPause||!pause)))return;sent=text;sentPause=pause;onRevision(text,pause);};
  function pauseAfter(){
    if(!gaps.length)return PAUSE_MAX;
    const s=[...gaps].sort((a,b)=>a-b),median=s[Math.floor(s.length/2)];
    return Math.min(PAUSE_MAX,Math.max(PAUSE_MIN,PAUSE_K*median));
  }
  return {
    feed(text){
      const t=now();if(last!=null){const gap=t-last;if(gap<PAUSE_MAX*2){gaps.push(gap);if(gaps.length>RHYTHM)gaps.shift();}}last=t;
      clearTimer(timer);timer=null;
      const w=words(text);if(!w)return;
      if(/\s$/.test(text))emit(w,false);   // a word finished
      timer=setTimer(()=>{timer=null;emit(w,true);},pauseAfter());
    },
    pauseAfter,
    reset(){clearTimer(timer);timer=null;last=null;sent=null;sentPause=false;},
  };
}
