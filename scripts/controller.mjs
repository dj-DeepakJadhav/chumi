import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
try{
  const address=(await readFile(new URL('../.local/chumi-control-url.txt',import.meta.url),'utf8')).trim();
  const url=new URL(address);
  if(url.protocol!=='http:'||url.hostname!=='localhost'||url.pathname!=='/'||!/^#control=[a-f0-9]{64}$/.test(url.hash))throw Error('Invalid local controller address. Restart npm start.');
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',address]:[address];
  const child=spawn(command,args,{stdio:'ignore'});
  child.on('error',()=>{console.error('Could not open the browser. Open the private link in .local/chumi-control-url.txt locally.');process.exitCode=1;});
  child.on('exit',code=>{if(code){console.error('Browser launch failed. Start the server and open the saved private link locally.');process.exitCode=1;}});
}catch(error){console.error(error.code==='ENOENT'?'Start the Chumi server first, then run npm run controller.':error.message);process.exitCode=1;}
