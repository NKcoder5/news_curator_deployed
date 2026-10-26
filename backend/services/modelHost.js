// backend/services/modelHost.js
//
// Our own hardware, reachable from the deployed server.
//
// Render's free instance has 512 MB and a tenth of a CPU: enough for the rules and the 42 MB pair model, not
// for a language model. The team's laptop has a GPU. scripts/ownModelServer.js runs Ollama on it behind a
// token-checking proxy and a Cloudflare quick tunnel, and checks in here every minute with the tunnel's
// address, a token made for that session and the model it serves. The Ollama provider (utils/llmProviders.js)
// uses that host while the check-ins are fresh; when they stop (the laptop is off or asleep) the provider
// reports itself unconfigured and the chain goes on to whatever else is configured.
//
// A quick tunnel's address changes every time it starts, which is why the laptop reports it rather than an
// address being written into Render's settings. Only an https origin on an allowed host is accepted
// (OWN_MODEL_HOSTS, default trycloudflare.com), so the internal key cannot point the server anywhere else.
// Nothing is stored: after a restart the next check-in, at most a minute later, restores the host.

const FRESH_MS = 3 * 60 * 1000;   // three missed check-ins and the laptop counts as gone
const REST_MS = 2 * 60 * 1000;    // after a failed call, how long the host is left alone

let host = null;                  // { url, token, model, lastSeen }
let restingUntil = 0;

const allowedHosts = () => String(process.env.OWN_MODEL_HOSTS || 'trycloudflare.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** The origin of an acceptable address, or null. No path, query, credentials or plain http. */
const originOf = (raw) => {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return null;
  const name = u.hostname.toLowerCase();
  return allowedHosts().some(h => name === h || name.endsWith(`.${h}`)) ? `https://${u.host}` : null;
};

/**
 * Record a check-in. `url: null` is the laptop signing off.
 * @returns {{ok: boolean, connected?: boolean, error?: string}}
 */
const checkIn = ({ url, token, model } = {}) => {
  if (url === null) {
    host = null;
    return { ok: true, connected: false };
  }
  const origin = originOf(url);
  if (!origin) return { ok: false, error: `url must be an https origin on ${allowedHosts().join(' or ')}` };
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return { ok: false, error: 'token must be 32 to 256 characters' };
  const name = typeof model === 'string' && /^[\w.:/-]{1,80}$/.test(model) ? model : null;
  // A new tunnel or a new token is a restarted laptop: whatever made the old one rest no longer applies.
  if (!host || host.url !== origin || host.token !== token) restingUntil = 0;
  host = { url: origin, token, model: name, lastSeen: Date.now() };
  return { ok: true, connected: true };
};

/** The host to use now, or null when there is none, its check-ins have stopped, or it is resting. */
const current = () => {
  if (!host || Date.now() - host.lastSeen > FRESH_MS || Date.now() < restingUntil) return null;
  return host;
};

/** A call to the host failed in a way that says it is not there: leave it alone for a while. */
const rest = () => { restingUntil = Date.now() + REST_MS; };

/** For /ready: whether the laptop is connected and what it serves. Never the address or the token. */
const status = () => (host
  ? { connected: Boolean(current()), model: host.model, lastSeenSeconds: Math.round((Date.now() - host.lastSeen) / 1000), resting: Date.now() < restingUntil }
  : { connected: false });

/** Test seam. */
const reset = () => { host = null; restingUntil = 0; };

module.exports = { checkIn, current, rest, status, reset, originOf, FRESH_MS, REST_MS };
