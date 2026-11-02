// Pure normalized-coordinate math: no camera, DOM, inference or network access.
export function containPoint(anchor,videoWidth,videoHeight,width,height,mirror=true){
 if(!anchor||![videoWidth,videoHeight,width,height].every(n=>Number.isFinite(n)&&n>0))return null;
 const scale=Math.min(width/videoWidth,height/videoHeight),drawWidth=videoWidth*scale,drawHeight=videoHeight*scale;
 return {x:(width-drawWidth)/2+(mirror?1-anchor.x:anchor.x)*drawWidth,y:(height-drawHeight)/2+anchor.y*drawHeight,width:anchor.width*drawWidth};
}
const distance=(a,b,aspect=1)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
export function openPalm(landmarks,videoWidth=640,videoHeight=480){
 if(!Array.isArray(landmarks)||landmarks.length!==21||landmarks.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<-.1||p.x>1.1||p.y<-.1||p.y>1.1))return null;
 const aspect=videoWidth/videoHeight,wrist=landmarks[0];
 // Finger extension is rotation-independent and does not rely on left/right labels.
 const extended=[[8,6],[12,10],[16,14],[20,18]].filter(([tip,pip])=>distance(landmarks[tip],wrist,aspect)>distance(landmarks[pip],wrist,aspect)*1.14).length;
 const width=distance(landmarks[5],landmarks[17],aspect)/aspect;
 if(extended<3||width<.045||width>.6)return null;
 const points=[0,5,9,13,17].map(i=>landmarks[i]);
 return {x:points.reduce((s,p)=>s+p.x,0)/5,y:points.reduce((s,p)=>s+p.y,0)/5,width};
}
export class PalmTracker{
 constructor(){this.reset();}
 reset(){this.candidate=null;this.candidateSince=0;this.anchor=null;this.lastSeen=-Infinity;this.lastUpdate=null;this.stable=false;}
 update(landmarks,now,videoWidth=640,videoHeight=480){
  if(!Number.isFinite(now))throw new TypeError('Palm timestamp must be finite');
  const dt=this.lastUpdate===null?0:Math.max(0,Math.min(.2,(now-this.lastUpdate)/1000));this.lastUpdate=now;
  const raw=openPalm(landmarks,videoWidth,videoHeight);
  if(!raw){this.candidate=null;this.stable=false;return this.sample(now);}
  const moved=!this.candidate||distance(raw,this.candidate)> .075||Math.abs(raw.width-this.candidate.width)>this.candidate.width*.35;
  if(moved){this.candidate=raw;this.candidateSince=now;this.stable=false;}
  if(now-this.candidateSince>=400){
   this.stable=true;this.lastSeen=now;
   if(!this.anchor)this.anchor={...raw};
   else{
    const alpha=1-Math.exp(-dt/.09),dx=(raw.x-this.anchor.x)*alpha,dy=(raw.y-this.anchor.y)*alpha,max=.9*dt,length=Math.hypot(dx,dy),limit=length>max&&length?max/length:1;
    this.anchor.x+=dx*limit;this.anchor.y+=dy*limit;this.anchor.width+=(raw.width-this.anchor.width)*alpha;
   }
   // Keep the original candidate as the stability reference while acquiring;
   // once attached, allow normal continuous hand travel without restarting dwell.
   this.candidate=raw;
  }
  return this.sample(now);
 }
 sample(now){
  if(this.stable&&now-this.lastSeen>250){this.stable=false;this.candidate=null;}
  if(this.stable&&now-this.lastSeen<=250)return {state:'stable',anchor:this.anchor,progress:1};
  if(this.anchor&&now-this.lastSeen<=250)return {state:'grace',anchor:this.anchor,progress:0};
  // After grace, require a fresh dwell and fresh anchor; never reuse a stale hand position.
  this.anchor=null;
  return {state:this.candidate?'acquiring':'searching',anchor:null,progress:this.candidate?Math.min(1,Math.max(0,(now-this.candidateSince)/400)):0};
 }
}
