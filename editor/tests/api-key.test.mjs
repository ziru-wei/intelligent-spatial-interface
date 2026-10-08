import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {promptApiKey,resolveApiKey} from '../scripts/api-key.mjs';
function terminal(){
  const input=new PassThrough(),output=new PassThrough();let transcript='';
  input.isTTY=true;input.isRaw=false;input.setRawMode=raw=>{input.isRaw=raw;};input.pause();
  output.on('data',data=>transcript+=data.toString());
  return {input,output,transcript:()=>transcript};
}
test('environment/config keys skip prompt and whitespace-only keys prompt',async()=>{
  const prompt=async()=>'entered';
  assert.equal(await resolveApiKey({envKey:' env ',configKey:'config',prompt}),'env');
  assert.equal(await resolveApiKey({envKey:' ',configKey:'config',prompt}),'config');
  assert.equal(await resolveApiKey({envKey:'',configKey:' ',prompt}),'entered');
});
test('hidden entry handles empty submit, editing and paste, restores terminal',async()=>{
  const t=terminal(),result=promptApiKey(t);
  assert.equal(t.input.isRaw,true);
  t.input.write('\r');t.input.write('fake-key-x');t.input.write('\x7f');t.input.write('y\r');
  assert.equal(await result,'fake-key-y');assert.equal(t.input.isRaw,false);assert.equal(t.input.isPaused(),true);
  assert.match(t.transcript(),/cannot be empty/);assert.ok(!t.transcript().includes('fake-key'));
  assert.equal(t.input.listenerCount('keypress'),0);
});
test('Ctrl+C cancels and restores raw mode without disclosing partial input',async()=>{
  const t=terminal(),result=promptApiKey(t);t.input.write('partial-secret\x03');
  await assert.rejects(result,{code:'CANCELLED'});assert.equal(t.input.isRaw,false);assert.ok(!t.transcript().includes('partial-secret'));
});
test('non-interactive input fails immediately with configuration instructions',async()=>{
  await assert.rejects(promptApiKey({input:new PassThrough(),output:new PassThrough()}),/no interactive terminal/);
});
