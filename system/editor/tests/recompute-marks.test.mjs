import test from 'node:test';
import assert from 'node:assert/strict';
import {recomputeMarks} from '../src/recompute-marks.mjs';

const step=(tool,text)=>({tool,text:typeof text==='string'?text:JSON.stringify(text)});
test('each revision that recomputed something is marked at the end of its words, by what it changed', ()=>{
  const revisions=[{rev:1,text:'whats the'},{rev:2,text:'whats the weather'},{rev:3,text:'whats the weather this weekend'},{rev:4,text:'whats the weather this weekend send it to Alice'}];
  const runs=[
    {rev:1,steps:[step('view_live',{shown:[]})]},                                                                  // nothing yet
    {rev:2,steps:[step('view_live',{shown:['weather']}),step('view_live',{kept:[],updated:['weather:weather']})]},  // Weather comes, its cues
    {rev:3,steps:[step('view_live',{shown:['weather']}),step('view_live',{kept:[],updated:['weather:weather']}),step('show_text','Text stream complete')]},
    {rev:4,steps:[step('view_live',{shown:['send','weather']}),step('view_live',{kept:['weather:weather'],updated:['action:send']}),step('modos_draft',{chars:90})]},
  ];
  assert.deepEqual(recomputeMarks(runs,revisions),[
    {at:17,rev:2,kinds:['mods']},{at:30,rev:3,kinds:['ui','text']},{at:47,rev:4,kinds:['mods','text']}]);   // a MOD came: its part showed first
  assert.deepEqual(recomputeMarks([{rev:9,steps:[step('view_live',{kept:['weather:weather'],updated:[]})]}],revisions),[]);   // kept all: no mark
});

test('from a decision record: a part shown first (its MOD came), one taken away, one updated; a MOD that draws nothing is not marked; and the words by theme', async()=>{
  const {wordThemes}=await import('../src/recompute-marks.mjs');
  const revisions=[{rev:1,text:'weather this weekend? send it to Alice'}];
  const dec={sentences:[{id:'s0',span:[0,21],into:['t5']},{id:'s1',span:[22,38],into:['t7'],refs:['t5']}],themes:[{id:'t5',mods:{weather:.9}},{id:'t7',mods:{send:.95,weather:.4}}],
    mods:[{id:'msend',state:'came'},{id:'mweather',state:'stays'},{id:'mfindmy',state:'went'},{id:'mreminder',state:'came'}],parts:[{mod:'msend',change:'new'},{mod:'mweather',change:'updated'},{mod:'mfindmy',change:'withdrawn'}],text:{state:'kept'}};
  assert.deepEqual(recomputeMarks([{rev:1,steps:[step('decisions',dec)]}],revisions),[{at:38,rev:1,kinds:['mods','gone','ui']}]);
  assert.deepEqual(wordThemes([{rev:1,steps:[step('decisions',dec)]}]),[{from:0,to:21,ids:['t5'],themes:[1],mods:['weather']},{from:22,to:38,ids:['t7'],themes:[2],mods:['send']}]);
});
