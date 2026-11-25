import test from 'node:test';
import assert from 'node:assert/strict';
import {bookBefore,changed,place,steadyFocus,normalize,emptyBook,COOL,liveThemes} from '../modos/themes.mjs';

// a sentence's route as call 2 and its rules give it (modos/themes.mjs resolveGround): a new theme begins when it continues none
const route=(r={})=>({adds:true,into:[],ends:null,know:true,yesNo:false,need:{about:'world',abouts:['world']},...r,begins:r.begins??!(r.into?.length)});
const cache=(...rows)=>rows.map(([text,r,newId])=>({norm:normalize(text),text,route:route(r),newId}));

test('sentences are placed in themes: a new one begins a theme, one about it joins it (apart or not), a filler adds nothing', ()=>{
  const c=cache(["what's the weather",{},1],['This weekend.',{into:[1]},2],['um',{adds:false},3],['send it to Alice',{know:false,need:{about:'user',abouts:['user']}},4],['and the weather on Sunday',{into:[1]},5]);
  const p=place(emptyBook(),c,{q:7,n:1,now:1000});
  assert.deepEqual(p.touched,[1,4]);assert.deepEqual(p.book.themes.map(t=>t.sentences.map(s=>s.text)),[["what's the weather",'This weekend.','and the weather on Sunday'],['send it to Alice']]);
  assert.deepEqual(p.raw,[1]);assert.equal(p.newest.text,'and the weather on Sunday');   // the focus and the text follow what is said now
  assert.deepEqual(p.rejudge,[1,4]);                                                     // new, or its words changed: MODs judged (call 3)
  assert.equal(p.book.themes[1].about,'user');                                           // a new theme is about what its sentence is
});

test('one sentence may speak of two themes; a task wants no text', ()=>{
  const c=cache(["what's the weather",{},1],['send it to Alice',{know:false,need:{about:'user',abouts:['user']}},2],['send the weather to Alice too',{into:[1,2],know:false},3]);
  const p=place(emptyBook(),c,{q:1,n:1,now:0});
  assert.deepEqual(p.raw,[1,2]);assert.equal(p.newest.text,"what's the weather");
});

test('a different request that mentions a theme begins its own, and the mentioned one is in focus with it', ()=>{
  const c=cache(["what's the weather this weekend",{},1],['send it to Alice',{know:false,refs:[1],need:{about:'user',abouts:['user']}},2]);
  const p=place(emptyBook(),c,{q:1,n:1,now:0});
  assert.deepEqual(p.touched,[1,2]);assert.deepEqual(p.raw,[2,1]);
  assert.deepEqual(p.rejudge,[1,2]);   // both new; mentioning the weather does not change its words
  assert.deepEqual(p.book.themes.map(t=>t.sentences.length),[1,1]);
});

test('themes belong to the conversation: a later question returns to one; they cool after 3 questions or 2 minutes, or end when told', ()=>{
  const q1=place(emptyBook(),cache(["what's the weather this weekend",{},1]),{q:1,n:1,now:0}).book;
  let b=bookBefore(q1,{q:2,n:2,now:1000});assert.deepEqual(liveThemes(b).map(t=>t.id),[1]);
  const q2=place(b,cache(['will it rain on Sunday',{into:[1]},2]),{q:2,n:2,now:1000});
  assert.deepEqual(q2.touched,[1]);assert.equal(q2.book.themes.length,1);
  assert.ok(bookBefore(q2.book,{q:6,n:6,now:2000}).themes[0].ended,'not spoken of for 3 questions');
  assert.ok(!bookBefore(q2.book,{q:5,n:5,now:2000}).themes[0].ended);
  assert.ok(bookBefore(q2.book,{q:3,n:3,now:1000+COOL.ms}).themes[0].ended,'or for 2 minutes');
  const told=place(bookBefore(q2.book,{q:3,n:3,now:3000}),cache(['never mind the weather',{ends:1,begins:false},3]),{q:3,n:3,now:3000});
  assert.equal(told.book.themes[0].ended.why,'said');
});

test('a question answered again (revision by revision) starts from the book without its own sentences', ()=>{
  const once=place(emptyBook(),cache(["what's the weather",{},1]),{q:4,n:1,now:0}).book;
  assert.deepEqual(bookBefore(once,{q:4,n:1,now:0}).themes,[]);
  assert.deepEqual(changed(cache(["what's the weather",{},1]),["What's the weather?",'this weekend']),[1]);   // only what is new or changed is asked
});

test('the focus is steadied: a new one is taken once it holds for two revisions, or at a pause', ()=>{
  let f=steadyFocus(null,[1]);assert.deepEqual(f.ids,[1]);
  f=steadyFocus(f,[2]);assert.deepEqual(f.ids,[1]);f=steadyFocus(f,[2]);assert.deepEqual(f.ids,[2]);
  f=steadyFocus(f,[1],{settle:true});assert.deepEqual(f.ids,[1]);
  f=steadyFocus(f,[]);assert.deepEqual(f.ids,[1]);   // a filler keeps it
});

test('a theme the user stops in this question is no longer one of what it speaks of ("forget the weather, what is on my agenda")', ()=>{
  const c=cache(["what's the weather this week",{},1],['forget the weather, what is on my agenda',{ends:1},2]);
  const p=place(emptyBook(),c,{q:1,n:1,now:0});
  assert.deepEqual(p.touched,[2]);assert.deepEqual(p.raw,[2]);assert.equal(p.book.themes[0].ended.why,'said');
});

test('call 1 and 2 decide in order: none ends a sentence there; an earlier theme is joined with how it goes on, or stopped; a new one begins', async()=>{
  const {resolveTypes,resolveGround}=await import('../modos/themes.mjs');
  const themes=[{id:2,sentences:[]}],sc=v=>({score:v});
  // a filler: none, unless another type is clear
  assert.equal(resolveTypes({request_type_none_s0:sc(.9),request_type_information_s0:sc(.3),request_type_action_s0:sc(0),request_type_stop_prev_s0:sc(0)},[0])[0].none,true);
  assert.equal(resolveTypes({request_type_none_s0:sc(.9),request_type_information_s0:sc(.9),request_type_action_s0:sc(0),request_type_stop_prev_s0:sc(0)},[0])[0].none,false);
  const types=t=>resolveTypes({request_type_information_s0:sc(t.info??0),request_type_action_s0:sc(t.action??0),request_type_stop_prev_s0:sc(t.stop??0),request_type_none_s0:sc(0)},[0]);
  const go=(t,a)=>resolveGround(a,[0],themes,types(t))[0];
  const corr=go({info:.9},{earlier_or_new_s0:{choice:'t2'},continuation_s0:{choice:'correct'},answer_form_s0:sc(0)});
  assert.deepEqual([corr.into,corr.how,corr.ends,corr.begins],[[2],'correct',null,false]);   // "no, I mean next week": it goes on, correcting
  const stop=go({stop:.9},{earlier_or_new_s0:{choice:'t2'},continuation_s0:{choice:'more'}});
  assert.deepEqual([stop.into,stop.ends,stop.begins,stop.how],[[],2,false,null]);              // "never mind the weather": it only stops it
  const fresh=go({action:.9},{earlier_or_new_s0:{choice:'new'},context_anchor_s0:{choice:'user'}});
  assert.deepEqual([fresh.into,fresh.begins,fresh.need.about,fresh.know],[[],true,'user',false]);   // a new request, about the user's own
  const none=resolveGround({},[0],themes,resolveTypes({request_type_none_s0:sc(.9),request_type_information_s0:sc(.1)},[0]))[0];assert.equal(none.adds,false);
});

test('a filler changes nothing, whatever it seems to continue ("Alright, um.")', ()=>{
  const c=cache(["what's the weather",{},1],['Alright, um.',{adds:false,into:[1],know:true},2]);
  const p=place(emptyBook(),c,{q:1,n:1,now:0});
  assert.deepEqual(p.book.themes[0].sentences.map(s=>s.text),["what's the weather"]);assert.equal(p.newest.text,"what's the weather");
});

test('a sentence may go on with one just said in the same call; what is said now is where the latest sentence went, not what it uses', ()=>{
  const c=cache(["what's the weather",{},1],['send a message to Alice',{know:false},2],['and mention our hiking plan',{know:false,follows:1,begins:false},3],
    ['should I bring my umbrella today',{refs:[1]},4]);
  const p=place(emptyBook(),c,{q:1,n:1,now:0});
  assert.deepEqual(p.book.themes.map(t=>t.sentences.map(s=>s.text)),[["what's the weather"],['send a message to Alice','and mention our hiking plan'],['should I bring my umbrella today']]);
  assert.deepEqual(p.said,[4]);assert.deepEqual(p.raw,[4,1]);   // the umbrella is said now; the weather it uses is in focus with it
});

test('a sentence that only changed its punctuation, case or fillers is not routed again; another word is', ()=>{
  const prev=cache(["what's the weather this week",'t'],['put the TV on HDMI 1','t']);
  assert.deepEqual(changed(prev,["Um, What's the weather this week.","Put the TV on HDMI 1."]),[]);
  assert.deepEqual(changed(prev,["what's the weather this week","put the TV on HDMI 3"]),[1]);
});

test('the text answers the newest question whose theme was not stopped ("what\'s the weather? … never mind": not the weather)', ()=>{
  const stop={ends:1,begins:false,know:false};
  let p=place(emptyBook(),cache(["what's the weather this weekend",{},1],['never mind',stop,2]),{q:1,n:1,now:0});
  assert.equal(p.newest,null);                                                    // nothing left to be told: no text is written
  p=place(emptyBook(),cache(['where are my keys',{},1],["what's the weather this weekend",{},2],['never mind',{...stop,ends:2},3]),{q:1,n:1,now:0});
  assert.equal(p.newest.text,'where are my keys');assert.deepEqual(p.newest.themes,[1]);   // an earlier one still asked: it is answered
});
