import test from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline,zoneAnimation} from '../scripts/jev-pipeline.mjs';
const n=value=>({type:'noul',noul:value});
const catalog={time:{date:'2026-10-15'},context_groups:{storage:{description:'inventory'}},user:{name:'Alex'}};
const lab={in:{id:'lab-2f',name:'Lab · 2F',info_key:'Programmable Reality Lab'}};

function run(cat,{pick='none',text='What does this lab do?'}={}){
  const parts=[],stages=[],asked={};
  const done=runPipeline({question:{id:9,text},readContext:async()=>cat,
    ask:async(stage,state,questions)=>{stages.push(stage);asked[stage]=questions;
      return Object.fromEntries(Object.entries(questions).map(([k,q])=>[k,q.type==='choice'?{type:'choice',choice:pick,probabilities:{[pick]:.8}}:n(0)]));},
    answer:async()=>({title:'PRL',body:'The Programmable Reality Lab…',anchor:{object:'user-view',relation:'in-front'},referenced_item_ids:[]}),
    publish:async p=>parts.push(p)});
  return done.then(result=>({result,parts,stages,asked}));
}

test('Jev chooses the lab-life animation, the research one, or none; the text answers either way',async()=>{
  const life=await run({...catalog,location:lab},{pick:'labResearchLife'});
  assert.deepEqual(Object.keys(life.asked.jev_call_zone_animation.animation.criteria),['labResearchLife','labResearchWork','none']);
  assert.deepEqual(life.parts.find(p=>p.part==='animation').animation,{id:'labResearchLife',zone:'lab-2f'});
  assert.ok(life.parts.some(p=>p.part==='text'));
  const research=await run({...catalog,location:lab},{pick:'labResearchWork',text:'What does PRL research?'});
  assert.equal(research.parts.find(p=>p.part==='animation').animation.id,'labResearchWork');
  const facts=await run({...catalog,location:lab},{pick:'none',text:'Who leads this lab?'});
  assert.equal(facts.parts.some(p=>p.part==='animation'),false);assert.ok(facts.parts.some(p=>p.part==='text'));
});

test('no animation call outside the lab',async()=>{
  const away=await run({...catalog,location:{in:{id:'kitchen-2f'}}},{pick:'labResearchLife'});
  assert.equal(away.stages.includes('jev_call_zone_animation'),false);assert.equal(away.parts.some(p=>p.part==='animation'),false);
});

test('facing the lab from the corridor, or its vision on the wall selected, counts too',()=>{
  assert.equal(zoneAnimation({location:{in:{id:'lab-hall-2f'},facing:{id:'lab-2f',via:'door'}}}).via,'facing');
  assert.equal(zoneAnimation({selection:{box_id:'layout:lab-shelf-3_1',key:'lab philosophy'}}).via,'selection');
  assert.equal(zoneAnimation({selection:{box_id:'layout:custom_0',key:"Poster of Anastasia's Talk"}}),null);
});

// The lab's info in parts: Jev's choice of them is what the answer reads.
const texts={'Programmable Reality Lab':'Led by Prof. Ryo Suzuki; students …','PRL research theme':'Today we program computers we live with…','PRL philosophy':'Student success and happiness first…'};
function runParts(cat,sections,{text='What does this lab research?'}={}){
  const answers=[];
  return runPipeline({question:{id:11,text},readContext:async()=>cat,readInfo:async key=>({key,text:texts[key]}),recordInfo:async()=>{},
    ask:async(stage,state,questions)=>Object.fromEntries(Object.entries(questions).map(([k,q])=>[k,q.type==='choice'?{type:'choice',choice:'none',probabilities:{none:1}}:n(k.startsWith('section_')?(sections.includes(k.slice(8))?.9:.1):k==='info_selected'?.9:0)])),
    answer:async(question,context)=>{answers.push(context);return {title:'PRL',body:'…',anchor:{object:'user-view',relation:'in-front'},referenced_item_ids:[]};},
    publish:async()=>{}}).then(()=>answers);
}
test('a question about the lab asked in it reads only the parts Jev chose (info route through the zone)',async()=>{
  const [ctx]=await runParts({...catalog,location:lab,selection:{box_id:'zone:lab-2f',key:'Programmable Reality Lab',score:.4,cues:{zone:1},mode:'jev'}},['theme']);
  assert.deepEqual(Object.keys(ctx.info.parts),['theme']);assert.equal(ctx.info.parts.theme,texts['PRL research theme']);
});
test('the lab vision on the wall selected (score only) reads the chosen parts too',async()=>{
  const [ctx]=await runParts({...catalog,selection:{box_id:'layout:lab-shelf-3_1',key:'lab philosophy',score:.8,cues:{gaze:1},mode:'score'}},['philosophy','members'],{text:'What is this lab\'s philosophy?'});
  assert.deepEqual(Object.keys(ctx.info.parts).sort(),['members','philosophy']);
});
test('in the lab without a selection, the chosen parts join the answer context as zone_info',async()=>{
  const [ctx]=await runParts({...catalog,location:lab},['members'],{text:'Who leads this lab?'});
  assert.deepEqual(ctx.zone_info.parts,{members:texts['Programmable Reality Lab']});
});

test('"where is it?" after a question about a book means the book, not the lab one stands in',async()=>{
  const book={item_id:'to-the-lighthouse',label:'To the Lighthouse',context_groups:['storage'],question_id:40};
  const cat={...catalog,location:lab,selection:{box_id:'zone:lab-2f',key:'Programmable Reality Lab',score:.4,cues:{zone:1},mode:'jev'},conversation:{recent_turns:[{question_id:40,user_question:'What should I read today?',assistant:[{title:'Continue To the Lighthouse',body:'Around page 68.'}],referenced_entities:[book]}],referents:[book]}};
  const answers=[];
  await runPipeline({question:{id:41,text:'OK cool but where is it'},readContext:async()=>cat,readInfo:async key=>({key,text:'PRL'}),recordInfo:async()=>{},
    ask:async(stage,state,questions)=>Object.fromEntries(Object.entries(questions).map(([k,q])=>[k,
      k==='conversation_reference'?{type:'choice',choice:'ref_0',probabilities:{ref_0:.9},confidence:1}:q.type==='choice'?{type:'choice',choice:'none',probabilities:{none:1}}:n(k==='info_selected'?.52:k==='storage'?.8:0)])),
    answer:async(question,context)=>{answers.push(context);return {title:'Book',body:'On the sofa',anchor:{object:'user-view',relation:'in-front'},referenced_item_ids:[]};},
    publish:async()=>{}});
  assert.equal(answers[0].info,undefined);
});
