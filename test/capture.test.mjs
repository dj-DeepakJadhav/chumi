import test from 'node:test';
import assert from 'node:assert/strict';
import {createBroadcast} from '../public/capture.js';

test('broadcast composites only video and renderer, mirrors once, and clears on camera-off or hidden',()=>{
  const previous={document:globalThis.document,window:globalThis.window,HTMLMediaElement:globalThis.HTMLMediaElement};
  const calls=[],outputTrack={stopped:false,stop(){this.stopped=true;}},sourceTrack={stopped:false};
  const context={save(){},restore(){},setTransform(){},fillRect(){calls.push(['clear']);},fillText(text){calls.push(['text',text]);},translate(x,y){calls.push(['translate',x,y]);},scale(x,y){calls.push(['scale',x,y]);},drawImage(source,...args){calls.push(['image',source,...args]);}};
  const output={getContext:()=>context,captureStream:fps=>{assert.equal(fps,30);return {getTracks:()=>[outputTrack]};}};
  const popup={closed:false,focus(){},close(){this.closed=true;}};
  globalThis.document={createElement:()=>output};globalThis.HTMLMediaElement={HAVE_CURRENT_DATA:2};
  globalThis.window={open:path=>{assert.equal(path,'/broadcast');return popup;},addEventListener(){}};
  const video={readyState:2,videoWidth:640,videoHeight:480,getTracks:()=>[sourceTrack]},renderer={width:1280,height:720};
  let state={cameraOn:true,visible:true,caption:'Viewer · snack'};
  try{
    const capture=createBroadcast({video,canvas:renderer,getSize:()=>({width:640,height:360}),getState:()=>state});
    assert.equal(capture.open(),true);assert.equal(output.width,1280);assert.equal(output.height,720);capture.draw();
    const images=calls.filter(c=>c[0]==='image');assert.deepEqual(images.map(c=>c[1]),[video,renderer]);
    assert.equal(calls.filter(c=>c[0]==='scale'&&c[1]===-1).length,1);
    assert.deepEqual(images[0].slice(2),[0,0,640,480,160,0,960,720]);
    assert.deepEqual(images[1].slice(2),[160,0,960,720,160,0,960,720]);
    assert.deepEqual(calls.find(c=>c[0]==='translate').slice(1),[1280,0]);
    for(const next of [{cameraOn:false,visible:true},{cameraOn:true,visible:false}]){
      calls.length=0;state=next;capture.draw();assert.equal(calls.some(c=>c[0]==='image'),false);assert.ok(calls.some(c=>c[0]==='clear'));assert.ok(calls.some(c=>c[0]==='text'&&c[1]==='Broadcast is idle'));
    }
    popup.closed=true;capture.draw();assert.equal(outputTrack.stopped,true);assert.equal(sourceTrack.stopped,false);assert.equal(window.chumiBroadcastStream,undefined);assert.equal(capture.isOpen,false);
  }finally{Object.assign(globalThis,previous);}
});

test('blocked broadcast popup leaves camera and stream untouched',()=>{
  const previous={document:globalThis.document,window:globalThis.window};let streams=0;
  globalThis.document={createElement:()=>({getContext:()=>({}),captureStream:()=>{streams++;}})};
  globalThis.window={open:()=>null,addEventListener(){}};
  try{const capture=createBroadcast({video:{},canvas:{},getSize:()=>({}),getState:()=>({})});assert.equal(capture.open(),false);assert.equal(capture.isOpen,false);assert.equal(streams,0);}
  finally{Object.assign(globalThis,previous);}
});

test('resetting output size preserves the existing capture window and stream',()=>{
  const previous={document:globalThis.document,window:globalThis.window};let streams=0,opens=0;const sizes=[];
  const stream={getTracks:()=>[]};
  const popup={closed:false,outerWidth:600,innerWidth:600,outerHeight:800,innerHeight:734,screen:{availWidth:1512,availHeight:982},focus(){},close(){this.closed=true;},resizeTo(w,h){sizes.push({w,h});}};
  globalThis.document={createElement:()=>({getContext:()=>({}),captureStream:()=>{streams++;return stream;}})};
  globalThis.window={open:()=>{opens++;return popup;},addEventListener(){}};
  try{
    const capture=createBroadcast({video:{},canvas:{},getSize:()=>({}),getState:()=>({})});
    capture.open();capture.fitWindow();capture.open();
    assert.equal(opens,1);assert.equal(streams,1);assert.equal(window.chumiBroadcastStream,stream);
    assert.equal(popup.closed,false);assert.ok(sizes.every(({w,h})=>w/(h-66)===16/9&&w<=1512&&h<=982));capture.stop();
  }finally{Object.assign(globalThis,previous);}
});
