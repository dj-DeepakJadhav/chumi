import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPalmCamera} from '../public/camera.js';
function mockMedia(getUserMedia){const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia}}});return()=>previous?Object.defineProperty(globalThis,'navigator',previous):delete globalThis.navigator;}
function media(){let stops=0;const track={addEventListener(){},removeEventListener(){},stop(){stops++;}};return {stream:{getTracks:()=>[track]},get stops(){return stops;}};}
test('camera is explicit, permission denial is readable and retry stays available',async()=>{
 let calls=0;const restore=mockMedia(async()=>{calls++;throw Object.assign(new Error('denied'),{name:'NotAllowedError'});});const states=[];
 try{const camera=createPalmCamera({video:{srcObject:null},onStatus:s=>states.push(s)});assert.equal(calls,0);await camera.start();assert.equal(camera.running,false);assert.match(states.at(-1).message,/denied/);await camera.start();assert.equal(calls,2);camera.stop();assert.equal(states.at(-1).state,'stopped');}finally{restore();}
});
test('stop during permission request releases a late stream without attaching camera',async()=>{
 let grant;const restore=mockMedia(()=>new Promise(resolve=>grant=resolve));const m=media(),video={srcObject:null,play:async()=>{throw new Error('must not play');}};
 try{const camera=createPalmCamera({video});const pending=camera.start();camera.stop();grant(m.stream);await pending;assert.equal(m.stops,1);assert.equal(video.srcObject,null);assert.equal(camera.running,false);}finally{restore();}
});
test('startup dependency failure releases camera tracks and clears video',async()=>{
 const m=media(),restore=mockMedia(async()=>m.stream),video={srcObject:null,play:async()=>{}};const states=[];
 try{const camera=createPalmCamera({video,onStatus:s=>states.push(s)});await camera.start();assert.equal(m.stops,1);assert.equal(video.srcObject,null);assert.equal(states.at(-1).state,'error');}finally{restore();}
});
test('video is revealed before playback and hidden again after startup failure',async()=>{
 const m=media(),restore=mockMedia(async()=>m.stream);let played=false;
 const video={hidden:true,srcObject:null,play:async()=>{assert.equal(video.hidden,false);played=true;throw new Error('preview failed');}};
 try{const camera=createPalmCamera({video});await camera.start();assert.equal(played,true);assert.equal(video.hidden,true);assert.equal(video.srcObject,null);assert.equal(m.stops,1);}finally{restore();}
});
