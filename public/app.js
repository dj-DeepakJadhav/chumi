import * as THREE from '/vendor/three.module.js';
import {createChumi, MOODS} from './mochi.js';
import {createPalmCamera} from './camera.js';
import {PalmTracker,containPoint} from './palm.js';
import {InteractionLoop} from './interaction.js';
import {createBroadcast} from './capture.js';
import {cameraHome} from './framing.js';

const CONTROL_KEY='chumi-control';
const hashMatch=location.hash.match(/(?:^#|&)control=([^&]+)/);
if(hashMatch){try{sessionStorage.setItem(CONTROL_KEY,decodeURIComponent(hashMatch[1]));}catch{} history.replaceState(null,'',location.pathname+location.search);}
const controlToken=sessionStorage.getItem(CONTROL_KEY)||'';
const controllerTab=Boolean(controlToken);
const clientId=crypto.randomUUID?.()||`chumi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let serverState=null,serverController=false,remoteActiveId=null,remoteLocalId=null,lastCompletedRemoteId=null,streamOffline=false;
const remoteHandled=new Set();
async function controllerAction(type,values={}){
  if(!controllerTab)return null;
  const response=await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json','X-Chumi-Control':controlToken},body:JSON.stringify({type,...values})});
  const data=await response.json().catch(()=>({ok:false,error:'Invalid server response'}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Request failed (${response.status})`);
  if(data.state)receiveServerState(data.state);
  return data;
}
function receiveServerState(state){
  if(!state||typeof state!=='object')return;
  serverState=state;
  const status=document.querySelector('#twitchStatus');
  if(status){
    const messages={disconnected:'Twitch disconnected',connecting:'Connecting to Twitch',connected:'Connected to Twitch',error:'Twitch connection error'};
    status.textContent=`${messages[state.connection]||'Twitch status unavailable'}${state.connectionMessage?`: ${state.connectionMessage}`:''}`;
    document.querySelector('#twitchConnect').textContent=state.connection==='connected'?'Disconnect Twitch':state.connection==='connecting'?'Connecting…':'Connect Twitch';
    document.querySelector('#twitchConnect').disabled=state.connection==='connecting';
    document.querySelector('#twitchQueue').textContent=`Queue: ${Number(state.queueCount)||0}`;
    document.querySelector('#localStatus').textContent=controllerTab?'Controller tab · camera required for Twitch actions':state.connection==='connected'?'Local preview · no Twitch actions in this tab':state.connection==='connecting'?'Local preview · Twitch connecting':state.connection==='error'?'Local preview · Twitch connection error':'Local preview · Twitch disconnected';
    const feedback=document.querySelector('#twitchFeedback');
    feedback.textContent=state.feedback?`${state.feedback.simulation||state.feedback.source==='simulation'?'Simulation':'Twitch'} ${state.feedback.kind}: ${state.feedback.name} — ${state.feedback.accepted?(state.feedback.reason||'accepted'):(state.feedback.reason||'rejected')}`:'No Twitch interactions accepted yet.';
    const badge=document.querySelector('.badge');
    badge.textContent=state.connection==='connected'?(controllerTab?'TWITCH CONNECTED · REAL CHAT':'TWITCH CONNECTED · READ-ONLY'):state.connection==='connecting'?'CONNECTING TO TWITCH':state.connection==='error'?'TWITCH CONNECTION ERROR':'TWITCH DISCONNECTED · LOCAL PREVIEW';
    document.querySelector('#status').textContent=controllerTab?`${cameraMode?'Controller camera · local hand inference.':'Controller is waiting for camera.'} Twitch ${state.connection}.`:`Local preview · Twitch ${state.connection}. Chat actions play only in the private camera controller.`;
  }
  if(!controllerTab)return;
  const baselineInput=document.querySelector('#expression'),quietControl=document.querySelector('#quiet'),pauseControl=document.querySelector('#interactionPause');
  if(baselineInput&&baselineInput.value!==state.baseline)baselineInput.value=state.baseline;
  if(quietControl)quietControl.checked=Boolean(state.quiet);
  if(pauseControl){pauseControl.textContent=state.paused?'Resume interactions':'Pause interactions';pauseControl.setAttribute('aria-pressed',String(Boolean(state.paused)));}
  const interactions=window.chumiInteractions;
  if(interactions){
    interactions.setBaseline(state.baseline);
    const now=window.chumiNow();
    if(interactions.snapshot.quiet!==Boolean(state.quiet))interactions.setQuiet(state.quiet,now);
    if(interactions.snapshot.paused!==Boolean(state.paused))interactions.setPaused(state.paused,now);
  }
  synchronizeRemoteInteraction();
}
function synchronizeRemoteInteraction(){
  const loop=window.chumiInteractions;
  if(!controllerTab||!loop||!serverState)return;
  const active=!streamOffline&&serverController&&cameraMode&& !document.hidden ? serverState.active:null;
  if(active){
    if(remoteActiveId!==active.id&&!remoteHandled.has(active.id)){
      if(loop.snapshot.active)loop.dismiss(window.chumiNow());
      remoteActiveId=active.id;remoteLocalId=null;markRemoteHandled(active.id);lastCompletedRemoteId=null;
      const result=loop.request(active.kind,window.chumiNow(),{requirePalm:cameraMode});
      if(result.accepted){remoteLocalId=result.id;window.chumiWakeClock?.();}
      const f=document.querySelector('#interactionFeedback');
      f.textContent=`${active.source==='simulation'?'Simulation':'Twitch'} ${active.kind} from ${active.name}: ${result.accepted?'started':result.reason}. ${active.kind==='snack'?'Offer your open palm.':'Playing at home.'}`;
    }
  }else if(remoteActiveId!==null){
    if(loop.snapshot.active)loop.dismiss(window.chumiNow());
    remoteActiveId=null;remoteLocalId=null;
  }
}
function markRemoteHandled(id){
  remoteHandled.add(id);
  while(remoteHandled.size>500){
    const oldest=remoteHandled.values().next().value;
    if(oldest===remoteActiveId){remoteHandled.delete(oldest);remoteHandled.add(oldest);continue;}
    remoteHandled.delete(oldest);
  }
}
function openStateStream(){
  fetch('/state').then(response=>response.json()).then(receiveServerState).catch(()=>{});
  if(!('EventSource'in window))return;
  const stream=new EventSource('/events');
  stream.addEventListener('state',event=>{try{receiveServerState(JSON.parse(event.data));}catch{}});
  stream.onopen=()=>{
    streamOffline=false;
    fetch('/state').then(response=>response.json()).then(state=>{receiveServerState(state);window.chumiClaimNow?.();}).catch(()=>{});
  };
  stream.onerror=()=>{
    if(streamOffline)return;
    streamOffline=true;serverController=false;synchronizeRemoteInteraction();
    const label=document.querySelector('#twitchStatus');
    if(label)label.textContent='Twitch status stream disconnected; reconnecting…';
    const badge=document.querySelector('.badge');if(badge)badge.textContent='TWITCH STATUS STREAM LOST';
    const status=document.querySelector('#status');if(status)status.textContent='Twitch status stream disconnected; reconnecting.';
  };
}
function localTwitchNote(){
  const connection=serverState?.connection;
  if(connection==='connected')return controllerTab?' Twitch commands use the camera controller.':' Twitch actions are unavailable in this tab.';
  if(connection==='connecting')return ' Twitch is connecting.';
  if(connection==='error')return ' Twitch reported a connection error.';
  if(connection==='disconnected')return ' Twitch is disconnected.';
  return ' Twitch status is loading.';
}

const host=document.querySelector('#scene');
const status=document.querySelector('#status');
const expression=document.querySelector('#expression');
const pauseButton=document.querySelector('#pause');
const reducedInput=document.querySelector('#reduced');
const monochromeInput=document.querySelector('#monochrome');
const clockLabel=document.querySelector('#clock');
const phaseLabel=document.querySelector('#phase');
const actionButtons=[...document.querySelectorAll('[data-action]')];
const interactionPause=document.querySelector('#interactionPause'),dismissButton=document.querySelector('#dismiss'),quietInput=document.querySelector('#quiet'),feedback=document.querySelector('#interactionFeedback');
const video=document.querySelector('#cameraVideo'),stage=document.querySelector('#stage');
const cameraStart=document.querySelector('#cameraStart'),cameraStop=document.querySelector('#cameraStop'),cameraStatus=document.querySelector('#cameraStatus'),palmStatus=document.querySelector('#palmStatus');
const connectButton=document.querySelector('#twitchConnect');
let cameraMode=false,cameraBusy=false;
if(controllerTab){connectButton.hidden=false;document.querySelector('#localStatus').textContent='Controller tab · camera required for Twitch actions';feedback.textContent='Connect Twitch and start the camera to accept chat commands.';document.querySelector('aside > .note').textContent='Keep this camera controller visible for Twitch actions. Snacks wait for your real palm. Surprise and cheer play at home. Local buttons remain previews.';}
openStateStream();
if(controllerTab)connectButton.addEventListener('click',async()=>{
  connectButton.disabled=true;
  try{await controllerAction(serverState?.connection==='connected'?'disconnect':'connect');}
  catch(error){document.querySelector('#twitchStatus').textContent=`Twitch action failed: ${error.message}`;}
  finally{connectButton.disabled=serverState?.connection==='connecting';}
});

try {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(34,1,.1,50);
  const arCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);arCamera.position.set(0,0,100);arCamera.lookAt(0,0,0);
  const chumi=createChumi();
  scene.add(chumi.root);
  scene.add(new THREE.HemisphereLight(0xffffff,0x9e87ba,1.4));
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(-3,5,5);scene.add(key);
  const rim=new THREE.DirectionalLight(0xe4d6ff,2);rim.position.set(3,3,-2);scene.add(rim);

  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
  const ctx=shadowCanvas.getContext('2d');
  const gradient=ctx.createRadialGradient(64,64,2,64,64,64);
  gradient.addColorStop(0,'rgba(65,25,100,.27)');gradient.addColorStop(1,'rgba(65,25,100,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3,1.6),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=-.015;scene.add(shadow);

  const starShape=new THREE.Shape();
  for(let i=0;i<10;i++){
    const angle=Math.PI/2+i*Math.PI/5,radius=i%2?.12:.25;
    const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
    if(i===0)starShape.moveTo(x,y);else starShape.lineTo(x,y);
  }
  starShape.closePath();
  const snack=new THREE.Mesh(new THREE.ExtrudeGeometry(starShape,{depth:.07,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1}),new THREE.MeshStandardMaterial({color:0xf0f0ff,roughness:.45}));
  snack.visible=false;scene.add(snack);
  const surprise=new THREE.Group();
  const box=new THREE.Mesh(new THREE.BoxGeometry(.42,.34,.4),new THREE.MeshStandardMaterial({color:0x69ffc3,roughness:.65}));
  box.position.y=.17;surprise.add(box);
  const ribbon=new THREE.Mesh(new THREE.BoxGeometry(.075,.36,.42),new THREE.MeshStandardMaterial({color:0x9146ff,roughness:.65}));
  ribbon.position.y=.18;surprise.add(ribbon);surprise.visible=false;scene.add(surprise);
  const propColors=[snack.material.color.clone(),box.material.color.clone(),ribbon.material.color.clone()];

  for(const [id,mood] of Object.entries(MOODS)){
    const option=document.createElement('option');option.value=id;option.textContent=mood.label;expression.append(option);
  }
  expression.value='content';
  reducedInput.checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let elapsed=0,lastFrame=null,paused=false,lastPhase='',currentView='three-quarter',lastResult='';
  const interactions=new InteractionLoop();
  const interactionNow=()=>cameraMode?performance.now():elapsed*1000;
  window.chumiInteractions=interactions;window.chumiNow=interactionNow;window.chumiWakeClock=()=>{paused=false;lastFrame=null;};
  if(controllerTab&&serverState){
    expression.value=serverState.baseline;quietInput.checked=Boolean(serverState.quiet);
    interactionPause.setAttribute('aria-pressed',String(Boolean(serverState.paused)));
    interactions.setBaseline(serverState.baseline);interactions.setQuiet(serverState.quiet,interactionNow());interactions.setPaused(serverState.paused,interactionNow());
  }
  if(controllerTab){
    let claimBusy=false;
    const claim=async()=>{
      if(claimBusy)return;claimBusy=true;
      try{
        const result=await controllerAction('claim',{clientId,ready:cameraMode&&!document.hidden&&!streamOffline});
        serverController=Boolean(result.controller);
        synchronizeRemoteInteraction();
      }catch(error){serverController=false;document.querySelector('#twitchStatus').textContent=`Controller lease unavailable: ${error.message}`;synchronizeRemoteInteraction();}
      finally{claimBusy=false;}
    };
    claim();setInterval(claim,1000);
    window.chumiClaimNow=claim;
  }
  function resetDomain(){interactions.reset(interactionNow());interactions.setBaseline(expression.value);interactions.setQuiet(quietInput.checked,interactionNow());interactions.setPaused(interactionPause.getAttribute('aria-pressed')==='true',interactionNow());lastResult='';}
  const tracker=new PalmTracker();let frameCount=0,stableCount=0;
  const arPose={position:new THREE.Vector3(),from:new THREE.Vector3(),attached:false,hopStart:0,scale:38};
  const broadcast=createBroadcast({video,canvas:renderer.domElement,getSize:()=>({width:host.clientWidth,height:host.clientHeight}),getState:()=>({cameraOn:cameraMode,visible:!document.hidden,caption:remoteActiveId&&serverState?.active?`${serverState.active.source==='simulation'?'Simulation · ':''}${serverState.active.name} · ${serverState.active.kind}`:''})});
  const broadcastFeedback=document.querySelector('#broadcastFeedback'),broadcastClose=document.querySelector('#broadcastClose'),broadcastFit=document.querySelector('#broadcastFit');
  document.querySelector('#broadcastControls').hidden=!controllerTab;
  document.querySelector('#broadcastOpen').addEventListener('click',()=>{
    const opened=broadcast.open();broadcastClose.disabled=!opened;
    broadcastFeedback.textContent=opened?'Capture the Chumi Broadcast window in OBS. Keep this controller visible; only it uses the camera.':'Popup blocked or video output unavailable. Allow this local popup, then try again.';
    applyPose(0);
  });
  broadcastClose.addEventListener('click',()=>{broadcast.stop();broadcastClose.disabled=true;broadcastFeedback.textContent='Broadcast closed. Camera and Twitch controls remain here.';});
  broadcastFit.addEventListener('click',()=>{const requested=broadcast.fitWindow();broadcastFeedback.textContent=requested?'Landscape size requested. In OBS, crop the browser bar and fit the source.':'Resize the output window to landscape, then crop its browser bar in OBS.';});
  function homeLayout(){return cameraHome(video.videoWidth||640,video.videoHeight||480,Math.max(1,host.clientWidth),Math.max(1,host.clientHeight));}
  function home(){const pose=homeLayout();return new THREE.Vector3(pose.x,pose.y,0);}
  const palmCamera=createPalmCamera({video,onResult:({landmarks,timestamp})=>{
    frameCount++;const result=tracker.update(landmarks,timestamp,video.videoWidth||640,video.videoHeight||480);if(result.state==='stable')stableCount++;
  },onStatus:({state,message})=>{
    cameraBusy=state==='starting';cameraMode=state==='running';cameraStatus.textContent=message;resetDomain();
    if(state==='stopped'||state==='error')feedback.textContent='Camera session ended; active and pending interactions were cleared.';
    cameraStart.disabled=cameraMode||cameraBusy;cameraStop.disabled=!cameraMode&&!cameraBusy;video.hidden=!cameraMode;stage.classList.toggle('camera-on',cameraMode);document.querySelector('#viewLabel').textContent=cameraMode?'LIVE PALM':currentView.toUpperCase();
    if(!controllerTab&&serverState?.connection!=='connected')document.querySelector('.badge').textContent=cameraMode?'LIVE CAMERA · TWITCH DISCONNECTED · LOCAL PREVIEW':cameraBusy?'STARTING CAMERA · LOCAL PREVIEW':'LOCAL PREVIEW · CAMERA OFF · TWITCH DISCONNECTED';
    tracker.reset();frameCount=stableCount=0;arPose.attached=false;arPose.position.copy(home());arPose.scale=homeLayout().scale;
    palmStatus.textContent=cameraMode?'Hold an open hand still for 0.4 seconds.':'No hand tracking yet.';
    if(!cameraMode){chumi.root.scale.setScalar(1);shadow.visible=true;}
    lastPhase='';updateControls();resize();if(controllerTab)window.chumiClaimNow?.();
  }});
  cameraStart.addEventListener('click',()=>{finish();paused=false;lastFrame=null;document.querySelector('#small').checked=false;monochromeInput.checked=false;chumi.setMonochrome(false);[snack.material,box.material,ribbon.material].forEach((material,index)=>material.color.copy(propColors[index]));host.style.filter='none';palmCamera.start();});
  cameraStop.addEventListener('click',()=>palmCamera.stop());
  window.addEventListener('pagehide',()=>palmCamera.stop());
  const clamp=value=>Math.max(0,Math.min(1,value));
  const smooth=value=>{const n=clamp(value);return n*n*(3-2*n);};

  // A fixed sequence gives irregular intervals without nondeterministic captures.
  function blinkAt(time){
    const cycle=time%22.5;
    for(const start of [4.6,10.1,16.5,21.9]){
      const age=cycle-start;
      if(age>=0&&age<.16)return Math.abs(age/.08-1);
    }
    return 1;
  }
  function setPhase(phase){
    if(phaseLabel.textContent!==phase)phaseLabel.textContent=phase;
    if(phase!==lastPhase){status.textContent=controllerTab?`${cameraMode?'Controller camera · local hand inference.':'Controller is waiting for camera.'} Twitch ${serverState?.connection||'disconnected'}.`:cameraMode?`Live camera · local hand inference.${localTwitchNote()}`:`Local preview: ${phase}. Camera is not connected.${localTwitchNote()}`;lastPhase=phase;}
  }
  function updateControls(snapshot=interactions.snapshot){
    broadcastClose.disabled=!broadcast.isOpen;broadcastFit.disabled=!broadcast.isOpen;
    pauseButton.textContent=paused?'Resume motion':'Pause motion';
    pauseButton.setAttribute('aria-pressed',String(paused));
    actionButtons.forEach(button=>button.disabled=cameraBusy||snapshot.paused||snapshot.quiet||(snapshot.active&&button.dataset.action!=='cheer'));
    interactionPause.textContent=snapshot.paused?'Resume interactions':'Pause interactions';interactionPause.setAttribute('aria-pressed',String(snapshot.paused));
    dismissButton.disabled=!snapshot.active&&!snapshot.pendingCheer;
    const actionMode=cameraMode?'LOCAL CAMERA INPUT · REAL PALM':'LOCAL PREVIEWS · VIRTUAL PALM';if(document.querySelector('#actionMode').textContent!==actionMode)document.querySelector('#actionMode').textContent=actionMode;
    document.querySelectorAll('[data-view],#pause,#reset,#inspect,#inspectTime,#small,#monochrome').forEach(control=>control.disabled=cameraMode||cameraBusy);
  }
  function finish(){interactions.dismiss(interactionNow());snack.visible=false;surprise.visible=false;updateControls();}
  let orbitReady=false;
  const orbitTrack=document.querySelector('.orbit-track');
  function positionReactions(activeCamera){
    // Targets follow Chumi but freeze under pointer/keyboard focus for reliable clicks.
    if(orbitReady&&actionButtons.some(button=>button.matches(':hover')||button===document.activeElement))return;
    activeCamera.updateMatrixWorld();chumi.root.updateWorldMatrix(true,false);
    const project=(x,y)=>chumi.root.localToWorld(new THREE.Vector3(x,y,0)).project(activeCamera);
    const center=project(0,.72),left=project(-1.12,.72),right=project(1.12,.72),top=project(0,1.46),bottom=project(0,.06);
    const width=host.clientWidth,height=host.clientHeight,cx=(center.x*.5+.5)*width,cy=(-center.y*.5+.5)*height;
    const halfWidth=Math.abs(right.x-left.x)*width/4,halfHeight=Math.abs(top.y-bottom.y)*height/4;
    const rx=Math.max(132,halfWidth+54),ry=Math.max(112,Math.min(130,halfHeight+48));
    orbitTrack.style.left=cx+'px';orbitTrack.style.top=cy+'px';orbitTrack.style.width=rx*2+'px';orbitTrack.style.height=ry*2+'px';
    const preferred=cy<85?[150,90,30]:cx>width*.7?[180,235,290]:cx<width*.3?[0,305,250]:[180,270,0];
    const placed=[];let fallback=false;
    actionButtons.forEach((button,index)=>{
      let best=null;
      for(const degrees of [...preferred,...Array.from({length:12},(_,i)=>i*30)]){
        const angle=degrees*Math.PI/180,x0=cx+Math.cos(angle)*rx,y0=cy+Math.sin(angle)*ry;
        const half=button.offsetWidth/2;
        const x=Math.max(half+10,Math.min(width-half-10,x0)),y=Math.max(49,Math.min(height-92,y0));
        const overlap=placed.some(p=>Math.abs(p.x-x)<p.half+half+8&&Math.abs(p.y-y)<52);
        if(overlap)continue;
        const onBody=((x-cx)/(halfWidth+40))**2+((y-cy)/(halfHeight+23))**2<1;
        const deviation=1-Math.cos((degrees-preferred[index])*Math.PI/180);
        const cost=Math.hypot(x-x0,y-y0)*3+deviation*30+(overlap?10000:0)+(onBody?1000:0);
        if(!best||cost<best.cost)best={x,y,cost,half};
      }
      if(!best){fallback=true;best={x:(index+.5)*width/3,y:55,half:button.offsetWidth/2};}
      if(width<330){fallback=true;}
      placed.push(best);button.style.left=best.x+'px';button.style.top=best.y+'px';
    });
    if(fallback)actionButtons.forEach((button,index)=>{button.style.left=(index+.5)*width/3+'px';button.style.top='55px';});
    orbitReady=true;
  }
  function applyPose(delta){
    const now=interactionNow(),tracking=cameraMode?tracker.sample(performance.now()):null;
    const palmAvailable=Boolean(tracking?.anchor&&['stable','grace'].includes(tracking.state));
    const snapshot=interactions.update(now,{palmAvailable});
    const reduced=reducedInput.checked||snapshot.paused||snapshot.quiet;
    chumi.root.position.set(0,0,0);chumi.root.rotation.set(0,0,0);chumi.root.scale.setScalar(document.querySelector('#small').checked?.35:1);
    chumi.body.scale.set(1,1,1);chumi.body.rotation.set(0,0,0);
    chumi.feet.forEach(foot=>foot.rotation.set(0,0,0));
    snack.visible=false;surprise.visible=false;
    snack.scale.setScalar(1);snack.position.set(1.3,1.25,.5);snack.rotation.set(0,0,.1);
    surprise.position.set(.05,.03,.32);surprise.scale.setScalar(1);surprise.rotation.set(0,0,0);
    const labels={idle:'Idle',notice:'Snack noticed',waitingHand:'Waiting for your palm',hopping:'Hop',landing:'Landing',feeding:'Nibble',celebrating:'Celebrate',returning:'Returning home',hiding:'Hide',anticipating:'Ready…',revealing:'Surprise reveal',settling:'Settle',cheering:'Cheer'};
    let mood=snapshot.mood,phase=snapshot.paused?'Interactions paused':snapshot.quiet?'Quiet mode':labels[snapshot.phase];
    phaseLabel.dataset.phase=snapshot.phase;
    if(!reduced){
      const breath=Math.sin(elapsed*Math.PI/2)*.018;
      chumi.body.scale.set(1-breath*.45,1+breath,1-breath*.25);
      const wiggleTime=elapsed%24;
      if(wiggleTime>19&&wiggleTime<20.2){
        const wiggle=Math.sin((wiggleTime-19)*Math.PI/1.2)*Math.sin((wiggleTime-19)*Math.PI*6)*.11;
        chumi.feet[0].rotation.z=wiggle;chumi.feet[1].rotation.z=-wiggle;
      }
    }
    const p=snapshot.phaseProgress,age=snapshot.phaseAge;
    if(snapshot.kind==='cheer'){
      if(!reduced){chumi.body.rotation.z=Math.sin(age*14)*.07*Math.sin(p*Math.PI);chumi.root.position.y=Math.abs(Math.sin(age*7))*.10*Math.sin(p*Math.PI);}
    }else if(snapshot.kind==='snack'){
      if(['notice','waitingHand','hopping','landing','feeding'].includes(snapshot.phase)){
        snack.visible=true;const approach=snapshot.phase==='feeding'?smooth(p/.6):0;
        snack.position.set(1.35*(1-approach),1.2-.55*approach,.5+.30*approach);
        if(snapshot.phase==='feeding'){snack.scale.setScalar(1-smooth((p-.35)/.65));}
      }
      if(!reduced){
        if(snapshot.phase==='hopping')chumi.root.position.y=Math.sin(p*Math.PI)*.24;
        if(snapshot.phase==='landing'){const squish=Math.sin(p*Math.PI)*.08;chumi.body.scale.set(1+squish*.5,1-squish,1);}
        if(snapshot.phase==='feeding'){const nibble=Math.sin(p*Math.PI*4)*.025;chumi.body.scale.set(1-nibble*.5,1+nibble,1);}
        if(snapshot.phase==='celebrating'){const squish=Math.sin(p*Math.PI)*.08;chumi.body.scale.set(1+squish*.5,1-squish,1);}
      }
    }else if(snapshot.kind==='surprise'){
      if(['revealing','settling'].includes(snapshot.phase)){surprise.visible=true;surprise.position.x=.85*(snapshot.phase==='revealing'?smooth(p):1);}
      if(!reduced){
        if(['hiding','anticipating'].includes(snapshot.phase)){const squash=.4*(snapshot.phase==='hiding'?smooth(p):1);chumi.body.scale.set(1+squash*.25,1-squash,1+squash*.1);}
        if(snapshot.phase==='hopping')chumi.root.position.y=Math.sin(p*Math.PI/2)*.65;
        if(snapshot.phase==='revealing')chumi.root.position.y=.65*(1-smooth(p));
        if(snapshot.phase==='settling')chumi.body.rotation.z=Math.sin(p*Math.PI*2)*.03;
      }
    }
    chumi.setExpression(mood,blinkAt(elapsed),delta);
    // Restore the playground floor after leaving the screen-space camera view.
    shadow.rotation.set(-Math.PI/2,0,0);shadow.position.set(0,-.015,0);shadow.scale.setScalar(1);
    shadow.material.opacity=Math.max(.35,1-chumi.root.position.y*.6);
    const clockText=`${elapsed.toFixed(1)} s${paused?' · paused':''}`;if(clockLabel.textContent!==clockText)clockLabel.textContent=clockText;
    if(cameraMode){
      const wallNow=performance.now();
      const layout=homeLayout();
      const mapped=containPoint(tracking.anchor,video.videoWidth,video.videoHeight,host.clientWidth,host.clientHeight,true);
      const attached=Boolean(mapped&&palmAvailable&&snapshot.kind==='snack'&&['hopping','landing','feeding','celebrating'].includes(snapshot.phase));
      const destination=attached?new THREE.Vector3(mapped.x-host.clientWidth/2,host.clientHeight/2-mapped.y,0):home();
      if(attached&&!arPose.attached){arPose.from.copy(arPose.position);arPose.hopStart=wallNow;}
      arPose.attached=attached;
      const hopProgress=snapshot.phase==='hopping'?snapshot.phaseProgress:1;
      if(attached&&hopProgress<1){arPose.position.lerpVectors(arPose.from,destination,smooth(hopProgress));if(!reduced)arPose.position.y+=Math.sin(hopProgress*Math.PI)*layout.frame.height*.1;}
      else arPose.position.lerp(destination,1-Math.exp(-Math.max(0,delta)/.10));
      const size=attached?Math.max(layout.frame.width*.075/2.24,Math.min(layout.frame.width*.24/2.24,mapped.width*.95/2.24)):layout.scale;arPose.scale+=(size-arPose.scale)*(1-Math.exp(-Math.max(0,delta)/.12));
      const actionLift=chumi.root.position.y*arPose.scale;chumi.root.position.copy(arPose.position);if(snapshot.kind==='surprise'||snapshot.kind==='cheer')chumi.root.position.y+=actionLift;chumi.root.scale.setScalar(arPose.scale);
      // A modest three-quarter turn reveals shell depth without hiding the face.
      // Palm width already drives smoothed scale: closer hands make Chumi larger.
      const travelSign=Math.sign(destination.x-arPose.from.x)||1;
      const turn=!reduced&&snapshot.phase==='hopping'?Math.sin(p*Math.PI)*travelSign*.48:0;
      chumi.root.rotation.y=.24+turn;
      if(!reduced){
        if(attached){
          const balance=Math.max(-.08,Math.min(.08,(destination.x-arPose.position.x)/Math.max(1,layout.frame.width)*1.5));
          chumi.root.rotation.z=-balance+Math.sin(elapsed*2.4)*.015;
          chumi.root.rotation.x=snapshot.phase==='feeding'?-.10+Math.sin(p*Math.PI*4)*.035:.06;
          if(snapshot.phase==='landing'){
            const impact=Math.sin(p*Math.PI)*.16;
            chumi.body.scale.set(1+impact*.55,1-impact,1+impact*.4);
            chumi.feet.forEach((foot,index)=>{foot.rotation.z=(index?1:-1)*impact*.35;});
          }
        }else if(snapshot.kind==='surprise')chumi.root.rotation.y+=Math.sin(p*Math.PI)*.35;
      }
      // Stylized contact cue, not an inferred real-world light/occlusion shadow.
      // Keep it on the palm plane while Chumi lifts away from that plane.
      shadow.visible=attached;
      if(attached){
        const lift=Math.max(0,chumi.root.position.y-destination.y)/Math.max(1,arPose.scale);
        shadow.rotation.set(0,0,0);shadow.position.set(destination.x,destination.y+arPose.scale*.035,-2);
        shadow.scale.set(arPose.scale*(.68+Math.min(1,lift)*.24),arPose.scale*.18,1);
        shadow.material.opacity=.85/(1+lift*2);
      }
      if(snack.visible){snack.position.multiplyScalar(arPose.scale).add(chumi.root.position);snack.scale.multiplyScalar(arPose.scale);}
      if(surprise.visible){surprise.position.multiplyScalar(arPose.scale).add(arPose.position);surprise.scale.multiplyScalar(arPose.scale);}
      const label=tracking.state==='stable'?'Open hand stable':tracking.state==='grace'?'Brief tracking loss':tracking.state==='acquiring'?'Hold still…':'Show an open hand';
      palmStatus.textContent=`${label} · ${frameCount} frames examined · ${stableCount} stable observations`;
      if(snapshot.phase==='idle'&&!snapshot.paused&&!snapshot.quiet)phase='Idle · send a snack';
    }else shadow.visible=true;
    if(snapshot.phase==='waitingHand')phase+=` · ${Math.max(0,Math.ceil(15-snapshot.phaseAge))} s`;
    if(snapshot.pendingCheer)phase+=' · cheer queued';
    setPhase(phase);updateControls(snapshot);
    if(snapshot.lastResult){const key=snapshot.lastResult.id+':'+snapshot.lastResult.outcome;if(key!==lastResult){lastResult=key;feedback.textContent=`${snapshot.lastResult.kind}: ${snapshot.lastResult.outcome}.${controllerTab?'':localTwitchNote()}`;}
      if(controllerTab&&remoteLocalId===snapshot.lastResult.id&&lastCompletedRemoteId!==remoteActiveId){
        const completedId=remoteActiveId;lastCompletedRemoteId=completedId;
        controllerAction('complete',{clientId,id:completedId,outcome:snapshot.lastResult.outcome}).catch(error=>{feedback.textContent=`Could not report Twitch completion: ${error.message}`;});
      }
    }
    positionReactions(cameraMode?arCamera:camera);
    renderer.render(scene,cameraMode?arCamera:camera);
    broadcast.draw();
  }
  function resize(){
    const width=host.clientWidth,height=host.clientHeight;orbitReady=false;
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();arCamera.left=-width/2;arCamera.right=width/2;arCamera.top=height/2;arCamera.bottom=-height/2;arCamera.updateProjectionMatrix();applyPose(0);
  }
  function view(name){
    currentView=name;
    const angle=name==='back'?Math.PI:name==='front'?0:.32;
    camera.position.set(Math.sin(angle)*5.1,2.15,Math.cos(angle)*5.1);camera.lookAt(0,.7,0);
    document.querySelector('#viewLabel').textContent=name.toUpperCase();
    document.querySelectorAll('[data-view]').forEach(button=>{const selected=button.dataset.view===name;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    applyPose(0);
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.view)));
  expression.addEventListener('change',()=>{if(controllerTab){controllerAction('baseline',{mood:expression.value}).catch(error=>{feedback.textContent=`Baseline update failed: ${error.message}`;});}else interactions.setBaseline(expression.value);applyPose(paused?1:0);});
  actionButtons.forEach(button=>button.addEventListener('click',()=>{
    const result=interactions.request(button.dataset.action,interactionNow(),{requirePalm:cameraMode});
    feedback.textContent=`Local preview — ${button.dataset.action}: ${result.reason}. ${cameraMode?'Real palm input.':'Virtual palm preview.'}${controllerTab?' Twitch events require the controller camera.':localTwitchNote()}`;
    if(result.accepted){paused=false;lastFrame=null;}updateControls();applyPose(0);
  }));
  interactionPause.addEventListener('click',()=>{
    if(controllerTab){controllerAction('pause',{value:!Boolean(serverState?.paused)}).then(()=>{feedback.textContent=serverState?.paused?'Interactions cancelled and paused.':'Interactions resumed; cancelled input will not replay.';}).catch(error=>{feedback.textContent=`Pause update failed: ${error.message}`;});return;}
    interactions.setPaused(!interactions.snapshot.paused,interactionNow());feedback.textContent=interactions.snapshot.paused?'Interactions cancelled and paused.':'Interactions resumed; cancelled input will not replay.';updateControls();applyPose(1);
  });
  quietInput.addEventListener('change',()=>{
    if(controllerTab){controllerAction('quiet',{value:quietInput.checked}).then(()=>{feedback.textContent=quietInput.checked?'Quiet mode: playful input cancelled and disabled.':'Quiet mode off; old input will not replay.';}).catch(error=>{feedback.textContent=`Quiet mode update failed: ${error.message}`;});return;}
    interactions.setQuiet(quietInput.checked,interactionNow());feedback.textContent=quietInput.checked?'Quiet mode: playful input cancelled and disabled.':'Quiet mode off; old input will not replay.';updateControls();applyPose(1);
  });
  dismissButton.addEventListener('click',()=>{
    if(controllerTab){controllerAction('dismiss').then(()=>{finish();feedback.textContent='Twitch interaction dismissed.';applyPose(1);}).catch(error=>{feedback.textContent=`Dismiss failed: ${error.message}`;});return;}
    finish();feedback.textContent='Interaction and pending cheer dismissed.';applyPose(1);
  });
  pauseButton.addEventListener('click',()=>{paused=!paused;lastFrame=null;updateControls();applyPose(0);});
  document.querySelector('#reset').addEventListener('click',()=>{
    elapsed=0;paused=true;lastFrame=null;interactions.reset(0);quietInput.checked=false;expression.value='content';lastResult='';document.querySelector('#inspectTime').value='0';feedback.textContent='Reset to a clean local preview.';updateControls();applyPose(1);
  });
  document.querySelector('#inspect').addEventListener('click',()=>{
    const input=document.querySelector('#inspectTime'),time=Number(input.value);
    if(!input.checkValidity()||!Number.isFinite(time))return;
    const baseline=expression.value,wasPaused=interactions.snapshot.paused;elapsed=Math.max(0,Math.min(30,time));interactions.reset(elapsed*1000);interactions.setBaseline(baseline);interactions.setQuiet(quietInput.checked,elapsed*1000);interactions.setPaused(wasPaused,elapsed*1000);paused=true;lastFrame=null;lastResult='';updateControls();applyPose(1);
  });
  reducedInput.addEventListener('change',()=>applyPose(0));
  monochromeInput.addEventListener('change',()=>{
    const enabled=monochromeInput.checked;chumi.setMonochrome(enabled);host.style.filter=enabled?'grayscale(1)':'none';
    [snack.material,box.material,ribbon.material].forEach((material,index)=>{
      material.color.copy(propColors[index]);if(enabled){const gray=material.color.r*.2126+material.color.g*.7152+material.color.b*.0722;material.color.setRGB(gray,gray,gray);}
    });applyPose(paused?1:0);
  });
  document.querySelector('#small').addEventListener('change',event=>{chumi.root.scale.setScalar(event.target.checked?.35:1);applyPose(0);});
  document.addEventListener('visibilitychange',()=>{lastFrame=null;broadcast.draw();if(controllerTab)window.chumiClaimNow?.();});
  new ResizeObserver(resize).observe(host);view('three-quarter');resize();updateControls();
  function frame(now){
    const delta=lastFrame===null?0:Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    if(!paused&&!document.hidden){elapsed+=delta;applyPose(delta);}
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch(error){status.textContent=`Chumi could not load: ${error.message}. Try a browser with WebGL enabled.`;console.error(error);}
