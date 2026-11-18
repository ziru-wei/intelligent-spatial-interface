import test from 'node:test';
import assert from 'node:assert/strict';
import {load,normalize,modSetting,answerSettings,resumeOnFirstResponse} from '../src/ui-settings.mjs';

const store=init=>{const m=new Map(Object.entries(init));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};

test('ui settings: library and replay values, clamped; the earlier Agent panel carried over once', ()=>{
  const s=normalize({text:{stability:3},cues:{handTouchDistance:.2}});
  assert.equal(s.text.stability,1);assert.equal(s.cues,undefined);   // a group that is gone is droppedassert.equal(s.replay.resumeOnResponse,false);
  const old=load(store({'spatial-take:response-settings':JSON.stringify({global:{stability:.4,resumeOnResponse:true,fixedText:true},mods:{findmy:{options:{handApproachDistance:.3}}}})}));
  assert.deepEqual(old,{text:{stability:.4},replay:{resumeOnResponse:true}});
  assert.equal(resumeOnFirstResponse(old),true);
});

test('ui settings: a MOD\'s own choices come from its parts, never from the editor', ()=>{
  const answer={mods:{weather:{settings:{lock:'lock'}}},weather:{},text_mod:{id:'findmy',settings:{duration:'5s'}}};
  assert.equal(modSetting(answer,'weather','lock'),'lock');
  assert.equal(modSetting({weather:{},mod:{settings:{lock:'follow'}}},'weather','lock'),'follow');
  assert.equal(modSetting({},'weather','lock'),null);
  assert.deepEqual(answerSettings(normalize({text:{stability:.5}}),answer),{stability:.5,autoHide:true});
  assert.equal(answerSettings(normalize(),{}).autoHide,false);
});
