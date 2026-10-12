import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {scanPreviewMaterial} from '../src/scan-material.mjs';

test('unaligned scan retains texture, base colour and cutout settings',()=>{
 const map=new THREE.Texture(),source=new THREE.MeshStandardMaterial({map,color:0x73614b,alphaTest:.4});
 const preview=scanPreviewMaterial(source,new THREE.BufferGeometry());
 assert.equal(preview.map,map);assert.ok(preview.color.equals(source.color));
 assert.equal(preview.alphaTest,.4);assert.equal(preview.side,THREE.DoubleSide);
 assert.equal(source.type,'MeshStandardMaterial');
});
test('multi-material and vertex-coloured scans retain their appearance',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('color',new THREE.Float32BufferAttribute([.1,.2,.3],3));
 const materials=scanPreviewMaterial([new THREE.MeshStandardMaterial({color:0x222222}),new THREE.MeshStandardMaterial({color:0x885522})],geometry);
 assert.equal(materials.length,2);assert.ok(materials.every(m=>m.vertexColors));
 assert.equal(materials[0].color.getHex(),0x222222);assert.equal(materials[1].color.getHex(),0x885522);
});
