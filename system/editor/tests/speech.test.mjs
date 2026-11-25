import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {FULL,AUDIO,frame,parse,requestFor} from '../scripts/doubao-asr.mjs';
import {normalize,speechOptions} from '../src/ui-settings.mjs';
import {pcm16,PACKET} from '../src/speech-input.mjs';

test('speech: frames as Doubao reads them: v1 4-byte header, gzip, big-endian size; the last audio packet flagged', ()=>{
  const f=frame(FULL,0,Buffer.from('{"a":1}'),{json:true});
  assert.deepEqual([...f.subarray(0,4)],[0x11,0x10,0x11,0x00]);                 // v1, full client request, JSON + gzip
  assert.equal(f.readUInt32BE(4),f.length-8);
  const a=frame(AUDIO,0b0010,Buffer.alloc(6400));assert.equal(a[1],0x22);       // audio only, last packet
  assert.equal(PACKET,3200);                                                     // 200 ms at 16 kHz
});

test('speech: a server response gives its text and sentences; an error frame its code and message', ()=>{
  const body=gzipSync(Buffer.from(JSON.stringify({result:{text:'is it gonna rain',utterances:[{text:'is it gonna rain',definite:true}]}})));
  const seq=Buffer.alloc(4);seq.writeInt32BE(-3);const size=Buffer.alloc(4);size.writeUInt32BE(body.length);
  const r=parse(Buffer.concat([Buffer.from([0x11,0x93,0x11,0]),seq,size,body]));   // full server response, last, with a sequence
  assert.equal(r.last,true);assert.equal(r.json.result.text,'is it gonna rain');
  const msg=Buffer.from('bad resource'),e=Buffer.alloc(8);e.writeUInt32BE(45000001);e.writeUInt32BE(msg.length,4);
  assert.equal(parse(Buffer.concat([Buffer.from([0x11,0xf0,0x10,0]),e,msg])).error,'45000001: bad resource');
});

test('speech: samples become 16-bit little-endian PCM, clipped', ()=>{
  const v=new DataView(pcm16(Float32Array.from([0,1,-1,2])));
  assert.deepEqual([v.getInt16(0,true),v.getInt16(2,true),v.getInt16(4,true),v.getInt16(6,true)],[0,32767,-32768,32767]);
});

test('speech settings: sentences after 1.2 s of silence and fillers kept by default; by meaning drops end_window_size, removed turns on smoothing', ()=>{
  const base={model_name:'bigmodel',enable_nonstream:true,enable_itn:true,enable_punc:true,result_type:'full',show_utterances:true};
  const s=normalize({});assert.deepEqual(speechOptions(s),{split:'silence',fillers:'kept'});
  assert.deepEqual(requestFor(speechOptions(s),1200),{...base,end_window_size:1200});            // as before: nothing else changes
  assert.deepEqual(requestFor(speechOptions(normalize({speech:{meaning:true}})),1200),base);
  assert.deepEqual(requestFor(speechOptions(normalize({speech:{fillers:true}})),1200),{...base,end_window_size:1200,enable_ddc:true});
});
