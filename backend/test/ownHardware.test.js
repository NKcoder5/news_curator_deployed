// Own hardware: HOSTED_AI=off, the laptop's check-in (services/modelHost.js) and the Ollama provider reaching
// it through a tunnel. Transport is stubbed, so nothing here needs Ollama, a tunnel or the network.
const test = require('node:test');
const assert = require('node:assert');

const axiosPath = require.resolve('axios');
const providersPath = require.resolve('../utils/llmProviders');
const modelHost = require('../services/modelHost');

const TOKEN = 'a'.repeat(64);
const TUNNEL = 'https://quiet-river-1234.trycloudflare.com';

/** Load llmProviders with axios replaced by a recorder; env changes are undone by restore(). */
const load = (handler, env = {}) => {
  const realAxios = require.cache[axiosPath];
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const calls = [];
  require.cache[axiosPath] = {
    id: axiosPath, filename: axiosPath, loaded: true,
    exports: { post: async (url, body, config) => { calls.push({ url, body, config }); return handler({ url, body, config }); }, get: async () => ({ data: {} }) }
  };
  delete require.cache[providersPath];
  const providers = require(providersPath);
  return {
    providers,
    calls,
    restore: () => {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      if (realAxios) require.cache[axiosPath] = realAxios; else delete require.cache[axiosPath];
      delete require.cache[providersPath];
      modelHost.reset();
    }
  };
};

const reply = async () => ({ data: { response: '{"ok":true}' } });
const noLocal = { OLLAMA_HOST: undefined, OLLAMA_TOKEN: undefined, OLLAMA_MODEL: undefined };

test('HOSTED_AI=off leaves Gemini and NIM out even with their keys set', () => {
  const { providers, restore } = load(reply, { ...noLocal, HOSTED_AI: 'off', GEMINI_API_KEY: 'g', NIM_API_KEY: 'n', OLLAMA_HOST: 'http://localhost:11434', LLM_PROVIDER: undefined });
  try {
    assert.strictEqual(providers.PROVIDERS.gemini.isConfigured(), false);
    assert.strictEqual(providers.PROVIDERS.nim.isConfigured(), false);
    const chain = providers.resolveProviderChain('stance judgement').map(p => p.name);
    assert.deepStrictEqual(chain, ['ollama'], 'not even as a failover');
  } finally { restore(); }
});

test('without HOSTED_AI the hosted providers are unchanged', () => {
  const { providers, restore } = load(reply, { ...noLocal, HOSTED_AI: undefined, GEMINI_API_KEY: 'g', NIM_API_KEY: 'n', LLM_PROVIDER: undefined });
  try {
    assert.strictEqual(providers.PROVIDERS.gemini.isConfigured(), true);
    assert.strictEqual(providers.PROVIDERS.nim.isConfigured(), true);
  } finally { restore(); }
});

test('a check-in is accepted only as an https origin on an allowed host', () => {
  modelHost.reset();
  try {
    for (const bad of ['http://quiet-river-1234.trycloudflare.com', 'https://evil.example.com', `${TUNNEL}/api`, `${TUNNEL}?x=1`,
      'https://user:pw@quiet-river-1234.trycloudflare.com', 'https://trycloudflare.com.evil.example', 'not a url']) {
      assert.strictEqual(modelHost.checkIn({ url: bad, token: TOKEN }).ok, false, bad);
    }
    assert.strictEqual(modelHost.checkIn({ url: TUNNEL, token: 'short' }).ok, false, 'a short token is refused');
    assert.strictEqual(modelHost.checkIn({ url: `${TUNNEL}/`, token: TOKEN, model: 'qwen3.5:9b' }).ok, true);
    assert.strictEqual(modelHost.current().url, TUNNEL);
    assert.strictEqual(modelHost.current().model, 'qwen3.5:9b');
    assert.strictEqual(modelHost.checkIn({ url: null }).connected, false, 'the laptop can sign off');
    assert.strictEqual(modelHost.current(), null);
  } finally { modelHost.reset(); }
});

test('status never shows the address or the token', () => {
  modelHost.reset();
  try {
    modelHost.checkIn({ url: TUNNEL, token: TOKEN, model: 'qwen3.5:9b' });
    const shown = JSON.stringify(modelHost.status());
    assert.ok(!shown.includes('trycloudflare') && !shown.includes(TOKEN), shown);
    assert.strictEqual(modelHost.status().connected, true);
  } finally { modelHost.reset(); }
});

test('the server reaches a checked-in laptop with its token and its model', async () => {
  const { providers, calls, restore } = load(reply, noLocal);
  try {
    assert.strictEqual(providers.PROVIDERS.ollama.isConfigured(), false, 'no laptop, no provider');
    modelHost.checkIn({ url: TUNNEL, token: TOKEN, model: 'qwen3.5:9b' });
    assert.strictEqual(providers.PROVIDERS.ollama.isConfigured(), true);
    assert.strictEqual(providers.PROVIDERS.ollama.models[0], 'qwen3.5:9b', 'the model the laptop serves comes first');
    await providers.PROVIDERS.ollama.send({ model: 'qwen3.5:9b', prompt: 'x', maxTokens: 10, json: true });
    assert.strictEqual(calls[0].url, `${TUNNEL}/api/generate`);
    assert.strictEqual(calls[0].config.headers.Authorization, `Bearer ${TOKEN}`);
    assert.strictEqual(calls[0].body.think, false, 'a thinking model is told not to think');
  } finally { restore(); }
});

test('a model that does not think is not sent the switch', async () => {
  const { providers, calls, restore } = load(reply, { ...noLocal, OLLAMA_HOST: 'http://localhost:11434' });
  try {
    await providers.PROVIDERS.ollama.send({ model: 'llama3.1:8b', prompt: 'x', maxTokens: 10 });
    assert.strictEqual('think' in calls[0].body, false);
    assert.strictEqual(calls[0].config.headers.Authorization, undefined, 'no token unless one is configured');
  } finally { restore(); }
});

test('OLLAMA_HOST wins over a check-in', async () => {
  const { providers, calls, restore } = load(reply, { ...noLocal, OLLAMA_HOST: 'http://localhost:11434' });
  try {
    modelHost.checkIn({ url: TUNNEL, token: TOKEN, model: 'qwen3.5:9b' });
    await providers.PROVIDERS.ollama.send({ model: 'llama3.1:8b', prompt: 'x', maxTokens: 10 });
    assert.strictEqual(calls[0].url, 'http://localhost:11434/api/generate');
  } finally { restore(); }
});

test('a laptop that stops answering is left alone, and a fresh check-in brings it back', async () => {
  const gone = async () => { throw Object.assign(new Error('origin unreachable'), { response: { status: 530 } }); };
  const { providers, restore } = load(gone, noLocal);
  try {
    modelHost.checkIn({ url: TUNNEL, token: TOKEN, model: 'qwen3.5:9b' });
    await assert.rejects(() => providers.PROVIDERS.ollama.send({ model: 'qwen3.5:9b', prompt: 'x', maxTokens: 10 }));
    assert.strictEqual(providers.PROVIDERS.ollama.isConfigured(), false, 'resting: the chain goes on without it');
    await assert.rejects(() => providers.PROVIDERS.ollama.send({ model: 'mistral:7b', prompt: 'x', maxTokens: 10 }),
      (err) => err.code === 'ECONNRESET', 'the next model fails at once instead of waiting on the tunnel');
    modelHost.checkIn({ url: 'https://another-tunnel-99.trycloudflare.com', token: 'b'.repeat(64), model: 'qwen3.5:9b' });
    assert.strictEqual(providers.PROVIDERS.ollama.isConfigured(), true, 'a restarted laptop is used again');
  } finally { restore(); }
});

test('check-ins that stop make the laptop count as gone', () => {
  modelHost.reset();
  const realNow = Date.now;
  try {
    modelHost.checkIn({ url: TUNNEL, token: TOKEN });
    Date.now = () => realNow() + modelHost.FRESH_MS + 1000;
    assert.strictEqual(modelHost.current(), null);
  } finally { Date.now = realNow; modelHost.reset(); }
});

test('the check-in endpoint takes the internal key and nothing else', async () => {
  const saved = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = 'k'.repeat(32);
  const { internalOnly } = require('../middleware/apiAccess');
  const run = (headers) => new Promise((resolve) => {
    const req = { header: (name) => headers[name.toLowerCase()] };
    const res = { status: (code) => ({ json: () => resolve(code) }) };
    internalOnly(req, res, () => resolve(200));
  });
  try {
    assert.strictEqual(await run({}), 401);
    assert.strictEqual(await run({ authorization: 'Bearer some-reader-token' }), 401, 'a signed-in reader is not enough');
    assert.strictEqual(await run({ 'x-internal-key': 'k'.repeat(31) }), 401);
    assert.strictEqual(await run({ 'x-internal-key': 'k'.repeat(32) }), 200);
  } finally {
    if (saved === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = saved;
  }
});
