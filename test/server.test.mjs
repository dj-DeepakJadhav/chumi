import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createChumiServer} from '../server.mjs';
test('HTTP authorization, Origin/Host, body limits, static allowlist and sanitized public state',async()=>{
  const token='a'.repeat(64),{server}=createChumiServer({token});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=(path,body,headers={})=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method:body===undefined?'GET':'POST',headers:{host:'localhost:3114',origin:'http://localhost:3114','content-type':'application/json',...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));
  });
  try{
    assert.equal((await call('/action',{type:'pause',value:true})).status,403);
    const auth={'x-chumi-control':token};
    assert.equal((await call('/action',{type:'pause',value:true},{'x-chumi-control':'é'.repeat(64)})).status,403);
    assert.equal((await call('/action',{type:'pause',value:true},{...auth,origin:'https://attacker.test'})).status,403);
    assert.equal((await call('/state',undefined,{host:'attacker.test'})).status,403);
    assert.equal((await call('/action',{type:'pause',value:'yes'},auth)).status,400);
    assert.equal((await call('/action','x'.repeat(2049),auth)).status,413);
    assert.equal((await call('/action',{type:'simulate',kind:'snack'},auth)).status,403);
    assert.equal((await call('/action',{type:'baseline',mood:'unknown'},auth)).status,400);
    assert.equal((await call('/action',{type:'pause',value:true},auth)).status,200);
    const state=await call('/state');assert.equal(state.status,200);assert.equal(JSON.parse(state.text).paused,true);assert.equal(state.text.includes(token),false);assert.equal(state.text.includes('userId'),false);
    assert.equal((await call('/.local/twitch-token.json')).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('HTTP claim, SSE delivery, acknowledgement, cooldown and camera-off rejection',async()=>{
  const token='b'.repeat(64),{server}=createChumiServer({token,simulation:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const options={hostname:'127.0.0.1',port:server.address().port,headers:{host:'localhost:3114',origin:'http://localhost:3114','content-type':'application/json','x-chumi-control':token}};
  const call=body=>new Promise((resolve,reject)=>{
    const req=request({...options,path:'/action',method:'POST'},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(JSON.stringify(body));
  });
  let stream,buffer='',states=[],pending=[];
  const waitState=predicate=>{
    const existing=states.find(predicate);if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing SSE state')),2000);pending.push(state=>{if(!predicate(state))return false;clearTimeout(timer);resolve(state);return true;});});
  };
  try{
    stream=request({...options,path:'/events'},res=>res.on('data',chunk=>{
      buffer+=chunk;let end;
      while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').find(line=>line.startsWith('data: '));if(!data)continue;const state=JSON.parse(data.slice(6));states.push(state);pending=pending.filter(done=>!done(state));}
    }));stream.end();
    assert.equal((await waitState(s=>s.simulation)).active,null);
    assert.equal((await call({type:'claim',clientId:'renderer',ready:true})).data.controller,true);
    assert.equal((await call({type:'claim',clientId:'other-renderer',ready:true})).data.controller,false);
    assert.equal((await call({type:'simulate',kind:'surprise'})).data.result.accepted,true);
    const playing=await waitState(s=>s.active?.kind==='surprise');assert.equal(playing.active.source,'simulation');
    assert.equal((await call({type:'complete',clientId:'other-renderer',id:playing.active.id,outcome:'completed'})).status,409);
    assert.equal((await call({type:'complete',clientId:'renderer',id:playing.active.id,outcome:'completed'})).status,200);
    assert.equal((await waitState(s=>s.feedback?.reason==='completed')).active,null);
    assert.equal((await call({type:'simulate',kind:'cheer'})).data.result.reason,'viewer-cooldown');
    await call({type:'claim',clientId:'renderer',ready:false});
    assert.equal((await call({type:'simulate',kind:'cheer'})).data.result.reason,'camera-not-ready');
    assert.equal(states.some(s=>JSON.stringify(s).includes('userId')),false);
  }finally{stream?.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
