// ModOS · Themes (design doc 12.21): what the user speaks of, kept across the questions of a conversation. A theme is a need or topic
// (the weekend's weather, the umbrella, a message to Alice), not a run of consecutive words: the sentences that speak of it may be
// apart, and one sentence may speak of two ("send the weather to Alice"). The theme is the identity; its MOD is how it is shown and may
// change (a replace is a theme whose MOD changed).
//   ThemeRouter  for each new or changed sentence, in order (design doc 12.32): call 1, its request type (information, action,
//                stop_prev, none; none changes nothing); call 2, grounding: is it about an earlier request or something new (for a stop,
//                which it stops), how it goes on with the earlier one (asks more, adds a detail, corrects one: a correction alone makes
//                its words decide, `said_last`) or what in the world the new one is about, and which other earlier requests it also uses
//                ("send the weather to Alice": a new theme, the weather's in focus with it). A theme keeps what it is about (the thing
//                looked at, the items found for it), so "where is it?" goes on with the theme it was found for. Call 3: each theme
//                whose words changed has its MODs judged once on all of them. A fill asks again only the selectors whose evidence
//                changed (modos/fill.mjs).
//   Cooling      a theme ends when the user says so, or when it has not been spoken of for COOL.questions questions or COOL.ms.
//   Focus        the theme(s) of what is being said now; the others of the question are background. Steadied (steadyFocus): a new
//                focus is taken once it holds for two revisions, or at a pause or the question's end, so it does not flicker.
// Pure functions over a conversation's theme book: {next, asked, themes: [{id, sentences: [{q, i, text, know, yesNo, how}], about,
// abouts, mods, referent?, items?, key, last_q, last_at, created_q, ended?: {at, why}}]}. The book is kept by the editor's store (scripts/agent_store.py).
import {choose,score} from './decision.mjs';
import {typeQuestions,resolveType,yesnoQuestion,aboutQuestion,resolveAbout,modQuestions,resolveMods,PROMPTS} from './request.mjs';
import {fill,sentenceName} from './prompts.mjs';

export const COOL={questions:3,ms:120000};
export const ROUTES=6;   // the live themes a sentence is offered: the most recently spoken of
const THEME_CHARS=220;
export const normalize=t=>String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();   // the words, not how speech to text cut or cased them
export const emptyBook=()=>({next:1,asked:0,themes:[]});
export const themeText=t=>t.sentences.map(s=>s.text).join(' ');
const clip=t=>t.length>THEME_CHARS?'…'+t.slice(-THEME_CHARS):t;
const clone=x=>JSON.parse(JSON.stringify(x));

/** The book before question q (its own sentences and the themes it began taken out: it may be answered again, revision by revision),
 *  with the themes that cooled meanwhile ended. q: its id; n: its number in the conversation (1, 2, …); now: ms. */
export function bookBefore(book,{q,n,now}){
  const b=clone(book||emptyBook());
  b.themes=b.themes.filter(t=>t.created_q!==q).map(t=>({...t,sentences:t.sentences.filter(s=>s.q!==q)})).filter(t=>t.sentences.length);
  for(const t of b.themes)if(t.ended?.q===q)delete t.ended;
  for(const t of b.themes)if(!t.ended&&(n-t.last_q-1>=COOL.questions||now-t.last_at>=COOL.ms))t.ended={at:now,why:'cooled'};
  b.asked=Math.max(b.asked||0,n-1);
  return b;
}
export const liveThemes=book=>book.themes.filter(t=>!t.ended).sort((a,b)=>b.last_at-a.last_at).slice(0,ROUTES);

/** The sentences to route now: those new or changed since the last revision (cache: [{norm, …}] by position). */
export function changed(cache,sentences){
  return sentences.map((s,i)=>cache[i]?.norm===normalize(s)?-1:i).filter(i=>i>=0);
}

// A theme as the decision model is shown it: its words, and what it is (to be told something, or to have something done; what it is
// about, the thing looked at or the item found for it; the MODs that show it), so a sentence is compared with what each theme is.
const described=(t,mods)=>{const kinds=t.sentences.map(s=>s.know),told=kinds.filter(Boolean).length,names=mods.filter(m=>(t.mods?.[m.id]??0)>=.5).map(m=>m.name);
  const of=[t.referent?.name&&`about ${t.referent.name}`,t.items?.length&&`about ${t.items.map(i=>i.label||i.item_id).join(', ')}`].filter(Boolean);
  return `"${clip(themeText(t))}" (${told*2>=kinds.length?'asks to be told something':'asks to have something done'}${of.length?'; '+of.join('; '):''}${names.length?`; shown by ${names.join(', ')}`:''})`;};
const said=(sentences,i,typing)=>sentenceName(PROMPTS,sentences,i,typing);   // modos/prompts.mjs

/** Call 1: what each sentence idx wants (its request type; modos/request.mjs). */
export function typeCall(sentences,idx,{typing=false}={}){
  return Object.assign({},...idx.map(i=>typeQuestions(said(sentences,i,typing),`s${i}`)));
}
export const resolveTypes=(a,idx)=>Object.fromEntries(idx.map(i=>[i,resolveType(a,`s${i}`)]));

// Call 2, grounding, in one decision call or two (GROUNDING.calls). Only its continuation depends on another of its answers: it is
// asked of a sentence that goes on with an earlier request, and is about that request.
//   1 call   everything at once: the continuation is asked of every sentence, without knowing which request it goes on with (asked
//            generally, "if it goes on with an earlier request, how?"), and set aside for a sentence that is new. One wait for the
//            decision model per revision (about 0.15 to 0.35 s less than two), more questions in it.
//   2 calls  first what it is about (earlier or new, what in the world, what else it uses, yes/no), then the continuation, only of the
//            sentences that go on with an earlier request, each told which one ("how does it go on with 'what's the weather?'").
//            Fewer questions, each better posed; a second wait in a row, on every revision where a sentence goes on with one.
export const GROUNDING={calls:1};

/** Call 2, grounding: what each sentence is about, given its type. 1, an earlier request or something new (for a stop: the one it
 *  stops); 2, how it goes on with the earlier one (asked here only when grounding is one call: `how`), and what in the world it is
 *  about (its context anchor, used whether it is earlier or new); 3, which other earlier requests it also uses. For information, its
 *  yes/no form beside it. */
export function groundCall(view,sentences,idx,themes,mods,types,{typing=false,how=true}={}){
  const q={};
  for(const i of idx){const part=said(sentences,i,typing),t=types[i];
    // the earlier requests: the themes before this call, and the sentences asked about in it before this one (a request just said)
    const before=idx.filter(j=>j<i&&!types[j].none);
    if(themes.length||before.length){
      const E=PROMPTS.earlier_or_new;
      q[`earlier_or_new_s${i}`]=choose(fill(t.stop&&!t.info&&!t.action?E.question_stop:E.question,{sentence:part}),
        {...Object.fromEntries(themes.map(x=>[`t${x.id}`,described(x,mods)])),...Object.fromEntries(before.map(j=>[`s${j}`,fill(E.just_said,{text:sentences[j]})])),new:E.new});
      if(how)q[`continuation_s${i}`]=choose(fill(PROMPTS.continuation.question,{sentence:part}),hows());
      for(const x of themes)q[`also_uses_s${i}_t${x.id}`]=score(fill(PROMPTS.also_uses.question,{sentence:part,theme:described(x,mods)}));}
    Object.assign(q,aboutQuestion(view,part,`s${i}`),t.info?yesnoQuestion(part,`s${i}`):{});
  }
  return q;
}
const hows=()=>{const C=PROMPTS.continuation;return {more:C.more,detail:C.detail,correct:C.correct};};
/** The second grounding call (GROUNDING.calls 2): how each sentence in idx goes on with the earlier request it was found to go on with
 *  (a: the first call's answers). */
export function continuationCall(sentences,idx,a,themes,mods,{typing=false}={}){
  const q={};
  for(const i of idx){const prev=a[`earlier_or_new_s${i}`]?.choice,x=prev?.startsWith('t')?themes.find(t=>`t${t.id}`===prev):null,j=prev?.startsWith('s')?Number(prev.slice(1)):null;
    const C=PROMPTS.continuation,it=x?fill(C.earlier_theme,{theme:described(x,mods)}):fill(C.earlier_said,{text:sentences[j]});
    q[`continuation_s${i}`]=choose(fill(C.question_two_calls,{sentence:said(sentences,i,typing),earlier:it}),hows());}
  return q;
}
/** The sentences a second grounding call asks about: those that go on with an earlier request (not those that only stop one). */
export const continuing=(a,idx,types)=>idx.filter(i=>{const c=a[`earlier_or_new_s${i}`]?.choice,t=types[i];return c&&c!=='new'&&!t.none&&!(t.stop&&!t.info&&!t.action);});

/** Where each sentence goes: the theme it continues (into), or a new one (begins), or the one it stops (ends); with how it goes on
 *  and what it is about in the world (a new one's, or a new anchor for the earlier one: modos/grounding.mjs). none: it changes nothing. p: what the model weighed, for the decision record. */
export function resolveGround(a,idx,themes,types){
  return Object.fromEntries(idx.map(i=>{const t=types[i];
    if(t.none)return [i,{adds:false,type:t,into:[],refs:[],ends:null,know:false,yesNo:false,p:{type:t.p}}];
    // the anchor: an earlier theme, or a sentence just said in this call (it goes where that one goes: `follows`, placed in order)
    const prev=a[`earlier_or_new_s${i}`]?.choice,follows=prev?.startsWith('s')?Number(prev.slice(1)):null,anchor=prev?.startsWith('t')?Number(prev.slice(1)):null,stopOnly=t.stop&&!t.info&&!t.action;
    const on=anchor!=null||follows!=null;
    const refs=themes.filter(x=>x.id!==anchor&&(a[`also_uses_s${i}_t${x.id}`]?.score??0)>=.5).map(x=>x.id);
    const p={type:t.p,prev:a[`earlier_or_new_s${i}`]?.probabilities||null,how:a[`continuation_s${i}`]?.probabilities||null,about:a[`context_anchor_s${i}`]?.probabilities||null,yesno:a[`answer_form_s${i}`]?.score??null,
      refs:Object.fromEntries(themes.map(x=>[x.id,a[`also_uses_s${i}_t${x.id}`]?.score??0]))};
    return [i,{adds:true,type:t,into:stopOnly||anchor==null?[]:[anchor],follows:stopOnly?null:follows,begins:!stopOnly&&!on,ends:t.stop&&anchor!=null?anchor:null,refs,
      know:t.info,yesNo:t.info&&(a[`answer_form_s${i}`]?.score??0)>=.5,how:on&&!stopOnly?a[`continuation_s${i}`]?.choice||null:null,need:resolveAbout(a,`s${i}`),p}];
  }));
}

/** This revision's book: `base` (bookBefore) with question q's sentences placed by their routes (cache[i]: {norm, text, route, newId}).
 *  → {book, touched: the themes q speaks of, in order (not one it stopped), said: the themes its latest sentence went into (not those
 *  it only uses), raw: the themes of its latest sentence that adds, newest: its latest sentence
 *  that wants to be told something ({text, yesNo, themes}), rejudge: themes whose words changed (not a theme its one sentence began)}. */
export function place(base,cache,{q,n,now}){
  const book=clone(base),byId=new Map(book.themes.map(t=>[t.id,t])),touched=[],rejudge=new Set(),went={};let raw=[],said=[],newest=null;
  book.asked=Math.max(book.asked,n);
  const touch=t=>{t.last_q=n;t.last_at=now;if(!touched.includes(t.id))touched.push(t.id);};
  cache.forEach((c,i)=>{
    const r=c.route;if(!r)return;
    if(r.ends!=null&&byId.get(r.ends)&&!byId.get(r.ends).ended)byId.get(r.ends).ended={at:now,why:'said',q};
    let into=(r.follows!=null?went[r.follows]||[]:r.into).filter(id=>byId.has(id)&&!byId.get(id).ended);const refs=(r.refs||[]).filter(id=>byId.has(id)&&!byId.get(id).ended&&!into.includes(id));
    if(!r.adds)return;   // none (a filler, a remark, a repeat): it changes nothing
    for(const id of refs)touch(byId.get(id));   // mentioned: spoken of (in focus with it), its words unchanged
    if(!into.length&&!(r.begins||r.follows!=null&&!went[r.follows]))return;   // it only stopped one
    const s={q,i,text:c.text,know:r.know,yesNo:r.yesNo,how:r.how||null};
    if(!into.length){   // a new theme: what this sentence is about is the theme's; its MODs are judged with the others (call 3)
      const t={id:c.newId,sentences:[s],about:r.need.about,abouts:r.need.abouts,mods:{},key:null,created_q:q,last_q:n,last_at:now};
      book.themes.push(t);byId.set(t.id,t);into=[t.id];touch(t);rejudge.add(t.id);}
    else for(const id of into){const t=byId.get(id);t.sentences.push(s);touch(t);if(normalize(themeText(t))!==t.key)rejudge.add(id);}
    went[i]=into;
    if(r.adds){raw=[...into,...refs];said=[...into];}
    if(r.know)newest={text:c.text,yesNo:r.yesNo,themes:into};
  });
  // a theme the user stopped ("no, I mean next week" after "this week") is no longer one of what this question speaks of
  const live=id=>!byId.get(id)?.ended;
  touched.splice(0,touched.length,...touched.filter(live));raw=raw.filter(live);if(newest)newest={...newest,themes:newest.themes.filter(live)};
  book.next=Math.max(book.next,...book.themes.map(t=>t.id+1));
  book.themes=book.themes.filter(t=>!t.ended||t.ended.at>now-COOL.ms*10).slice(-40);   // ended ones kept a while, for the record
  return {book,touched,raw,said,went,newest,rejudge:[...rejudge]};
}

/** Call 3: the MODs each theme in ids needs, judged once on all its words (given in the state as `requests`). */
export function modCall(book,ids,mods){
  const requests={},questions={};
  for(const id of ids){const t=book.themes.find(x=>x.id===id);requests[`t${id}`]=themeText(t);Object.assign(questions,modQuestions(mods,`t${id}`));}
  return {questions,requests};
}
export function judged(book,a,ids,mods){
  for(const id of ids){const t=book.themes.find(x=>x.id===id);Object.assign(t,{mods:resolveMods(a,mods,`t${id}`),key:normalize(themeText(t))});}
  return book;
}

/** The focus, steadied: prev {ids, pending, count}; raw: the themes of what is said now. A new focus is taken once it holds for two
 *  revisions, or at once on a pause or the question's end (settle), or when there was none. */
export function steadyFocus(prev,raw,{settle=false}={}){
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every(x=>b.includes(x));
  if(!raw.length||same(prev?.ids,raw))return {ids:prev?.ids||raw,pending:null,count:0};
  if(settle||!prev?.ids?.length)return {ids:raw,pending:null,count:0};
  const count=same(prev.pending,raw)?prev.count+1:1;
  return count>=2?{ids:raw,pending:null,count:0}:{ids:prev.ids,pending:raw,count};
}
