import '../config.mjs';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const clientId = process.env.TWITCH_CLIENT_ID || '';
const login = (process.env.TWITCH_LOGIN || '').toLowerCase();
const bridge=process.env.CHUMI_BRIDGE==='1';
const bridgeStatus=(state,message)=>{if(bridge)process.stdout.write(`CHUMI_STATUS ${JSON.stringify({state,message})}\n`);};
const tokenFile = new URL('../.local/twitch-token.json', import.meta.url);
async function post(url, fields) {
  const response = await fetch(url, { method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(15000) });
  return { ok: response.ok, data: await response.json() };
}
async function save(data) {
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, JSON.stringify(data), { mode: 0o600 });
  await chmod(tokenFile, 0o600);
}
async function auth() {
  const started = await post('https://id.twitch.tv/oauth2/device', { client_id: clientId, scopes: 'user:read:chat' });
  if (!started.ok) throw new Error('Device authorization failed. Check that the registered app is Public and the Client ID is correct.');
  const d = started.data;
  console.log(`Sign in as ${login} and authorize read-only chat access:\n${d.verification_uri}\nCode: ${d.user_code}\nWaiting for browser authorization. Tokens will not be printed.`);
  let interval = Math.max(5, d.interval);
  const deadline = Date.now() + d.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const result = await post('https://id.twitch.tv/oauth2/token', { client_id: clientId, scopes: 'user:read:chat', device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (result.ok) { await validate(result.data); await save(result.data); console.log('Authorization saved locally. Run npm start (or npm run twitch:listen for the connection check only).'); return; }
    if (result.data.message === 'authorization_pending') continue;
    if (result.data.message === 'slow_down') { interval += 5; continue; }
    throw new Error('Authorization denied or expired. Run npm run twitch:auth again.');
  }
  throw new Error('Authorization expired. Run npm run twitch:auth again.');
}
async function validate(token) {
  const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Token expired or invalid. Run npm run twitch:auth again.');
  const user = await r.json();
  if (user.client_id !== clientId || user.login.toLowerCase() !== login || !user.scopes.includes('user:read:chat')) throw new Error(`Authorize the registered app as ${login} with user:read:chat.`);
  return user;
}
async function listen() {
  let token;
  try { token = JSON.parse(await readFile(tokenFile, 'utf8')); } catch { throw new Error('No local token. Run npm run twitch:auth first.'); }
  let user;
  async function checkToken() {
    try { return await validate(token); }
    catch (error) {
      if (!token.refresh_token) throw error;
      const refreshed = await post('https://id.twitch.tv/oauth2/token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: token.refresh_token });
      if (!refreshed.ok) throw new Error('Token refresh failed. Run npm run twitch:auth again.');
      // Persist the rotated refresh token before another request; it is single-use.
      token = refreshed.data; await save(token);
      return await validate(token);
    }
  }
  user = await checkToken();
  console.log(`Authenticated as ${user.login}. Connecting to real Twitch chat…`);
  let socket;
  let timeout = 20000;
  let stopping = false;
  let retry;
  const seen = new Set();
  function connect(url = 'wss://eventsub.wss.twitch.tv/ws', migrating = false) {
    const next = new WebSocket(url);
    let watchdog;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => next.close(), timeout); };
    next.addEventListener('open', arm);
    next.addEventListener('message', async ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.metadata.message_type === 'session_welcome') {
          const old = socket; socket = next;
          timeout = (message.payload.session.keepalive_timeout_seconds || 10) * 1000 + 5000;
          if (old && old !== next) old.close();
          if (!migrating) {
            const r = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Client-Id': clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: user.user_id, user_id: user.user_id }, transport: { method: 'websocket', session_id: message.payload.session.id } }), signal: AbortSignal.timeout(9000) });
            if (!r.ok) throw new Error(`Chat subscription failed (HTTP ${r.status}). Reauthorize and retry.`);
          }
          bridgeStatus('connected',`Listening to ${login}: !snack, !surprise, !cheer`);
          console.log(`Listening to ${login}. Send !snack, !surprise or !cheer in Twitch chat. ${bridge?'Chumi bridge is active.':'Standalone receipt check only; start the app controller for animations.'} Ctrl+C stops.`);
        }
        arm();
        if (message.metadata.message_type === 'session_reconnect') {
          const target = new URL(message.payload.session.reconnect_url);
          if (target.protocol !== 'wss:' || target.hostname !== 'eventsub.wss.twitch.tv') throw new Error('Unexpected reconnect address.');
          connect(target.href, true);
        }
        if (message.metadata.message_type === 'revocation') throw new Error('Twitch revoked the subscription. Reauthorize and retry.');
        if (message.metadata.message_type === 'notification' && !seen.has(message.metadata.message_id)) {
          seen.add(message.metadata.message_id); if (seen.size > 1000) seen.delete(seen.values().next().value);
          const e = message.payload.event;
          if(bridge&&/^!(snack|surprise|cheer)$/.test(e.message.text))process.stdout.write(`CHUMI_EVENT ${JSON.stringify({id:e.message_id,userId:e.chatter_user_id,name:e.chatter_user_name,text:e.message.text})}\n`);
          if (process.env.HULL_BRIDGE === '1') process.stdout.write(`HULL_EVENT ${JSON.stringify({ id: e.message_id, userId: e.chatter_user_id, name: e.chatter_user_name, text: e.message.text })}\n`);
          // Log game commands only; do not retain general channel conversation.
          if (/^!(snack|surprise|cheer|scan)$/i.test(e.message.text.trim())) console.log(`[REAL TWITCH] ${JSON.stringify(e.chatter_user_name)}: ${JSON.stringify(e.message.text.slice(0, 200))}`);
        }
      } catch (error) { console.error(error.message); stopping = true; clearTimeout(watchdog); next.close(); process.exitCode = 1; }
    });
    next.addEventListener('close', () => {
      clearTimeout(watchdog);
      if (stopping || (socket && socket !== next)) return;
      bridgeStatus('disconnected','Twitch disconnected; reconnecting. Missed events are not replayed.');
      console.log('Twitch disconnected. Reconnecting in 3 seconds; missed events are not replayed.');
      retry=setTimeout(async()=>{try{user=await checkToken();socket=undefined;connect();}catch(error){console.error(error.message);stopping=true;process.exitCode=1;}},3000);
    });
    next.addEventListener('error', () => console.error('WebSocket connection error. Check internet access.'));
  }
  connect();
  const validation = setInterval(() => checkToken().catch(() => { console.error('Token validation failed. Reauthorize and restart.'); stopping = true; clearTimeout(retry); clearInterval(validation); socket?.close(); process.exitCode = 1; }), 3600000);
  validation.unref();
  const stop=()=>{stopping=true;clearTimeout(retry);clearInterval(validation);socket?.close();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
try {
  if (!clientId || !login) throw new Error('Set TWITCH_CLIENT_ID and TWITCH_LOGIN in .env before connecting Twitch.');
  if (process.argv[2] === 'auth') await auth();
  else if (process.argv[2] === 'listen') await listen();
  else throw new Error('Use npm run twitch:auth or npm run twitch:listen.');
} catch (error) { bridgeStatus('error','Authorization or connection failed. Reauthorize and reconnect.');console.error(error.message); process.exitCode = 1; }
