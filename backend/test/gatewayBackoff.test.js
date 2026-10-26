// How long the gateway makes a check wait when a model is busy or rate
// limited.
//
// Measured before this was changed: a 429 or 503 cost 1 s, 2 s and 4 s on the
// same model before the next one was tried, and Gemini's per-minute limit
// names a wait of up to a minute, so those retries mostly failed again.
const test = require('node:test');
const assert = require('node:assert');

const PROVIDERS_PATH = require.resolve('../utils/llmProviders');
const GATEWAY_PATH = require.resolve('../utils/nvidiaNimApi');

/** Load the gateway over one fake provider whose replies the test scripts. */
const withProvider = (models, send) => {
  const real = require.cache[PROVIDERS_PATH];
  const actual = require(PROVIDERS_PATH);
  const provider = { name: 'fake', label: 'Fake', models, concurrency: 6, isConfigured: () => true, send };
  require.cache[PROVIDERS_PATH] = { id: PROVIDERS_PATH, filename: PROVIDERS_PATH, loaded: true,
    exports: { ...actual, resolveProviderChain: () => [provider] } };
  delete require.cache[GATEWAY_PATH];
  const gateway = require(GATEWAY_PATH);
  return {
    gateway,
    restore: () => {
      delete require.cache[GATEWAY_PATH];
      if (real) require.cache[PROVIDERS_PATH] = real; else delete require.cache[PROVIDERS_PATH];
    }
  };
};

const httpError = (status, data = {}, headers = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data, headers } });

// What Gemini sends when a model's per-minute allowance is spent.
const perMinute = (seconds) => httpError(429, { error: { code: 429, details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: `${seconds}s` }
] } });

test('a model rate limited for the rest of the minute is set aside and the next model asked at once', async () => {
  const asked = [];
  const { gateway, restore } = withProvider(['first', 'second'], async ({ model }) => {
    asked.push(model);
    if (model === 'first') throw perMinute(37);
    return 'answer from second';
  });
  const warn = console.warn; console.warn = () => {};
  try {
    const started = Date.now();
    assert.strictEqual(await gateway.callNimApi('q', { label: 'test' }), 'answer from second');
    assert.ok(Date.now() - started < 400, `waited ${Date.now() - started} ms; the old code waited 7 s`);
    assert.deepStrictEqual(asked, ['first', 'second']);
    // And the next call does not knock on the limited model again.
    asked.length = 0;
    await gateway.callNimApi('q2', { label: 'test' });
    assert.deepStrictEqual(asked, ['second']);
  } finally {
    console.warn = warn;
    restore();
  }
});

test('a short wait the provider asks for is honoured on the same model', async () => {
  let calls = 0;
  const { gateway, restore } = withProvider(['only'], async () => {
    calls += 1;
    if (calls === 1) throw httpError(503, {}, { 'retry-after': '0.2' });
    return 'ok';
  });
  const warn = console.warn; console.warn = () => {};
  try {
    const started = Date.now();
    assert.strictEqual(await gateway.callNimApi('q', { label: 'test' }), 'ok');
    assert.strictEqual(calls, 2);
    assert.ok(Date.now() - started >= 180, 'the requested 200 ms were waited');
  } finally {
    console.warn = warn;
    restore();
  }
});

test('back-off is jittered and bounded: about 0.5 s, 1 s, 2 s rather than 1 s, 2 s, 4 s', () => {
  const { gateway, restore } = withProvider(['m'], async () => 'ok');
  try {
    const { backoffMs } = gateway.__test;
    for (let attempt = 0; attempt < 3; attempt++) {
      const waits = Array.from({ length: 200 }, () => backoffMs(attempt));
      const base = 500 * Math.pow(2, attempt);
      assert.ok(Math.min(...waits) >= base * 0.5 && Math.max(...waits) <= base * 1.5, `attempt ${attempt}: ${Math.min(...waits)}-${Math.max(...waits)}`);
      assert.ok(new Set(waits).size > 20, 'calls that failed together must not retry together');
    }
    // The longest the three retries can now cost, against 7 s before.
    assert.ok([0, 1, 2].reduce((sum, a) => sum + 500 * Math.pow(2, a) * 1.5, 0) <= 5250);
  } finally {
    restore();
  }
});

test('the wait a provider asks for is read from Retry-After or from Gemini\'s RetryInfo', () => {
  const { gateway, restore } = withProvider(['m'], async () => 'ok');
  try {
    const { providerWaitMs } = gateway.__test;
    assert.strictEqual(providerWaitMs(httpError(429, {}, { 'retry-after': '3' })), 3000);
    assert.strictEqual(providerWaitMs(perMinute(37)), 37000);
    assert.strictEqual(providerWaitMs(httpError(503)), null);
  } finally {
    restore();
  }
});

// Two readers checking one forward at the same moment ask the same questions. Each judgement is asked of
// the model once, and both get its answer, with the provider that gave it.
test('the same judgement asked twice at once is asked of the model once', async () => {
  let asked = 0;
  const { gateway, restore } = withProvider(['only'], async () => {
    asked += 1;
    await new Promise(r => setTimeout(r, 30));
    return '{"items": [1, 2]}';
  });
  try {
    const metaA = {}; const metaB = {};
    const prompt = `same question ${Date.now()}`;
    const [a, b] = await Promise.all([
      gateway.callNimApiJson(prompt, { label: 'stance judgement', temperature: 0, requiredKeys: ['items'], meta: metaA }),
      gateway.callNimApiJson(prompt, { label: 'stance judgement', temperature: 0, requiredKeys: ['items'], meta: metaB })
    ]);
    assert.strictEqual(asked, 1);
    assert.deepStrictEqual(a, { items: [1, 2] });
    assert.deepStrictEqual(b, { items: [1, 2] });
    assert.notStrictEqual(a, b, 'each caller gets its own copy');
    assert.strictEqual(metaA.provider, 'fake');
    assert.strictEqual(metaB.provider, 'fake');
  } finally {
    restore();
  }
});

// 26 Oct: each call walked all twenty Gemini entries through a dropped connection, fifteen seconds a
// timeout. Two connection failures set the provider aside, for this call and the next ones.
test('two connection failures set a provider aside instead of walking every model', async () => {
  const asked = [];
  const { gateway, restore } = withProvider(['a', 'b', 'c', 'd', 'e'], async ({ model }) => {
    asked.push(model);
    throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
  });
  const error = console.error; console.error = () => {};
  const warn = console.warn; console.warn = () => {};
  try {
    await assert.rejects(() => gateway.callNimApi('q', { label: 'test' }), (err) => err.code === 'ECONNABORTED');
    assert.deepStrictEqual(asked, ['a', 'b'], 'two models tried, not five');
    asked.length = 0;
    await assert.rejects(() => gateway.callNimApi('q2', { label: 'test' }), (err) => err.code === 'PROVIDER_UNREACHABLE');
    assert.deepStrictEqual(asked, [], 'the next call does not knock again while the provider rests');
    gateway.__test.providerDownUntil.clear();
  } finally {
    console.error = error; console.warn = warn;
    restore();
  }
});

// 26 Oct: a Gemini request now and then hangs to its 15 s limit, twice in one check. Unanswered after the
// hedge delay, the call is asked again of the same model on another key, the first answer is used and the
// slower request cancelled.
test('a hung request is hedged on the same model with another key, and the loser is cancelled', async () => {
  const saved = process.env.LLM_HEDGE_MS;
  process.env.LLM_HEDGE_MS = '60';
  const asked = [];
  let primaryAborted = false;
  const { gateway, restore } = withProvider(['lite', 'lite#1', 'other'], async ({ model, signal }) => {
    asked.push(model);
    if (model === 'lite') {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { primaryAborted = true; reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })); });
      });
    }
    return `answer from ${model}`;
  });
  const PROVIDERS = require(require.resolve('../utils/llmProviders'));
  PROVIDERS.resolveProviderChain()[0].hedge = true;
  const warn = console.warn; console.warn = () => {};
  try {
    const meta = {};
    const started = Date.now();
    const text = await gateway.callNimApi('q', { label: 'test', meta });
    assert.strictEqual(text, 'answer from lite#1');
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
    assert.deepStrictEqual(asked, ['lite', 'lite#1'], 'hedged on the same model, not on another one');
    assert.strictEqual(primaryAborted, true, 'the slower request was cancelled');
    assert.strictEqual(meta.model, 'lite');
  } finally {
    console.warn = warn;
    if (saved === undefined) delete process.env.LLM_HEDGE_MS; else process.env.LLM_HEDGE_MS = saved;
    restore();
  }
});

test('a quick answer is never hedged, and a quick failure is handled as before', async () => {
  const asked = [];
  const { gateway, restore } = withProvider(['lite', 'lite#1'], async ({ model }) => {
    asked.push(model);
    return 'quick';
  });
  require(require.resolve('../utils/llmProviders')).resolveProviderChain()[0].hedge = true;
  try {
    assert.strictEqual(await gateway.callNimApi('q', { label: 'test' }), 'quick');
    assert.deepStrictEqual(asked, ['lite']);
  } finally {
    restore();
  }
});

// 26 Oct: 20 of 24 requests to one Gemini model failed "busy" in one check, and the gateway asked the same
// busy model on every key in turn. Overload is the model's: one quick retry, then the next model.
test('a busy model is set aside on every key and the next model is asked', async () => {
  const asked = [];
  const { gateway, restore } = withProvider(['lite', 'lite#1', 'lite#2', 'flash'], async ({ model }) => {
    asked.push(model);
    if (model.startsWith('lite')) throw httpError(503, { error: { code: 503, message: 'The model is overloaded.' } });
    return 'answer from flash';
  });
  const error = console.error; console.error = () => {};
  const warn = console.warn; console.warn = () => {};
  try {
    assert.strictEqual(await gateway.callNimApi('q', { label: 'test' }), 'answer from flash');
    assert.deepStrictEqual(asked, ['lite', 'lite', 'flash'], 'one retry, then the next model, not the same model on other keys');
    asked.length = 0;
    await gateway.callNimApi('q2', { label: 'test' });
    assert.deepStrictEqual(asked, ['flash'], 'the busy model rests for every call');
    gateway.__test.modelBusyUntil.clear();
  } finally {
    console.error = error; console.warn = warn;
    restore();
  }
});
