import * as THREE from '/vendor/three.module.js';

// Shared tokens drive face, rim and back glyph together. No chat sentiment inference.
export const MOODS=Object.freeze({
 content:{label:'Content',color:'#BFABFF',symbol:'dot'},
 curious:{label:'Curious',color:'#FFCA5F',symbol:'question'},
 anticipation:{label:'Anticipation',color:'#FFCA5F',symbol:'dots'},
 delighted:{label:'Delighted',color:'#69FFC3',symbol:'sparkle'},
 amused:{label:'Amused',color:'#BFABFF',symbol:'laugh'},
 surprised:{label:'Surprised',color:'#FEEE85',symbol:'exclamation'},
 concerned:{label:'Concerned',color:'#A99ABB',symbol:'waves'},
 sleepy:{label:'Sleepy',color:'#8D7AAA',symbol:'crescent'}
});

export function createChumi() {
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);
 const purple=new THREE.MeshStandardMaterial({color:0x9146ff,roughness:.64});
 const geometry=new THREE.SphereGeometry(1,48,32),vertices=geometry.attributes.position;
 for(let i=0;i<vertices.count;i++){
  const y=vertices.getY(i),fullness=1+.06*Math.max(0,-y);
  vertices.setXYZ(i,vertices.getX(i)*fullness,Math.max(-.865,y),vertices.getZ(i)*fullness);
 }
 geometry.computeVertexNormals();
 const shell=new THREE.Mesh(geometry,purple);shell.scale.set(1.12,.74,.76);shell.position.y=.72;body.add(shell);
 const feet=[-1,1].map(side=>{const f=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),purple);f.scale.set(.25,.13,.31);f.position.set(side*.61,.14,.12);root.add(f);return f;});
 function surface(width,height,centerY,back=false){
  const g=new THREE.PlaneGeometry(width,height,40,32),p=g.attributes.position;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i)+centerY-.72,fullness=1+.06*Math.max(0,-y/.74);
   const z=.76*fullness*Math.sqrt(Math.max(.015,1-(x/(1.12*fullness))**2-(y/.74)**2))+.009;
   p.setXYZ(i,back?-x:x,y+.72,back?-z:z);
  }
  // Mirrored X already turns the winding outward on the back.
  g.computeVertexNormals();return g;
 }
 function canvasSurface(geometry){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));body.add(mesh);return {ctx,texture,mesh};
 }
 const face=canvasSurface(surface(1.76,1.2,.78)),back=canvasSurface(surface(.66,.58,.83,true));
 let lastFace='',lastBack='',monochrome=false;
 const accent=new THREE.Color(MOODS.content.color),target=new THREE.Color();
 function oval(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
 function drawSymbol(c,symbol){
  c.strokeStyle=c.fillStyle='#F0F0FF';c.lineWidth=24;c.lineCap='round';c.lineJoin='round';
  if(symbol==='dot'||symbol==='dots'){for(const x of symbol==='dot'?[256]:[176,256,336])oval(c,x,256,18,18,'#F0F0FF');}
  else if(symbol==='question'||symbol==='exclamation'){c.font='bold 225px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(symbol==='question'?'?':'!',256,270);}
  else if(symbol==='sparkle'){c.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2,r=i%2?35:118;const x=256+Math.cos(a)*r,y=256+Math.sin(a)*r;i?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();c.fill();}
  else if(symbol==='crescent'){c.beginPath();c.arc(256,256,110,0,Math.PI*2);c.fill();oval(c,300,215,99,99,monochrome?'#383838':'#382052');}
  else if(symbol==='waves'){for(const y of [215,290]){c.beginPath();c.moveTo(145,y);c.bezierCurveTo(200,y-50,300,y+50,367,y);c.stroke();}}
  else {for(const x of [195,315]){c.beginPath();c.moveTo(x-25,215);c.quadraticCurveTo(x,177,x+25,215);c.stroke();}c.beginPath();c.moveTo(186,283);c.quadraticCurveTo(256,365,326,283);c.stroke();}
 }
 function setExpression(mood='content',blink=1,deltaSeconds=1/60){
  if(!MOODS[mood])mood='content';const token=MOODS[mood];target.set(monochrome?'#B8B8B8':token.color);
  accent.lerp(target,1-Math.exp(-Math.max(0,deltaSeconds)/.115));if(Math.abs(accent.r-target.r)+Math.abs(accent.g-target.g)+Math.abs(accent.b-target.b)<.002)accent.copy(target);
  const color='#'+accent.getHexString(),eyeOpen=Math.round(Math.max(.04,blink)*25)/25,key=[mood,eyeOpen,color].join(':');
  if(key!==lastFace){
   lastFace=key;const c=face.ctx;c.clearRect(0,0,512,512);oval(c,256,258,235,198,color);oval(c,256,258,225,188,'#F0F0FF');
   const smiling=mood==='delighted'||mood==='amused',sleepy=mood==='sleepy';c.strokeStyle=c.fillStyle='#100c19';c.lineWidth=13;c.lineCap='round';
   for(const x of [155,357]){c.save();c.translate(x,226);c.scale(1,eyeOpen*(sleepy?.45:1));
    if(smiling||sleepy){c.beginPath();c.moveTo(-32,9);c.quadraticCurveTo(0,smiling?-32:24,32,9);c.stroke();}
    else{oval(c,0,0,mood==='surprised'?35:32,mood==='curious'&&x===155?34:49,'#100c19');oval(c,-9,-20,8,11,'#FFFFFF');}
    c.restore();
   }
   if(mood==='anticipation'||mood==='concerned')for(const side of [-1,1]){const x=side<0?155:357;c.beginPath();c.moveTo(x-24,151+(mood==='concerned'?-side*10:side*10));c.lineTo(x+24,151-(mood==='concerned'?-side*10:side*10));c.stroke();}
   c.beginPath();if(mood==='surprised')oval(c,256,321,19,25,'#100c19');
   else if(smiling){const wide=mood==='amused';c.moveTo(wide?214:225,308);c.quadraticCurveTo(256,wide?391:370,wide?298:287,308);c.closePath();c.fillStyle='#100c19';c.fill();if(wide){c.strokeStyle='#F0F0FF';c.lineWidth=7;c.beginPath();c.moveTo(241,343);c.quadraticCurveTo(256,330,271,343);c.stroke();}}
   else{c.moveTo(231,mood==='concerned'?331:314);c.quadraticCurveTo(256,mood==='concerned'?307:342,281,mood==='concerned'?331:314);c.stroke();}
   for(const x of [112,400])oval(c,x,304,24,12,monochrome?'rgba(0,0,0,.07)':'rgba(145,70,255,.10)');face.texture.needsUpdate=true;
  }
  const backKey=token.symbol+color;
  if(backKey!==lastBack){lastBack=backKey;const c=back.ctx;c.clearRect(0,0,512,512);oval(c,256,256,236,224,color);oval(c,256,256,216,204,monochrome?'#383838':'#382052');drawSymbol(c,token.symbol);back.texture.needsUpdate=true;}
 }
 // Body material stays the concept purple. Grayscale is a temporary viewport filter only.
 function setMonochrome(value){monochrome=Boolean(value);lastFace=lastBack='';}
 setExpression('content',1,1);
 root.userData.sculptRuntime={nodes:{root,body},meshes:{shell,face:face.mesh,back:back.mesh},sockets:{palm:new THREE.Vector3()},colliders:[],destructionGroups:[]};
 return {root,body,feet,setExpression,setMonochrome,drawFace:(m,b)=>setExpression(m,b,1)};
}
