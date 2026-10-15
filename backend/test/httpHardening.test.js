// The server's outside edge, exercised over real HTTP: the application is
// built by app.js's createApp() and listens on an ephemeral port. No database
// is connected, so every request here is one that must be answered before a
// database is reached (or that answers "unavailable" without one).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.INTERNAL_API_KEY = 'test-internal-key-0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'a-test-secret-that-is-long-enough-0123456789';
const KEY = { 'x-internal-key': process.env.INTERNAL_API_KEY };

const { createApp } = require('../app');
const { createRateLimits } = require('../middleware/rateLimits');
const { errorHandler } = require('../middleware/errorHandlers');
const { requestContext } = require('../middleware/requestContext');
const { checkConfig } = require('../utils/config');

const quiet = () => {};

/** Listen on an ephemeral port; returns a request function and a closer. */
const serve = async (app) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const request = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path,
      headers: { ...(payload !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers } },
    (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: data });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
  return { request, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
};

let api;
test.before(async () => { api = await serve(createApp({ rateLimits: false, log: quiet })); });
test.after(async () => { await api.close(); });

// ------------------------------------------------------------ headers and ids

test('security headers are set and the framework is not named', async () => {
  const res = await api.request('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.ok(res.headers['strict-transport-security']);
  assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin', 'the frontend on its own origin can still read responses');
});

test('every response carries a request id; a well-formed one is kept, anything else replaced', async () => {
  const own = await api.request('GET', '/health');
  assert.match(own.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  const given = await api.request('GET', '/health', { headers: { 'x-request-id': 'eval-run-0001' } });
  assert.equal(given.headers['x-request-id'], 'eval-run-0001');
  const hostile = await api.request('GET', '/health', { headers: { 'x-request-id': 'x"} {"level":"forged' } });
  assert.notEqual(hostile.headers['x-request-id'], 'x"} {"level":"forged');
});

test('request lines are one JSON object with no body, query or token in them', async () => {
  const lines = [];
  const logged = await serve(createApp({ rateLimits: false, log: (line) => lines.push(line) }));
  try {
    await logged.request('POST', '/api/ai/analyze-content?email=reader@example.test', {
      headers: { authorization: 'Bearer secret-token' }, body: { text: 'my password is hunter22' }
    });
    await new Promise(resolve => setImmediate(resolve));
    const entry = JSON.parse(lines.at(-1));
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'level', 'method', 'ms', 'msg', 'path', 'status', 'time']);
    assert.equal(entry.path, '/api/ai/analyze-content');
    assert.equal(entry.status, 401);
    assert.ok(!lines.join('\n').includes('hunter22'));
    assert.ok(!lines.join('\n').includes('secret-token'));
    assert.ok(!lines.join('\n').includes('reader@example.test'));
  } finally {
    await logged.close();
  }
});

// ------------------------------------------------------------------- CORS

test('CORS answers the listed origins and declines the rest without a fault', async () => {
  const ok = await api.request('GET', '/health', { headers: { origin: 'http://localhost:3000' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.match(ok.headers['access-control-expose-headers'], /X-Request-Id/);
  const other = await api.request('OPTIONS', '/api/ai/analyze-content', {
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
  });
  assert.ok(other.status < 500);
  assert.equal(other.headers['access-control-allow-origin'], undefined);
});

// -------------------------------------------------------- 404 and errors

test('an unknown address is a JSON 404 with the request id', async () => {
  const res = await api.request('GET', '/api/nothing-here');
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'NOT_FOUND');
  assert.equal(res.json.requestId, res.headers['x-request-id']);
});

test('malformed JSON is a 400, never a stack trace', async () => {
  const res = await api.request('POST', '/api/auth/login', { body: '{"email": ' });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'INVALID_JSON');
  assert.ok(!/at .*\.js:\d+/.test(res.text));
});

test('an unhandled fault answers a generic 500 and logs the stack with the id', async () => {
  const logged = [];
  const app = express();
  app.use(requestContext({ log: quiet }));
  app.get('/boom', () => { throw new Error('secret internals at /srv/app/db.js:12'); });
  app.use(errorHandler({ log: (line) => logged.push(line) }));
  const local = await serve(app);
  try {
    const res = await local.request('GET', '/boom');
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'INTERNAL_ERROR');
    assert.ok(!res.text.includes('secret internals'));
    assert.ok(logged.some(line => line.includes(res.json.requestId) && line.includes('secret internals')));
  } finally {
    await local.close();
  }
});

// ------------------------------------------------------------- body limits

test('bodies are limited per route: small for accounts, 1 MB for analysis, 12 MB for a screenshot', async () => {
  const login = await api.request('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(200 * 1024) } });
  assert.equal(login.status, 413);
  assert.equal(login.json.code, 'PAYLOAD_TOO_LARGE');

  const badges = await api.request('POST', '/api/ai/trust-badges', { headers: KEY, body: { articles: [{ title: 'x'.repeat(2 * 1024 * 1024) }] } });
  assert.equal(badges.status, 413);

  // 3 MB reaches Check Anything's own validation, which is what refuses it.
  const big = await api.request('POST', '/api/ai/analyze-content', { headers: KEY, body: { text: 'x'.repeat(3 * 1024 * 1024) } });
  assert.equal(big.status, 400);
  assert.equal(big.json.code, 'TOO_LONG');
});

test('the analysis bodies are not read before the login check', async () => {
  const res = await api.request('POST', '/api/ai/analyze-content', { body: { text: 'x'.repeat(3 * 1024 * 1024) } });
  assert.equal(res.status, 401);
});

// --------------------------------------------------------- NoSQL injection

test('operator and dotted keys are refused in bodies and queries', async () => {
  const login = await api.request('POST', '/api/auth/login', { body: { email: { $ne: null }, password: 'x' } });
  assert.equal(login.status, 400);
  assert.equal(login.json.code, 'INVALID_FIELD_NAME');
  const nested = await api.request('POST', '/api/ai/trust-analysis', { headers: KEY, body: { title: 't', url: { $gt: '' } } });
  assert.equal(nested.status, 400);
  assert.equal(nested.json.code, 'INVALID_FIELD_NAME');
  const query = await api.request('GET', '/api/claims?$where=sleep(1000)');
  assert.equal(query.status, 400);
  const dotted = await api.request('POST', '/api/auth/signup', { body: { 'email.address': 'a@b.co', password: 'longenough' } });
  assert.equal(dotted.status, 400);
});

// --------------------------------------------------------- input validation

test('Check Anything refuses fields of the wrong type or length with a 400 and a code', async () => {
  const number = await api.request('POST', '/api/ai/analyze-content', { headers: KEY, body: { text: 12345 } });
  assert.equal(number.status, 400);
  assert.equal(number.json.code, 'INVALID_INPUT');
  assert.equal(number.json.field, 'text');

  const url = await api.request('POST', '/api/ai/analyze-content/stream', { headers: KEY, body: { url: { href: 'x' } } });
  assert.equal(url.status, 400, 'refused before the stream opens');

  const hint = await api.request('POST', '/api/ai/analyze-content', { headers: KEY, body: { text: 'Modi resigned today', languageHint: '../../etc' } });
  assert.equal(hint.status, 400);

  // Nothing at all keeps its existing message.
  const empty = await api.request('POST', '/api/ai/analyze-content', { headers: KEY, body: {} });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /Send a link, some text, or a screenshot/);

  const multiple = await api.request('POST', '/api/ai/analyze-content', {
    headers: KEY,
    body: { text: 'India won 84 medals at the Asian Games.', url: 'https://example.com/story' }
  });
  assert.equal(multiple.status, 400);
  assert.equal(multiple.json.code, 'MULTIPLE_INPUTS');

  const invalidImage = await api.request('POST', '/api/ai/analyze-content', {
    headers: KEY,
    body: { imageBase64: 'not-an-image' }
  });
  assert.equal(invalidImage.status, 400);
  assert.equal(invalidImage.json.code, 'INVALID_IMAGE');
});

test('the other analysis routes check their fields too', async () => {
  const badges = await api.request('POST', '/api/ai/trust-badges', { headers: KEY, body: { articles: 'all of them' } });
  assert.equal(badges.status, 400);
  const plain = await api.request('POST', '/api/ai/plain-answer', { headers: KEY, body: { text: ['a'] } });
  assert.equal(plain.status, 400);
  const link = await api.request('POST', '/api/ai/extract-article', { headers: KEY, body: { url: 'x'.repeat(5000) } });
  assert.equal(link.status, 400);
});

// ------------------------------------------------------------- rate limits

test('sign-in attempts are limited per address, with Retry-After', async () => {
  const limited = await serve(createApp({ rateLimits: { login: { limit: 2 } }, log: quiet }));
  try {
    for (let i = 0; i < 2; i++) assert.equal((await limited.request('POST', '/api/auth/login', { body: {} })).status, 400);
    const third = await limited.request('POST', '/api/auth/login', { body: {} });
    assert.equal(third.status, 429);
    assert.equal(third.json.code, 'RATE_LIMITED');
    assert.match(third.json.error, /try again in \d+ minute/);
    assert.ok(Number(third.headers['retry-after']) > 0);
  } finally {
    await limited.close();
  }
});

test('the public registry is limited per address', async () => {
  const limited = await serve(createApp({ rateLimits: { registry: { limit: 2 } }, log: quiet }));
  try {
    for (let i = 0; i < 2; i++) assert.equal((await limited.request('GET', '/api/claims')).status, 503, 'no database here');
    assert.equal((await limited.request('GET', '/api/claims/stats')).status, 429);
  } finally {
    await limited.close();
  }
});

test('checks are limited per reader, not per address, and the evaluation key is not limited', async () => {
  const limits = createRateLimits({ checks: { limit: 2 }, analysis: { limit: 100 } });
  const app = express();
  app.use((req, res, next) => {
    if (req.get('x-reader')) req.user = { _id: req.get('x-reader') };
    if (req.get('x-internal')) req.internalCaller = true;
    next();
  });
  app.use('/api/ai', limits.ai, (req, res) => res.json({ ok: true }));
  const local = await serve(app);
  try {
    const call = (reader, path = '/api/ai/analyze-content') => local.request('POST', path, { headers: { 'x-reader': reader } });
    assert.equal((await call('reader-a')).status, 200);
    assert.equal((await call('reader-a')).status, 200);
    assert.equal((await call('reader-a')).status, 429, 'a third check in the window');
    assert.equal((await call('reader-b')).status, 200, 'another reader from the same address is not affected');
    assert.equal((await call('reader-a', '/api/ai/trust-badges')).status, 200, 'cheap routes have their own allowance');
    for (let i = 0; i < 5; i++) {
      assert.equal((await local.request('POST', '/api/ai/analyze-content', { headers: { 'x-internal': '1' } })).status, 200);
    }
  } finally {
    await local.close();
  }
});

// -------------------------------------------------------- health and ready

test('/health is liveness; /ready says not ready without a database', async () => {
  assert.equal((await api.request('GET', '/health')).json.status, 'OK');
  const ready = await api.request('GET', '/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.json.checks.database, 'not connected');
});

// ------------------------------------------------------------------ auth

test('a token signed with another algorithm is refused', async () => {
  const token = jwt.sign({ userId: '000000000000000000000000' }, process.env.JWT_SECRET, { algorithm: 'HS512' });
  const res = await api.request('GET', '/api/auth/verify', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 401);
});

test('startup configuration: missing and weak values are named', () => {
  const missing = checkConfig({});
  assert.ok(missing.errors.some(e => e.includes('MONGO_URI')));
  assert.ok(missing.errors.some(e => e.includes('JWT_SECRET')));

  const weakDev = checkConfig({ MONGO_URI: 'mongodb://x', JWT_SECRET: 'secret', GEMINI_API_KEY: 'k' });
  assert.equal(weakDev.errors.length, 0, 'a laptop keeps working');
  assert.ok(weakDev.warnings.some(w => w.includes('JWT_SECRET')));

  const weakProd = checkConfig({ MONGO_URI: 'mongodb://x', JWT_SECRET: 'secret', GEMINI_API_KEY: 'k', NODE_ENV: 'production' });
  assert.ok(weakProd.errors.some(e => e.includes('JWT_SECRET')), 'production does not start on a guessable secret');

  const good = checkConfig({ MONGO_URI: 'mongodb://x', JWT_SECRET: 'q7Vb3kP9xZ2mW8rT4yN6cJ1hL5sD0fG3aE7uI9oK', GEMINI_API_KEY: 'k', NODE_ENV: 'production' });
  assert.deepEqual(good, { errors: [], warnings: [] });
});

test('the re-check timer can be stopped for a shutdown', () => {
  const saved = process.env.RECHECK_ENABLED;
  delete process.env.RECHECK_ENABLED;
  const { startRecheckScheduler, stopRecheckScheduler } = require('../services/recheckScheduler');
  const log = console.log;
  console.log = quiet;
  try {
    assert.equal(startRecheckScheduler(), true);
    assert.equal(stopRecheckScheduler(), true);
    assert.equal(stopRecheckScheduler(), false);
  } finally {
    console.log = log;
    if (saved !== undefined) process.env.RECHECK_ENABLED = saved;
  }
});
