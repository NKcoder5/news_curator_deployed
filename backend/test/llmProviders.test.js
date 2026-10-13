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
