// Doubao (Volcano Engine) streaming speech recognition, its binary protocol (scripts/asr-relay.mjs uses it): v1, a 4-byte header
// (version and header size; message type and flags; serialization and compression; reserved), then a 4-byte big-endian payload size
// (after a 4-byte sequence number when the flags say so) and the payload, gzip-compressed.
import {gzipSync,gunzipSync} from 'node:zlib';

// The binary protocol (v1, 4-byte header, big-endian sizes): full client request (JSON, gzip), audio only (raw, gzip), server response.
export const FULL=0b0001,AUDIO=0b0010,RESPONSE=0b1001,ERROR=0b1111;
export function frame(type,flags,payload,{json=false}={}){
  const body=gzipSync(payload),h=Buffer.from([0x11,(type<<4)|flags,((json?1:0)<<4)|1,0]),size=Buffer.alloc(4);size.writeUInt32BE(body.length);
  return Buffer.concat([h,size,body]);
}
export function parse(buf){
  const type=buf[1]>>4,flags=buf[1]&0x0f,ser=buf[2]>>4,gz=(buf[2]&0x0f)===1;let o=(buf[0]&0x0f)*4;
  if(type===ERROR){const code=buf.readUInt32BE(o),n=buf.readUInt32BE(o+4);return {error:`${code}: ${buf.subarray(o+8,o+8+n).toString('utf8')}`};}
  if(flags&0b0001)o+=4;   // a sequence number
  const n=buf.readUInt32BE(o);let p=buf.subarray(o+4,o+4+n);if(gz&&p.length)p=gunzipSync(p);
  return {type,last:(flags&0b0010)!==0,json:ser===1&&p.length?JSON.parse(p.toString('utf8')):null};
}


/** The recognition's request (its `request` object): two passes, punctuation, inverse text normalization, sentences with `definite`;
 *  split 'silence' ends a sentence after endWindowMs of silence (end_window_size), 'meaning' leaves it to Doubao's semantic
 *  segmentation; fillers 'removed' turns on Doubao's smoothing (enable_ddc). Nothing else is set. */
export function requestFor({split='silence',fillers='kept'}={},endWindowMs=1200){
  return {model_name:'bigmodel',enable_nonstream:true,enable_itn:true,enable_punc:true,result_type:'full',show_utterances:true,
    ...(split==='meaning'?{}:{end_window_size:endWindowMs}),...(fillers==='removed'?{enable_ddc:true}:{})};
}
