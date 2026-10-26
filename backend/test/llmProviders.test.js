// The Ollama provider is tested against a stubbed transport rather than a
// running Ollama, so the request shaping and response handling are verified on
// any machine — including one with no local model installed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const axiosPath = require.resolve('axios');
const providersPath = require.resolve('../utils/llmProviders');

/** Load llmProviders with axios replaced by a recorder. */
const withStubbedAxios = (handler) => {
  const realAxios = require.cache[axiosPath];
  const calls = [];
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: {
      post: async (url, body, config) => {
        calls.push({ url, body, config });
        return handler ? handler({ url, body, config }) : { data: {} };
      },
      get: async () => ({ data: {} })
    }
  };
  delete require.cache[providersPath];
  const providers = require(providersPath);

  return {
    providers,
    calls,
    restore: () => {
      if (realAxios) require.cache[axiosPath] = realAxios;
      else delete require.cache[axiosPath];
      delete require.cache[providersPath];
    }
  };
};

test('the local provider stays out of the chain until it is configured', () => {
  delete process.env.OLLAMA_HOST;
  const { providers, restore } = withStubbedAxios();
  try {
    assert.strictEqual(providers.PROVIDERS.ollama.isConfigured(), false,
      'a machine not running Ollama must never wait on a connection that cannot succeed');
  } finally {
    restore();
  }
});

test('setting OLLAMA_HOST is all it takes to enable it', () => {
  process.env.OLLAMA_HOST = 'http://localhost:11434';
  const { providers, restore } = withStubbedAxios();
  try {
    assert.strictEqual(providers.PROVIDERS.ollama.isConfigured(), true);
  } finally {
    delete process.env.OLLAMA_HOST;
    restore();
  }
});

test('it sends the shape Ollama expects and returns the reply', async () => {
  process.env.OLLAMA_HOST = 'http://localhost:11434/';
  const { providers, calls, restore } = withStubbedAxios(
    async () => ({ data: { response: '  {"verdict":"supported"}  ', done: true } })
  );

  try {
    const text = await providers.PROVIDERS.ollama.send({
      model: 'llama3.1:8b',
      prompt: 'Is this supported?',
      maxTokens: 500,
      temperature: 0.2,
      topP: 0.9,
      timeout: 15000
    });

    assert.strictEqual(text, '{"verdict":"supported"}', 'the reply is returned trimmed');

    const [call] = calls;
    assert.strictEqual(call.url, 'http://localhost:11434/api/generate',
      'the trailing slash on OLLAMA_HOST must not produce a double slash');
    assert.strictEqual(call.body.model, 'llama3.1:8b');
    assert.strictEqual(call.body.stream, false, 'the gateway reads one whole reply, not a stream');
    assert.strictEqual(call.body.options.num_predict, 500, 'Ollama calls the reply budget num_predict');
    assert.strictEqual(call.body.options.temperature, 0.2);
    assert.strictEqual(call.body.keep_alive, '30m', 'the model stays loaded between checks minutes apart');
    assert.ok(call.config.timeout >= 120000,
      'a local model is slower per token than a hosted one; the caller timeout must not cancel it early');
  } finally {
    delete process.env.OLLAMA_HOST;
    restore();
  }
});

test('an empty reply is an error, not an empty analysis', async () => {
  process.env.OLLAMA_HOST = 'http://localhost:11434';
  const { providers, restore } = withStubbedAxios(async () => ({ data: { response: '   ' } }));

  try {
    await assert.rejects(
      () => providers.PROVIDERS.ollama.send({ model: 'llama3.1:8b', prompt: 'x', maxTokens: 10 }),
      /empty response/i
    );
  } finally {
    delete process.env.OLLAMA_HOST;
    restore();
  }
});

test('the provider order is configuration, and an unconfigured one is skipped', () => {
  process.env.OLLAMA_HOST = 'http://localhost:11434';
  process.env.LLM_PROVIDER = 'ollama';
  delete process.env.NIM_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const { providers, restore } = withStubbedAxios();
  try {
    const chain = providers.resolveProviderChain();
    assert.strictEqual(chain.length, 1, 'only the configured provider belongs in the chain');
    assert.strictEqual(chain[0].name, 'ollama');
    assert.strictEqual(providers.resolveConcurrency(), 2,
      'concurrency follows the leading provider; a local GPU gets two queued requests');
  } finally {
    delete process.env.OLLAMA_HOST;
    delete process.env.LLM_PROVIDER;
    restore();
  }
});

test('without Gemini, measured routing keeps premise checks on NIM and writing local', () => {
  const previous = {
    ollama: process.env.OLLAMA_HOST,
    nim: process.env.NIM_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    order: process.env.LLM_PROVIDER
  };
  process.env.OLLAMA_HOST = 'http://localhost:11434';
  process.env.NIM_API_KEY = 'test-nim-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_PROVIDER;

  const { providers, restore } = withStubbedAxios();
  try {
    assert.deepStrictEqual(
      providers.resolveProviderChain('premise check').map(provider => provider.name),
      ['nim', 'ollama']
    );
    assert.deepStrictEqual(
      providers.resolveProviderChain('bias').map(provider => provider.name),
      ['ollama', 'nim']
    );
  } finally {
    if (previous.ollama === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = previous.ollama;
    if (previous.nim === undefined) delete process.env.NIM_API_KEY; else process.env.NIM_API_KEY = previous.nim;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous.gemini;
    if (previous.order === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = previous.order;
    restore();
  }
});

test('geminiKeys wires in GEMINI_EXTRA_KEYS, GEMINI_EXTRA_KEYS2, and GEMINI_EXTRA_KEYS3 in order', () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origExtra = process.env.GEMINI_EXTRA_KEYS;
  const origExtra2 = process.env.GEMINI_EXTRA_KEYS2;
  const origExtra3 = process.env.GEMINI_EXTRA_KEYS3;

  process.env.GEMINI_API_KEY = 'main-key';
  process.env.GEMINI_EXTRA_KEYS = 'extra-key-1';
  process.env.GEMINI_EXTRA_KEYS2 = 'extra-key-2';
  process.env.GEMINI_EXTRA_KEYS3 = 'extra-key-3';

  const { providers, restore } = withStubbedAxios();
  try {
    const keys = providers.geminiKeys();
    assert.deepStrictEqual(keys, ['main-key', 'extra-key-1', 'extra-key-2', 'extra-key-3']);

    // splitModel maps indices correctly
    assert.deepStrictEqual(providers.splitModel('gemini-3.1-flash-lite'), { model: 'gemini-3.1-flash-lite', key: 'main-key' });
    assert.deepStrictEqual(providers.splitModel('gemini-3.1-flash-lite#1'), { model: 'gemini-3.1-flash-lite', key: 'extra-key-1' });
    assert.deepStrictEqual(providers.splitModel('gemini-3.1-flash-lite#2'), { model: 'gemini-3.1-flash-lite', key: 'extra-key-2' });
    assert.deepStrictEqual(providers.splitModel('gemini-3.1-flash-lite#3'), { model: 'gemini-3.1-flash-lite', key: 'extra-key-3' });

    // gemini.models includes entries tagged with #1, #2, #3
    const models = providers.PROVIDERS.gemini.models;
    assert.ok(models.includes('gemini-3.1-flash-lite'));
    assert.ok(models.includes('gemini-3.1-flash-lite#1'));
    assert.ok(models.includes('gemini-3.1-flash-lite#2'));
    assert.ok(models.includes('gemini-3.1-flash-lite#3'));
  } finally {
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey; else delete process.env.GEMINI_API_KEY;
    if (origExtra !== undefined) process.env.GEMINI_EXTRA_KEYS = origExtra; else delete process.env.GEMINI_EXTRA_KEYS;
    if (origExtra2 !== undefined) process.env.GEMINI_EXTRA_KEYS2 = origExtra2; else delete process.env.GEMINI_EXTRA_KEYS2;
    if (origExtra3 !== undefined) process.env.GEMINI_EXTRA_KEYS3 = origExtra3; else delete process.env.GEMINI_EXTRA_KEYS3;
    restore();
  }
});

test('extra keys remain inactive when GEMINI_API_KEY is blank or unset', () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origExtra = process.env.GEMINI_EXTRA_KEYS;
  const origExtra3 = process.env.GEMINI_EXTRA_KEYS3;

  process.env.GEMINI_API_KEY = '';
  process.env.GEMINI_EXTRA_KEYS = 'extra-key-1';
  process.env.GEMINI_EXTRA_KEYS3 = 'extra-key-3';

  const { providers, restore } = withStubbedAxios();
  try {
    assert.deepStrictEqual(providers.geminiKeys(), []);
    assert.strictEqual(providers.PROVIDERS.gemini.isConfigured(), false);
  } finally {
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey; else delete process.env.GEMINI_API_KEY;
    if (origExtra !== undefined) process.env.GEMINI_EXTRA_KEYS = origExtra; else delete process.env.GEMINI_EXTRA_KEYS;
    if (origExtra3 !== undefined) process.env.GEMINI_EXTRA_KEYS3 = origExtra3; else delete process.env.GEMINI_EXTRA_KEYS3;
    restore();
  }
});
