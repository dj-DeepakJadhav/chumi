import './config.mjs';
// Local-only Chumi server and read-only Twitch bridge.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,chmod} from 'node:fs/promises';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {ChumiQueue} from './chumi-queue.mjs';
const port=Number(process.env.PORT||3114);
const files=new Map([
  ['/', ['public/index.html','text/html; charset=utf-8']],
  ['/app.js', ['public/app.js','text/javascript']],
  ['/mochi.js', ['public/mochi.js','text/javascript']],
  ['/style.css', ['public/style.css','text/css']],
  ['/camera.js', ['public/camera.js','text/javascript']],
  ['/palm.js', ['public/palm.js','text/javascript']],
  ['/interaction.js', ['public/interaction.js','text/javascript']],
  ['/capture.js', ['public/capture.js','text/javascript']],
  ['/framing.js', ['public/framing.js','text/javascript']],
  ['/broadcast', ['public/broadcast.html','text/html; charset=utf-8']],
  ['/broadcast.js', ['public/broadcast.js','text/javascript']],
  ['/broadcast.css', ['public/broadcast.css','text/css']],
  ['/models/hand_landmarker.task', ['assets/models/hand_landmarker.task','application/octet-stream']],
  ['/vendor/vision_bundle.mjs', ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs','text/javascript']],
  ['/vendor/three.module.js', ['node_modules/three/build/three.module.js','text/javascript']],
  ['/vendor/three.core.js', ['node_modules/three/build/three.core.js','text/javascript']],
  ['/concept.png', ['assets/concepts/mochi-visual-guide-v1.png','image/png']]
]);
for(const name of ['vision_wasm_internal','vision_wasm_module_internal','vision_wasm_nosimd_internal']){
  files.set(`/vendor/wasm/${name}.js`,[`node_modules/@mediapipe/tasks-vision/wasm/${name}.js`,'text/javascript']);
  files.set(`/vendor/wasm/${name}.wasm`,[`node_modules/@mediapipe/tasks-vision/wasm/${name}.wasm`,'application/wasm']);
}
export function createChumiServer({port=3114,token=randomBytes(32).toString('hex'),simulation=false}={}){
  const queue=new ChumiQueue(),clients=new Set();let child=null,connection='disconnected',connectionMessage='Twitch disconnected',lastState='';
  const state=()=>({connection,connectionMessage,...queue.state,simulation});
  const publish=()=>{const data=JSON.stringify(state());if(data===lastState)return;lastState=data;for(const client of clients)client.write(`event: state\ndata: ${data}\n\n`);};
  const origins=new Set([`http://localhost:${port}`,`http://127.0.0.1:${port}`]);
  const hosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`]);
  const json=(res,status,data)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(data));
  function startTwitch(){
    if(child)return;
    connection='connecting';connectionMessage='Connecting to Twitch…';publish();
    const next=spawn(process.execPath,['scripts/twitch.mjs','listen'],{cwd:new URL('.',import.meta.url),env:{...process.env,CHUMI_BRIDGE:'1',HULL_BRIDGE:'0'},stdio:['ignore','pipe','pipe']});child=next;
    createInterface({input:next.stdout}).on('line',line=>{
      if(child!==next)return;
      try{if(line.startsWith('CHUMI_EVENT ')){queue.receive(JSON.parse(line.slice(12)));publish();}
      else if(line.startsWith('CHUMI_STATUS ')){const data=JSON.parse(line.slice(13));if(['connected','connecting','disconnected','error'].includes(data.state)){connection=data.state;connectionMessage=String(data.message).slice(0,180);publish();}}}catch{connection='error';connectionMessage='Invalid Twitch bridge message';publish();}
    });
    createInterface({input:next.stderr}).on('line',()=>{if(child===next){connection='error';connectionMessage='Twitch connection failed. Check authorization and internet, then reconnect.';publish();}});
    next.on('error',()=>{if(child===next){child=null;connection='error';connectionMessage='Could not start Twitch listener';publish();}});
    next.on('exit',()=>{if(child===next){child=null;connection='disconnected';connectionMessage='Twitch listener stopped. Reconnect, or run npm run twitch:auth if authorization expired.';publish();}});
  }
  const server=createServer(async(req,res)=>{
    if(!hosts.has(req.headers.host)){json(res,403,{error:'Invalid Host'});return;}
    if(req.headers.origin&&!origins.has(req.headers.origin)){json(res,403,{error:'Invalid Origin'});return;}
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/state'){json(res,200,state());return;}
    if(req.method==='GET'&&path==='/events'){
      if(clients.size>=16){json(res,429,{error:'Too many streams'});return;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
    }
    if(req.method==='POST'&&path==='/action'){
      const given=req.headers['x-chumi-control'];
      if(req.headers.origin&&!origins.has(req.headers.origin)||typeof given!=='string'||!/^[a-f0-9]{64}$/.test(given)||given.length!==token.length||!timingSafeEqual(Buffer.from(given),Buffer.from(token))){json(res,403,{error:'Private streamer authorization required'});return;}
      if(req.headers['content-type']!=='application/json'){json(res,415,{error:'JSON required'});return;}
      let body='',size=0;try{for await(const part of req){size+=part.length;if(size>2048){json(res,413,{error:'Request too large'});return;}body+=part;}const a=JSON.parse(body);
        if(!a||typeof a!=='object'||Array.isArray(a))throw Error();
        let result={ok:true};
        if(a.type==='connect')startTwitch();
        else if(a.type==='disconnect'){const old=child;child=null;old?.kill('SIGTERM');connection='disconnected';connectionMessage='Twitch disconnected';queue.clear('disconnected');}
        else if(a.type==='claim'){
          if(typeof a.clientId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(a.clientId)||typeof a.ready!=='boolean')throw Error();
          result.controller=queue.claim(a.clientId,a.ready);
        }else if(a.type==='complete'){
          if(!queue.complete(a.clientId,a.id,a.outcome)){json(res,409,{error:'Stale interaction or renderer'});return;}
        }else if(a.type==='simulate'){
          if(!simulation){json(res,403,{error:'Simulation disabled'});return;}
          const outcome=queue.receive({id:randomUUID(),userId:'simulation',name:'Local simulation',text:`!${a.kind}`},Date.now(),'simulation');if(!outcome)throw Error();result.result=outcome;
        }else if(['pause','quiet'].includes(a.type)){
          if(typeof a.value!=='boolean')throw Error();queue.control(a.type,a.value);
        }else if(a.type==='baseline'){if(!queue.control(a.type,a.mood))throw Error();}
        else if(a.type==='dismiss')queue.control('dismiss');else throw Error();
        publish();json(res,200,result);
      }catch{if(!res.headersSent)json(res,400,{error:'Invalid action'});}return;
    }
    if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
    const file=files.get(path);if(!file){res.writeHead(404).end();return;}
    try{const body=await readFile(new URL(file[0],import.meta.url));res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}).end(body);}catch{res.writeHead(404).end('Asset unavailable.');}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  const timer=setInterval(()=>{queue.tick();publish();},250);timer.unref();
  const keepalive=setInterval(()=>{for(const client of clients)client.write(': keepalive\n\n');},15000);keepalive.unref();
  server.on('close',()=>{clearInterval(timer);clearInterval(keepalive);child?.kill('SIGTERM');for(const client of clients)client.end();});
  return {server,queue,state,token};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {server,token}=createChumiServer({port,simulation:process.env.CHUMI_SIMULATION==='1'});
  await mkdir(new URL('.local/',import.meta.url),{recursive:true,mode:0o700});
  const target=new URL('.local/chumi-control-url.txt',import.meta.url);
  await writeFile(target,`http://localhost:${port}/#control=${token}\n`,{mode:0o600});await chmod(target,0o600);
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Chumi: http://localhost:${port}/ — private controller link saved in .local/chumi-control-url.txt (open locally, do not share).`));
  const stop=()=>{server.close();server.closeAllConnections();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
