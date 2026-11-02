import {test} from 'node:test';
import assert from 'node:assert/strict';
import {containPoint,openPalm,PalmTracker} from '../public/palm.js';
function hand(x=.5){
 const p=Array.from({length:21},()=>({x,y:.58}));p[0]={x,y:.8};
 for(const [base,pip,tip,offset] of [[5,6,8,-.1],[9,10,12,-.03],[13,14,16,.04],[17,18,20,.1]]){p[base]={x:x+offset,y:.58};p[pip]={x:x+offset,y:.4};p[tip]={x:x+offset,y:.18};}
 return p;
}
test('contain mapping mirrors once, preserves letterboxes and resizes proportionally',()=>{
 const a={x:.25,y:.5,width:.2};const p=containPoint(a,640,480,1000,500);
 assert.ok(Math.abs(p.x-666.6666667)<.001);assert.equal(p.y,250);
 const twice=containPoint(a,640,480,2000,1000);assert.equal(twice.x,p.x*2);assert.equal(twice.width,p.width*2);
 assert.ok(containPoint(a,640,480,1000,500,false).x<500);
 const portrait=containPoint(a,640,480,300,600);assert.equal(portrait.x,225);assert.equal(portrait.y,300);
 assert.equal(containPoint(a,0,480,500,500),null);
});
test('open hand requires valid extended fingers and handles either hand orientation',()=>{
 assert.ok(openPalm(hand()));assert.equal(openPalm(null),null);assert.equal(openPalm(Array(21).fill({x:.5,y:.5})),null);
 assert.ok(openPalm(hand().map(p=>({x:1-p.x,y:p.y}))));
 assert.equal(openPalm(hand().map(p=>({...p,x:NaN}))),null);
});
test('stable dwell, bounded movement, brief loss, fresh reacquisition and video stall',()=>{
 const t=new PalmTracker();assert.equal(t.update(hand(),0).state,'acquiring');assert.equal(t.update(hand(),300).state,'acquiring');
 assert.equal(t.update(hand(),400).state,'stable');const x=t.anchor.x;
 t.update(hand(.54),480);assert.ok(t.anchor.x>x&&t.anchor.x<=x+.9*.08);
 assert.equal(t.update(null,560).state,'grace');assert.equal(t.sample(800).state,'searching');assert.equal(t.anchor,null);
 assert.equal(t.update(hand(),900).state,'acquiring');assert.equal(t.update(hand(),1300).state,'stable');
 assert.equal(t.sample(1600).state,'searching');assert.equal(t.update(hand(),1700).state,'acquiring');
});
test('sudden position changes require a new stable hand instead of teleporting',()=>{
 const t=new PalmTracker();t.update(hand(.3),0);t.update(hand(.3),400);assert.equal(t.update(hand(.7),480).state,'grace');
 assert.equal(t.update(hand(.7),800).state,'acquiring');assert.equal(t.update(hand(.7),900).state,'stable');assert.ok(t.anchor.x>.65);
 t.reset();assert.equal(t.sample(1000).state,'searching');
});
