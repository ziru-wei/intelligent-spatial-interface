// Replaying a typed question (Answer while typing, modos-system-design.md 12): its line on the timeline is played as it happened, on
// the clock of its revisions, not held at its end. e = seconds since the question began (revision.at, a part's created − the
// question's created). The video moves as it moved while the question was typed (each revision's t, in between linearly); when it
// had stopped (paused, or at the recording's end) while the typing and answering went on, it stays on its frame and the replay goes on.
// No dependencies.

/** Whether q is replayed this way: typed (it has revisions) and answered. */
export const isTyped=q=>!!q?.revisions?.length&&q.status==='answered';

/** The replay of q: e0..e1 (from its first revision to its last part, plus reading time), tAt(e) (video time) and eAt(t) (the first
 *  moment the video reached t). parts: q's parts and withdrawn parts ({created, withdrawn_at?, stream?.updates}). duration: the
 *  recording's length (the video goes no further). One clock for all: e, real time; the video, the voice, the words and the parts
 *  are each where they were at e. */
export function typedReplay(q,parts=[],{read_s=q.live?.read_s??5,duration=Infinity}={}){
  // A spoken question knows where the video was when Space went down and when it was let go, and how it went on from there (rate:
  // its speed, 0 paused); between, each revision says where it was. Revisions after the release (the final words) are later than the
  // video they name, so the release stands for them.
  const v=q.audio?.video,end=v?.at_end!=null?{e:v.at_end,t:v.t_end}:null;
  const revs=[...(v?[{e:v.at,t:v.t}]:[]),...(q.clock||q.revisions).map(r=>({e:r.at,t:r.t})).filter(r=>!end||r.e<end.e),...(end?[end]:[])].sort((a,b)=>a.e-b.e),since=at=>at-(q.created??0);
  const rate=end?v.rate||0:0,lastPoint=revs.at(-1);
  const shown=parts.filter(r=>r.question_id===q.id).flatMap(r=>[r.created,r.updated_at,r.withdrawn_at,...(r.stream?.updates||[]).map(u=>u.created)]).filter(Number.isFinite).map(since);
  // a spoken question's recording (q.audio: when it began against the question, how long) is heard whole: the line runs from its
  // first sound to its last, when they lie beyond the first revision and the last part
  const a=q.audio,e0=Math.min(revs[0].e,a?.at??Infinity),last=Math.max(...q.revisions.map(r=>r.at),lastPoint.e,...shown,a?.duration?a.at+a.duration:-Infinity);
  const tAt=e=>{if(e<=revs[0].e)return revs[0].t;for(let i=1;i<revs.length;i++){const a=revs[i-1],b=revs[i];if(e<=b.e)return b.e>a.e?a.t+(b.t-a.t)*(e-a.e)/(b.e-a.e):b.t;}
    return Math.min(duration,lastPoint.t+rate*(e-lastPoint.e));};   // after the last point, on as it went on
  const eAt=t=>{if(t<=revs[0].t)return e0;for(let i=1;i<revs.length;i++){const a=revs[i-1],b=revs[i];if(t<=b.t&&b.t>a.t)return a.e+(b.e-a.e)*(t-a.t)/(b.t-a.t);}
    return rate>0&&t<duration?lastPoint.e+(t-lastPoint.t)/rate:lastPoint.e;};
  const e1=last+read_s;
  return {id:q.id,e0,e1,t0:tAt(e0),t1:Math.max(q.t,tAt(e1)),tAt,eAt};
}
