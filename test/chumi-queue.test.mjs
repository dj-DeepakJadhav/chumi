import test from 'node:test';
import assert from 'node:assert/strict';
import {ChumiQueue} from '../chumi-queue.mjs';
const event=(n,kind='snack',userId=`viewer-${n}`)=>({id:`event-${n}`,userId,name:'Friendly viewer',text:`!${kind}`});
test('exact commands only, camera readiness, deduplication and three-second cross-command cooldown',()=>{
  const q=new ChumiQueue();assert.equal(q.receive({...event(0),text:'hello'},0),null);assert.equal(q.receive({...event(0),text:'!snack please'},0),null);
  assert.equal(q.receive(event(0),0).reason,'camera-not-ready');q.claim('camera',true,0);
  assert.equal(q.receive(event(1),0).accepted,true);assert.equal(q.receive(event(1),1).reason,'duplicate');
  assert.equal(q.receive(event(2,'snack','viewer-1'),1).reason,'viewer-cooldown');
  assert.equal(q.complete('camera',q.active.id,'completed',2),true);q.claim('camera',true,2999);
  assert.equal(q.receive(event(3,'surprise','viewer-1'),2999).reason,'viewer-cooldown');q.claim('camera',true,3000);
  assert.equal(q.receive(event(4,'surprise','viewer-1'),3000).accepted,true);
});
test('five waiting slots, one pending per viewer and no internal identifiers in public state',()=>{
  const q=new ChumiQueue();q.claim('camera',true,0);q.receive(event(0),0);
  for(let i=1;i<=5;i++)assert.equal(q.receive(event(i),i).accepted,true);
  assert.equal(q.receive(event(6),6).reason,'queue-full');assert.equal(q.state.queueCount,5);
  q.claim('camera',true,20001); // The old lease clears, so use fresh pending entries for the per-viewer invariant.
  q.receive(event(7),20001);q.claim('camera',true,23000);q.claim('camera',true,26000);q.claim('camera',true,29000);q.claim('camera',true,32000);q.claim('camera',true,35000);q.claim('camera',true,38000);q.claim('camera',true,40002);
  assert.equal(q.receive(event(8,'surprise','viewer-7'),40002).reason,'viewer-pending');
  assert.equal(JSON.stringify(q.state).includes('userId'),false);assert.equal(JSON.stringify(q.state).includes('viewer-7'),false);
});
test('cheer merges, global cooldown and pause/quiet cancel without replay',()=>{
  const q=new ChumiQueue();q.claim('camera',true,0);q.receive(event(0),0);
  assert.equal(q.receive(event(1,'cheer'),1).reason,'accepted');assert.equal(q.receive(event(2,'cheer'),2).reason,'cheer-cooldown');
  assert.equal(q.receive(event(3,'cheer'),3001).reason,'merged');assert.equal(q.state.queueCount,1);
  q.control('pause',true);assert.equal(q.state.active,null);assert.equal(q.state.queueCount,0);assert.equal(q.receive(event(4),3002).reason,'paused');
  q.control('quiet',true);q.control('pause',false);assert.equal(q.receive(event(5),3003).reason,'quiet');q.control('quiet',false);q.tick(3004);assert.equal(q.state.active,null);
});
test('single renderer lease, camera loss, deadline and stale acknowledgements are bounded',()=>{
  const q=new ChumiQueue();q.claim('one',true,0);assert.equal(q.claim('two',true,1),false);q.receive(event(1),1);const id=q.active.id;
  assert.equal(q.complete('two',id,'completed',2),false);q.claim('one',false,2);assert.equal(q.active,null);assert.equal(q.complete('one',id,'completed',3),false);
  q.claim('two',true,4);q.receive(event(2),4);q.tick(4004);assert.equal(q.active,null);assert.equal(q.lease,null);
  q.claim('two',true,5000);q.receive(event(3),5000);for(let now=8000;now<=32000;now+=3000)q.claim('two',true,now);
  assert.equal(q.active,null);assert.equal(q.feedback.reason,'renderer-timeout');
});
