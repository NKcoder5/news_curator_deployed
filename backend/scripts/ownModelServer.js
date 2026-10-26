// backend/scripts/ownModelServer.js
//
// Lend the deployed server this laptop's GPU.
//
//   npm run own-model-server                         serve OLLAMA_MODEL (default qwen3.5:9b) to the deployed API
//   npm run own-model-server -- --model llama3.1:8b  another model
//   npm run own-model-server -- --no-tunnel          the proxy alone on 127.0.0.1:8787, for trying it out
//
// Render's free instance cannot run a language model (512 MB, a tenth of a CPU); this laptop can. What runs:
//   - a proxy on 127.0.0.1 that admits only requests carrying this session's token, and only Ollama's generate,
//     chat, tags and version endpoints for the one model being served;
//   - a Cloudflare quick tunnel to that proxy (cloudflared; no account, a new address each start);
//   - a check-in to the deployed API every minute with the tunnel's address, the token and the model
//     (services/modelHost.js). The server uses the laptop while the check-ins arrive and goes back to its other
//     providers when they stop. Ctrl+C signs off first, so it stops at once.
//
// Reads backend/.env: OWN_MODEL_API_URL (default https://news-curator-deployed.onrender.com) and
// OWN_MODEL_API_KEY, the deployed server's INTERNAL_API_KEY (INTERNAL_API_KEY is used when it is unset).
// CLOUDFLARED is the path to cloudflared.exe when it is not on PATH or in %LOCALAPPDATA%\cloudflared.
// Nothing secret is printed. Keep the laptop awake and on mains power while it serves.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : (args[i + 1] || ''); };

const MODEL = flag('--model') || process.env.OWN_MODEL || 'qwen3.5:9b';
const PORT = Number(flag('--port')) || 8787;
const TUNNEL = !args.includes('--no-tunnel');
const OLLAMA = String(process.env.OWN_MODEL_OLLAMA || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const API = String(process.env.OWN_MODEL_API_URL || 'https://news-curator-deployed.onrender.com').replace(/\/+$/, '');
const API_KEY = process.env.OWN_MODEL_API_KEY || process.env.INTERNAL_API_KEY || '';
const CHECK_IN_MS = 60 * 1000;
const MAX_BODY = 512 * 1024;
const MAX_IN_FLIGHT = 4;           // Ollama answers one at a time on this GPU; a short queue is enough
const MAX_PER_MINUTE = 120;

// A new token each session, so a restarted laptop's old address and token are worth nothing. OWN_MODEL_TOKEN
// fixes it, for trying the proxy by hand with --no-tunnel.
const TOKEN = process.env.OWN_MODEL_TOKEN || crypto.randomBytes(32).toString('hex');
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const TOKEN_DIGEST = digest(TOKEN);
const ROUTES = new Set(['POST /api/generate', 'POST /api/chat', 'GET /api/tags', 'GET /api/version']);
const sameModel = (name) => String(name || '').replace(/:latest$/, '') === MODEL.replace(/:latest$/, '');

const log = (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

/* ---------------------------------------------------------------- the proxy */

let inFlight = 0;
let windowStart = Date.now();
let windowCount = 0;

const refuse = (res, status, error) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error }));
};

const proxy = http.createServer((req, res) => {
  const route = `${req.method} ${req.url.split('?')[0]}`;
  const auth = String(req.headers.authorization || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!given || !crypto.timingSafeEqual(digest(given), TOKEN_DIGEST)) return refuse(res, 401, 'token required');
  if (!ROUTES.has(route)) return refuse(res, 404, 'not served');
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); windowCount = 0; }
  if (++windowCount > MAX_PER_MINUTE) return refuse(res, 429, 'too many requests');
  if (inFlight >= MAX_IN_FLIGHT) return refuse(res, 503, 'busy');

  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { refuse(res, 413, 'too large'); req.destroy(); } else chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks);
    if (req.method === 'POST') {
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (_) { return refuse(res, 400, 'json body required'); }
      if (!sameModel(parsed.model)) return refuse(res, 404, `this laptop serves ${MODEL} only`);
    }
    inFlight++;
    let done = false;
    const finish = () => { if (!done) { done = true; inFlight--; } };
    const upstream = http.request(`${OLLAMA}${req.url}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (up) => {
      res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] || 'application/json' });
      up.pipe(res);
      up.on('close', finish);
    });
    upstream.on('error', () => { finish(); if (!res.headersSent) refuse(res, 502, 'ollama not answering'); });
    upstream.end(body);
  });
});

/* ------------------------------------------------------------- Ollama, model */

const ollamaJson = async (pathname, body) => {
  const r = await fetch(`${OLLAMA}${pathname}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  if (!r.ok) throw new Error(`${pathname} answered ${r.status}`);
  return r.json();
};

const prepareModel = async () => {
  const tags = await ollamaJson('/api/tags').catch(() => { throw new Error(`Ollama is not answering at ${OLLAMA}. Start it (ollama serve) and try again.`); });
  if (!(tags.models || []).some(m => sameModel(m.name))) throw new Error(`${MODEL} is not installed. Run: ollama pull ${MODEL}`);
  // Load it now and keep it loaded, so the first check does not wait for the GPU to fill.
  await ollamaJson('/api/generate', { model: MODEL, prompt: '', keep_alive: '30m' });
};

/* --------------------------------------------------------- tunnel, check-in */

const cloudflaredPath = () => {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  const local = path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe');
  return fs.existsSync(local) ? local : 'cloudflared';
};

let tunnel = null;
let tunnelUrl = null;
let stopping = false;
// Each tunnel started gets the next number. A quick tunnel sometimes dies seconds after printing its address
// (measured on the first test, 26 Oct); whatever was waiting on that one must then give way to its successor
// instead of failing the whole server.
let generation = 0;

const openTunnel = (gen) => new Promise((resolve, reject) => {
  const child = spawn(cloudflaredPath(), ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { windowsHide: true });
  tunnel = child;
  let found = false;
  const tail = [];
  const timer = setTimeout(() => { if (!found) { child.kill(); reject(new Error('cloudflared gave no address within 60 s')); } }, 60000);
  const scan = (data) => {
    for (const line of String(data).split(/\r?\n/).filter(Boolean)) { tail.push(line); if (tail.length > 4) tail.shift(); }
    const m = String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !found) { found = true; clearTimeout(timer); resolve(m[0]); }
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  child.on('error', (err) => { clearTimeout(timer); reject(new Error(`cannot start cloudflared (${err.code}); set CLOUDFLARED to its path`)); });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (!found) { reject(new Error(`cloudflared exited (${code}): ${tail.slice(-1)[0] || 'no output'}`)); return; }
    if (stopping || gen !== generation) return;
    log(`tunnel closed (${code}: ${(tail.slice(-1)[0] || '').slice(0, 160)}); opening a new one`);
    tunnelUrl = null;
    startTunnel();
  });
});

// A quick tunnel's name is not in DNS for some seconds after cloudflared prints it, and Windows remembers a
// "no such name" answer: probed at once, the address failed for over a minute (26 Oct); probed after 20 s, it
// answered on the first try. So the first probe waits, and the server is told only once the address answers.
const FIRST_PROBE_MS = 20000;

/** Wait until the tunnel's address answers through to the proxy; false when a newer tunnel took over. */
const waitForTunnel = async (url, gen) => {
  await new Promise(r => setTimeout(r, FIRST_PROBE_MS));
  for (let i = 0; i < 20 && gen === generation && !stopping; i++) {
    try {
      const r = await fetch(`${url}/api/version`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch (_) { /* not routed yet */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (gen !== generation || stopping) return false;
  throw new Error('the tunnel never answered through to this proxy');
};

let lastCheckIn = '';
const checkIn = async (url) => {
  let outcome;
  try {
    const r = await fetch(`${API}/api/internal/model-host`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': API_KEY },
      body: JSON.stringify(url ? { url, token: TOKEN, model: MODEL } : { url: null }),
      // Render's free instance sleeps; the first check-in may wake it.
      signal: AbortSignal.timeout(90000)
    });
    outcome = r.ok ? (url ? 'checked in' : 'signed off') : `check-in refused (${r.status}${r.status === 401 ? ': OWN_MODEL_API_KEY must be the deployed INTERNAL_API_KEY' : ''})`;
  } catch (err) {
    outcome = `check-in failed (${err.name === 'TimeoutError' ? 'timed out' : err.message})`;
  }
  if (outcome !== lastCheckIn) log(`${outcome} at ${API}`);
  lastCheckIn = outcome;
};

/** Open a tunnel and check in; on failure, try again in ten seconds. Never throws. */
const startTunnel = async () => {
  if (stopping) return;
  const gen = ++generation;
  try {
    const url = await openTunnel(gen);
    if (!(await waitForTunnel(url, gen))) return;
    tunnelUrl = url;
    log(`tunnel open; serving ${MODEL}`);
    await checkIn(tunnelUrl);
  } catch (err) {
    if (gen !== generation || stopping) return;
    log(`tunnel: ${err.message}; trying again in 10 s`);
    generation++;                  // so the killed tunnel's exit does not start a second successor
    if (tunnel) tunnel.kill();
    setTimeout(startTunnel, 10000);
  }
};

const stop = async () => {
  if (stopping) return;
  stopping = true;
  log('signing off');
  if (TUNNEL && API_KEY) await checkIn(null);
  if (tunnel) tunnel.kill();
  proxy.close();
  process.exit(0);
};

const main = async () => {
  if (TUNNEL && API_KEY.length < 24) {
    throw new Error('Set OWN_MODEL_API_KEY in backend/.env to the deployed server\'s INTERNAL_API_KEY.');
  }
  await prepareModel();
  await new Promise((resolve, reject) => proxy.listen(PORT, '127.0.0.1', resolve).on('error', reject));
  log(`proxy on 127.0.0.1:${PORT} for ${MODEL}`);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (!TUNNEL) {
    log(`no tunnel; requests need the token${process.env.OWN_MODEL_TOKEN ? ' in OWN_MODEL_TOKEN' : ' (set OWN_MODEL_TOKEN to choose it)'}`);
    return;
  }
  startTunnel();
  setInterval(() => { if (tunnelUrl) checkIn(tunnelUrl); }, CHECK_IN_MS);
};

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`Own model server: ${err.message}`);
    if (tunnel) tunnel.kill();
    process.exit(1);
  });
}

module.exports = { proxy, TOKEN, MODEL, sameModel };
