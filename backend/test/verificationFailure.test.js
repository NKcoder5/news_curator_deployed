// An unrun check is not a finding.
//
// These tests exist because of a real report this system produced: an
// Associated Press story that NPR, ABC News, CBS News, CBC and the BBC were
// all carrying was shown to the reader as "No other outlet is reporting this,
// so nothing supports it either way." The coverage had been retrieved. The
// model's judgement of it came back unreadable, and the pipeline turned that
// silence into a statement about the world.
//
// The same shape of mistake is what the whole scoring model is built to avoid,
// so it is worth a test at each place it can happen: the search, the judgement,
// and the aggregate.
const test = require('node:test');
const assert = require('node:assert');

const NIM_PATH = require.resolve('../utils/nvidiaNimApi');
const AGENT_PATH = require.resolve('../agents/claimVerificationAgent');

/**
 * Load the agent with the model gateway replaced. Stubbing through the require
 * cache keeps this a plain unit test - no network, no keys, no flakiness.
 */
const withStubbedModel = (callNimApiJson) => {
  delete require.cache[AGENT_PATH];
  const realNim = require.cache[NIM_PATH];
  require.cache[NIM_PATH] = { id: NIM_PATH, filename: NIM_PATH, loaded: true,
    exports: { callNimApiJson, callNimApi: async () => '', extractJson: () => ({}) } };
  const agent = require(AGENT_PATH);
  return {
    agent,
    restore: () => {
      delete require.cache[AGENT_PATH];
      if (realNim) require.cache[NIM_PATH] = realNim; else delete require.cache[NIM_PATH];
    }
  };
};

const CLAIMS = [{ claim: 'A grand jury declined to bring charges.', keywords: 'grand jury charges', keywordsEn: null }];
const ENGLISH = { code: 'en', name: 'English' };

test('a coverage search that cannot run is reported as unrun, not as "no coverage"', async () => {
  // No key: every request to the index is rejected, so the search does not
  // happen. The old code returned [] here, which reads as "nobody covered it".
  const previous = process.env.NEWS_API_KEY;
  process.env.NEWS_API_KEY = '';
  const { agent, restore } = withStubbedModel(async () => {
    throw new Error('the model must never be consulted when no coverage was retrieved');
  });

  try {
    const result = await agent.verifyClaims('T', 'C', 'Associated Press', CLAIMS, false, ENGLISH);
    assert.equal(result.status, 'error');
    assert.equal(result.failed, true);
    assert.match(result.explanation, /could not be completed/i);
    // Neutral, so it cannot drag the article down either.
    assert.equal(result.score, 5);
  } finally {
    restore();
    if (previous === undefined) delete process.env.NEWS_API_KEY; else process.env.NEWS_API_KEY = previous;
  }
});

test('an unreadable judgement is not a verdict of "unverified"', async () => {
  // The exact failure behind the AP report: the reply parses, but carries no
  // verdict. Coerced to "unverified" it became a claim about other outlets.
  const { agent, restore } = withStubbedModel(async () => ({ supporting_indices: [1] }));
  const coverage = [{ source: 'NPR', title: 'Grand jury declines charges', description: '', url: 'https://npr.org/a' }];

  try {
    const judged = await agent.__test.judgeClaim('A grand jury declined to bring charges.', coverage);
    assert.equal(judged.verdict, 'undetermined');
    assert.equal(judged.failed, true);
    assert.notEqual(judged.verdict, 'unverified');
  } finally {
    restore();
  }
});

test('a model that cannot be reached leaves the claim undetermined', async () => {
  const { agent, restore } = withStubbedModel(async () => { throw new Error('502 Bad Gateway'); });
  const coverage = [{ source: 'NPR', title: 'Grand jury declines charges', description: '', url: 'https://npr.org/a' }];

  try {
    const judged = await agent.__test.judgeClaim('A grand jury declined to bring charges.', coverage);
    assert.equal(judged.verdict, 'undetermined');
    assert.equal(judged.failed, true);
  } finally {
    restore();
  }
});

test('one claim failing does not discard the claims that were checked', async () => {
  const { agent, restore } = withStubbedModel(async () => ({}));
  try {
    const results = [
      { claim: 'a', verdict: 'undetermined', failed: true },
      { claim: 'b', verdict: 'supported', supportingEvidence: [{ reliability: 9 }] }
    ];
    const summary = agent.__test.summariseResults(results);
    assert.equal(summary.status, 'corroborated');
    assert.equal(summary.partialFailure, true);
    assert.match(summary.explanation, /could not be checked at all/i);
  } finally {
    restore();
  }
});

// The plain-language summary is what most readers actually read, so the same
// rule has to hold there: an outage may not be written up as a finding about
// coverage.
test('the summary does not report an outage as an absence of coverage', async () => {
  process.env.NIM_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.OLLAMA_HOST = '';
  const previousNews = process.env.NEWS_API_KEY;
  process.env.NEWS_API_KEY = '';
  delete require.cache[require.resolve('../agents/trustAnalysisAgent')];
  const { analyzeTrust } = require('../agents/trustAnalysisAgent');

  try {
    const report = await analyzeTrust({
      title: 'Mississippi grand jury finds no cause for charges in the July death of Nolan Wells',
      source: 'Associated Press',
      url: 'https://apnews.com/article/nolan-wells-grand-jury',
      content: "A grand jury has found there wasn't evidence to bring charges in the death of Nolan Wells after a July 4 boating trip off the Mississippi Gulf Coast. The decision was announced by district attorney Angel Myers McIlrath.",
      textCoverage: 'full'
    });

    assert.ok(
      !report.concernPoints.some(p => /could not find other outlets covering/i.test(p)),
      'an unrun search must not be summarised as "no other outlet covers this"'
    );
    assert.match(report.oneLine, /could not complete/i);
  } finally {
    if (previousNews === undefined) delete process.env.NEWS_API_KEY;
    else process.env.NEWS_API_KEY = previousNews;
  }
});

// Constrained decoding without a shape check is not enough.
//
// Asked for {verdict, supporting_indices, contradicting_indices, explanation}
// over eight pieces of coverage, a model in JSON mode returned the bare array
// `[1]`. That parses. It carries no verdict, so the judgement fell through to
// undetermined and the reader was told the check had not run — about a story
// five outlets were carrying. The gateway now rejects a reply that lacks the
// keys the caller named, and says so on the retry.
test('a JSON reply without the required keys is rejected, not accepted', async () => {
  delete require.cache[require.resolve('../utils/nvidiaNimApi')];
  const nimPath = require.resolve('../utils/nvidiaNimApi');
  const llmPath = require.resolve('../utils/llmProviders');
  const realLlm = require.cache[llmPath];

  const prompts = [];
  require.cache[llmPath] = {
    id: llmPath, filename: llmPath, loaded: true,
    exports: {
      ...(realLlm ? realLlm.exports : {}),
      resolveProviderChain: () => ([{
        name: 'stub', label: 'Stub', models: ['m'], concurrency: 1,
        isConfigured: () => true,
        send: async ({ prompt }) => {
          prompts.push(prompt);
          // First reply: valid JSON, wrong shape. Second: the real answer.
          return prompts.length === 1 ? '[1]' : '{"verdict":"supported","supporting_indices":[1]}';
        }
      }]),
      resolveConcurrency: () => 1
    }
  };

  try {
    const { callNimApiJson } = require(nimPath);
    const out = await callNimApiJson('judge this', { requiredKeys: ['verdict'] });
    assert.equal(out.verdict, 'supported');
    assert.equal(prompts.length, 2, 'the bad shape should have forced a second attempt');
    // The retry has to say what was wrong; repeating the same prompt is not a retry.
    assert.match(prompts[1], /did not contain verdict/i);
  } finally {
    delete require.cache[nimPath];
    if (realLlm) require.cache[llmPath] = realLlm; else delete require.cache[llmPath];
  }
});
