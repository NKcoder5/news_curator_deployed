// The four writing checks in one model call (agents/writingChecks.js): each part of the reply is read by
// its own agent's reader, a part that cannot be read falls back to that factor's pattern check alone, and
// the orchestrator starts one call for all four.
const test = require('node:test');
const assert = require('node:assert');

const NIM_PATH = require.resolve('../utils/nvidiaNimApi');
const MODULE_PATH = require.resolve('../agents/writingChecks');

const withReply = (reply) => {
  const real = require.cache[NIM_PATH];
  const prompts = [];
  require.cache[NIM_PATH] = { id: NIM_PATH, filename: NIM_PATH, loaded: true, exports: {
    callNimApi: async () => '', extractJson: () => null,
    callNimApiJson: async (prompt, options) => {
      prompts.push({ prompt, options });
      if (reply instanceof Error) throw reply;
      return reply;
    }
  } };
  for (const a of ['writingChecks', 'clickbaitAgent', 'biasAgent', 'manipulationAgent', 'transparencyAgent']) delete require.cache[require.resolve(`../agents/${a}`)];
  return {
    mod: require(MODULE_PATH),
    prompts,
    restore: () => {
      if (real) require.cache[NIM_PATH] = real; else delete require.cache[NIM_PATH];
      for (const a of ['writingChecks', 'clickbaitAgent', 'biasAgent', 'manipulationAgent', 'transparencyAgent']) delete require.cache[require.resolve(`../agents/${a}`)];
    }
  };
};

const TITLE = 'SHOCKING: Officials hiding the truth about the dam';
const TEXT = 'Experts say the dam could burst at any moment. Everyone knows the government is lying.';
const REPLY = {
  headline: { clickbait_score: 8, signals: ['Sensational wording'], explanation: 'Sensational.' },
  bias: { bias_score: 7, political_lean: 'none-detected', flagged_sentences: [{ sentence: 'Everyone knows the government is lying.', type: 'opinion as fact', reason: 'Asserted.' }], explanation: 'One-sided.' },
  persuasion: { intensity: 'moderate', techniques: [{ technique: 'appeal to fear', quote: 'the dam could burst at any moment', effect: 'Alarms.' }, { technique: 'bandwagon', quote: 'Everyone knows', effect: 'Popularity as proof.' }], summary: 'Alarmist.' },
  sourcing: { checks: { namedSources: false, directQuotes: false, primaryEvidence: false, specificDetail: false, measuredClaims: false }, named_examples: [], vague_attributions: ['Experts say'], summary: 'Unsourced.' }
};

test('one call reads all four factors, each as its own agent would', async () => {
  const { mod, prompts, restore } = withReply(REPLY);
  try {
    const w = await mod.analyzeWriting(TITLE, TEXT);
    assert.strictEqual(prompts.length, 1, 'one model call');
    assert.strictEqual(prompts[0].options.temperature, 0);
    assert.strictEqual(prompts[0].options.label, 'writing checks');
    assert.strictEqual(w.clickbait.score, 2);
    assert.strictEqual(w.clickbait.isClickbait, true);
    assert.strictEqual(w.bias.score, 3);
    assert.strictEqual(w.bias.flaggedSentences[0].type, 'opinion as fact');
    assert.deepStrictEqual(w.manipulation.techniques.map(t => t.technique), ['appeal to fear', 'bandwagon']);
    assert.strictEqual(w.manipulation.score, 4.8);
    assert.strictEqual(w.transparency.score, 0);
    assert.deepStrictEqual(w.transparency.vagueAttributions, ['Experts say']);
    for (const f of ['clickbait', 'bias', 'manipulation', 'transparency']) {
      assert.strictEqual(w[f].method, 'model');
      assert.ok(!w[f].degraded);
    }
    assert.match(prompts[0].prompt, /<<<|headline/i);
  } finally {
    restore();
  }
});

test('a part that cannot be read falls back to its own pattern check, and the others stand', async () => {
  const { mod, restore } = withReply({ ...REPLY, bias: { bias_score: 'high' } });
  const error = console.error; console.error = () => {};
  try {
    const w = await mod.analyzeWriting(TITLE, TEXT);
    assert.strictEqual(w.bias.degraded, true);
    assert.strictEqual(w.bias.method, 'rules');
    assert.strictEqual(w.clickbait.method, 'model');
    assert.strictEqual(w.transparency.method, 'model');
  } finally {
    console.error = error;
    restore();
  }
});

test('a failed call gives every factor its pattern check, and never rejects', async () => {
  const { mod, restore } = withReply(new Error('provider unreachable'));
  const error = console.error; console.error = () => {};
  try {
    const w = await mod.analyzeWriting(TITLE, TEXT);
    for (const f of ['clickbait', 'bias', 'manipulation', 'transparency']) {
      assert.strictEqual(w[f].degraded, true, f);
      assert.strictEqual(w[f].method, 'rules', f);
      assert.strictEqual(typeof w[f].score, 'number', f);
    }
  } finally {
    console.error = error;
    restore();
  }
});

test('the headline is not repeated when the text opens with it', () => {
  const { __test: { textOf } } = require(MODULE_PATH);
  assert.strictEqual(textOf('Rains lash Chennai', 'Rains lash Chennai. Schools shut.'), 'Rains lash Chennai. Schools shut.');
  assert.strictEqual(textOf('Rains lash Chennai', 'Schools shut today.'), 'Rains lash Chennai. Schools shut today.');
  assert.strictEqual(textOf('Rains lash Chennai', ''), 'Rains lash Chennai');
});

test('WRITING_CHECKS=merged makes the orchestrator ask once for all four', async () => {
  const saved = process.env.WRITING_CHECKS;
  process.env.WRITING_CHECKS = 'merged';
  const { prompts, restore } = withReply(REPLY);
  const agentPath = require.resolve('../agents/trustAnalysisAgent');
  delete require.cache[agentPath];
  try {
    const { startMessageChecks } = require(agentPath);
    const early = startMessageChecks({ title: TITLE, content: TEXT });
    const [c, b, m, t] = await Promise.all(['clickbait', 'bias', 'manipulation', 'transparency'].map(f => early.tasks[f]));
    await early.tasks.premises.catch(() => null);
    assert.strictEqual(prompts.filter(p => p.options.label === 'writing checks').length, 1);
    assert.strictEqual(prompts.filter(p => ['clickbait', 'bias', 'manipulation', 'transparency'].includes(p.options.label)).length, 0);
    assert.deepStrictEqual([c.score, b.score, m.score, t.score], [2, 3, 4.8, 0]);
  } finally {
    if (saved === undefined) delete process.env.WRITING_CHECKS; else process.env.WRITING_CHECKS = saved;
    delete require.cache[agentPath];
    restore();
  }
});
