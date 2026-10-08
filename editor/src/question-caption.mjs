// Replay animation follows the hold clock, so seeking/replaying never uses wall-clock history.
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
export const captionGraphemes=text=>segmenter?[...segmenter.segment(String(text))].map(s=>s.segment):Array.from(String(text));
const LETTERS_PER_SECOND=28;
export function questionTypingDuration(text,reducedMotion=false){
  return reducedMotion?0:Math.max(0,captionGraphemes(text).length-1)/LETTERS_PER_SECOND;
}
// Agent time is negative during replay typing. Recorded latencies start only after the last letter.
export function questionClock(question,elapsed,{live=false,reducedMotion=false,typingDuration=questionTypingDuration(question.text,reducedMotion)}={}){
  const seconds=Math.max(0,elapsed);
  return {h:seconds-(live?0:typingDuration),typingElapsed:seconds,typingDuration:live?0:typingDuration};
}
// Historical questions at the current video frame are not active captions.
export function captionQuestion(questions,clock=null,dismissedId=null){
  const q=clock?questions.find(q=>q.id===clock.id):questions.at(-1);
  if(!q||q.id===dismissedId||q.status==='failed')return null;
  return clock||['queued','running'].includes(q.status)?q:null;
}
export function questionCaption(question,{clock=null,answerVisible=false,reducedMotion=false,elapsed=0}={}){
  const fullText=String(question.text||''),letters=captionGraphemes(fullText);
  const seconds=clock?.h??elapsed,typingElapsed=Math.max(0,clock?.typingElapsed??seconds);
  const typing=clock?.live===false&&!reducedMotion;
  const count=typing?Math.min(letters.length,1+Math.floor(typingElapsed*LETTERS_PER_SECOND+1e-6)):letters.length;
  const arrivals=Object.values(question.parts||{}).map(p=>p.latency).filter(v=>Number.isFinite(v)&&v>=0);
  const firstAt=arrivals.length?Math.min(...arrivals):question.status==='answered'?(clock?.shownAt??question.latency??0):Infinity;
  const waiting=count===letters.length&&seconds>=0&&!answerVisible&&question.status!=='failed'&&(clock?seconds+1e-6<firstAt:['queued','running'].includes(question.status));
  const dotOpacity=waiting?(reducedMotion ? .65 : .35+.65*(.5-.5*Math.cos(seconds*Math.PI))):0;
  return {fullText,text:letters.slice(0,count).join(''),waiting,phase:Math.max(0,seconds),dotOpacity,animated:!reducedMotion&&(waiting||count<letters.length)};
}
