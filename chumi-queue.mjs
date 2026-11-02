import {randomUUID} from 'node:crypto';
const moods=new Set(['content','curious','anticipation','delighted','amused','surprised','concerned','sleepy']);
export class ChumiQueue {
  constructor(){this.queue=[];this.active=null;this.cheer=null;this.seen=new Map();this.cooldowns=new Map();this.cheerAt=-Infinity;this.paused=false;this.quiet=false;this.baseline='content';this.feedback=null;this.lease=null;}
  get state(){return {queueCount:this.queue.length+(this.cheer?1:0),active:this.active?this.publicItem(this.active):null,paused:this.paused,quiet:this.quiet,baseline:this.baseline,feedback:this.feedback};}
  publicItem({id,kind,name,source}){return {id,kind,name,source};}
  tick(now=Date.now()){
    if(this.lease&&now>=this.lease.until){this.lease=null;this.clear('renderer-lost');}
    if(this.active&&now>=this.active.deadline){this.feedback={...this.publicItem(this.active),accepted:false,reason:'renderer-timeout'};this.active=null;}
    this.queue=this.queue.filter(item=>now-item.created<30000);
    if(this.cheer&&now-this.cheer.created>=30000)this.cheer=null;
    for(const [key,until] of this.seen)if(now>=until)this.seen.delete(key);
    for(const [key,until] of this.cooldowns)if(now>=until)this.cooldowns.delete(key);
    if(!this.active&&this.lease&&!this.paused&&!this.quiet){const item=this.cheer||this.queue.shift();this.cheer=null;if(item)this.active={...item,deadline:now+25000};}
  }
  claim(clientId,ready,now=Date.now()){
    this.tick(now);
    if(this.lease&&this.lease.id!==clientId)return false;
    if(!ready){this.lease=null;this.clear('camera-off');return false;}
    this.lease={id:clientId,until:now+4000};this.tick(now);return true;
  }
  receive(event,now=Date.now(),source='twitch'){
    this.tick(now);
    if(!event||typeof event.text!=='string'||!/^!(snack|surprise|cheer)$/.test(event.text))return null;
    if(typeof event.id!=='string'||!event.id||event.id.length>200||typeof event.userId!=='string'||!event.userId||event.userId.length>100)return null;
    const kind=event.text.slice(1),name=String(event.name||'Viewer').replace(/[\p{C}]/gu,'').slice(0,40)||'Viewer';
    const reject=reason=>(this.feedback={kind,name,source,accepted:false,reason});
    if(this.seen.has(event.id))return reject('duplicate');
    if(this.seen.size>=5000)return reject('event-limit');
    this.seen.set(event.id,now+600000);
    if(this.paused)return reject('paused');if(this.quiet)return reject('quiet');
    if(!this.lease)return reject('camera-not-ready');
    if(this.cooldowns.has(event.userId))return reject('viewer-cooldown');
    if([this.active,...this.queue,this.cheer].some(item=>item?.userId===event.userId))return reject('viewer-pending');
    if(kind==='cheer'&&now-this.cheerAt<3000)return reject('cheer-cooldown');
    const merging=kind==='cheer'&&(this.cheer||this.active?.kind==='cheer');
    if(!merging&&this.queue.length+(this.cheer?1:0)>=5)return reject('queue-full');
    if(this.cooldowns.size>=5000)return reject('viewer-limit');
    this.cooldowns.set(event.userId,now+3000);
    const item={id:randomUUID(),kind,name,source,userId:event.userId,created:now};
    let reason='accepted';
    if(kind==='cheer'){this.cheerAt=now;if(this.cheer||this.active?.kind==='cheer')reason='merged';else this.cheer=item;}
    else this.queue.push(item);
    this.feedback={kind,name,source,accepted:true,reason};this.tick(now);return this.feedback;
  }
  complete(clientId,id,outcome,now=Date.now()){
    this.tick(now);if(this.lease?.id!==clientId||this.active?.id!==id)return false;
    if(!['completed','expired','tracking-lost','cancelled','dismissed'].includes(outcome))return false;
    this.feedback={...this.publicItem(this.active),accepted:true,reason:outcome};this.active=null;this.tick(now);return true;
  }
  clear(reason){if(this.active)this.feedback={...this.publicItem(this.active),accepted:false,reason};this.active=null;this.queue=[];this.cheer=null;}
  control(type,value){if(type==='pause'){this.paused=value;if(value)this.clear('paused');}else if(type==='quiet'){this.quiet=value;if(value)this.clear('quiet');}else if(type==='dismiss')this.clear('dismissed');else if(type==='baseline'){if(!moods.has(value))return false;this.baseline=value;}else return false;return true;}
}
