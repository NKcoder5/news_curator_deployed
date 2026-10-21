// The stance step with our own pair model in front of the hosted one
// (STANCE_MODEL=hybrid, agents/claimVerificationAgent.js).
const test = require('node:test');
const assert = require('node:assert');

let hostedCalls = 0;
let hostedReply = null;
let hostedProvider = 'gemini';
let ownReadings = [];
const STUBS = {
  '../utils/nvidiaNimApi': {
    callNimApiJson: async (prompt, options = {}) => {
      hostedCalls += 1;
      if (options.meta) options.meta.provider = hostedProvider;
      if (hostedReply instanceof Error) throw hostedReply;
      return hostedReply;
    },
    withRetry: (fn) => fn()
  },
  '../services/localNli': {
    judgePairs: async (pairs) => pairs.map((_, i) => ownReadings[i] || null),
    judgePair: async () => null,
    isAvailable: () => true
  },
  // Fixed here, not read from data/stanceThresholds.json, which follows whichever model is shipped
  // (every stance off for the current one): these tests are about the hybrid logic, not a model.
  '../data/stanceThresholds.json': { agree: 0.97, disagree: 0.99, unrelated: 0.95 }
};
const saved = {};
for (const [name, exports] of Object.entries(STUBS)) {
  const p = require.resolve(name);
  saved[p] = require.cache[p];
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
delete require.cache[require.resolve('../agents/claimVerificationAgent')];
const { __test: { judgeClaim } } = require('../agents/claimVerificationAgent');

test.after(() => {
  delete require.cache[require.resolve('../agents/claimVerificationAgent')];
  for (const [p, real] of Object.entries(saved)) {
    if (real) require.cache[p] = real; else delete require.cache[p];
  }
  delete process.env.STANCE_MODEL;
});

const CLAIM = 'India won 85 medals at the Asian Games.';
const outlet = (source, title) => ({ source, title, description: '', url: `https://${source.toLowerCase().replace(/\s+/g, '')}.test/a`, publishedAt: '2026-10-05' });
const COVERAGE = [
  outlet('The Hindu', 'India finish Asian Games with 85 medals'),
  outlet('NDTV', 'Asian Games: India end campaign with 85 medals'),
  outlet('Indian Express', 'India medal tally at Asian Games reaches 85')
];
const reading = (label, p) => {
  const rest = (1 - p) / 2;
  const scores = { entailment: rest, neutral: rest, contradiction: rest };
  scores[label] = p;
  return { label, scores };
};
const reset = (mode) => {
  hostedCalls = 0;
  hostedProvider = 'gemini';
  hostedReply = { items: COVERAGE.map((_, i) => ({ n: i + 1, stance: 'agree', same_event: true, both_can_be_true: true, reported: '85 medals' })), explanation: 'hosted' };
  if (mode) process.env.STANCE_MODEL = mode; else delete process.env.STANCE_MODEL;
};

test('off: the hosted model judges, as before', async () => {
  reset(null);
  ownReadings = COVERAGE.map(() => reading('entailment', 0.999));
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(hostedCalls, 1);
  assert.strictEqual(judged.verdict, 'supported');
});

test('hybrid: sure of every headline, our model judges and no hosted model is asked', async () => {
  reset('hybrid');
  ownReadings = COVERAGE.map(() => reading('entailment', 0.995));
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(hostedCalls, 0);
  assert.strictEqual(judged.verdict, 'supported');
  assert.strictEqual(judged.supportingEvidence.length, 3);
});

test('hybrid: unsure of one headline, the hosted model decides', async () => {
  reset('hybrid');
  ownReadings = [reading('entailment', 0.995), reading('entailment', 0.6), reading('entailment', 0.995)];
  hostedReply = { items: COVERAGE.map((_, i) => ({ n: i + 1, stance: 'unrelated', same_event: false, both_can_be_true: true, reported: '' })), explanation: 'hosted' };
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(hostedCalls, 1);
  assert.strictEqual(judged.supportingEvidence.length, 0, 'the hosted reading is the one used');
});

test('hybrid: the hosted model failing leaves the readings ours is sure of, the rest saying nothing', async () => {
  reset('hybrid');
  ownReadings = [reading('entailment', 0.995), reading('entailment', 0.6), reading('entailment', 0.995)];
  hostedReply = new Error('quota');
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(hostedCalls, 1);
  assert.strictEqual(judged.verdict, 'supported');
  assert.strictEqual(judged.supportingEvidence.length, 2);
  assert.ok(!judged.failed);
});

test('hybrid: a "disagree" below its stricter threshold counts for nothing', async () => {
  reset('hybrid');
  ownReadings = COVERAGE.map(() => reading('contradiction', 0.975));
  hostedReply = new Error('quota');
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.contradictingEvidence.length, 0);
  assert.notStrictEqual(judged.verdict, 'contradicted');
});

test('hybrid: a question headline reports nothing, however sure our model is', async () => {
  reset('hybrid');
  const asked = [outlet('WHIO TV', 'Did India win 85 medals at the Asian Games?')];
  ownReadings = [reading('entailment', 0.999)];
  const judged = await judgeClaim(CLAIM, asked);
  assert.strictEqual(hostedCalls, 0);
  assert.strictEqual(judged.supportingEvidence.length, 0);
});

test('hybrid: the hosted model failing and ours sure of nothing is a failed judgement, not "no outlet reports this"', async () => {
  reset('hybrid');
  ownReadings = COVERAGE.map(() => reading('entailment', 0.6));
  hostedReply = new Error('quota');
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.failed, true);
  assert.strictEqual(judged.verdict, 'undetermined');
});

test('local: sure of nothing, the figures still decide a different total', async () => {
  reset('local');
  ownReadings = COVERAGE.map(() => reading('neutral', 0.5));
  const judged = await judgeClaim('India won 84 medals at the Asian Games.', COVERAGE);
  assert.strictEqual(judged.verdict, 'contradicted');
  assert.ok(judged.figures, 'decided by the figures');
});

const disagreeing = () => ({ items: COVERAGE.map((_, i) => ({ n: i + 1, stance: 'disagree', same_event: true, both_can_be_true: false, reported: '' })), explanation: 'hosted' });

test(`a fallback model's "disagree" is set aside where our model is sure the headline says the claim`, async () => {
  reset(null);
  hostedProvider = 'nim';
  hostedReply = disagreeing();
  ownReadings = COVERAGE.map(() => reading('entailment', 0.95));
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.contradictingEvidence.length, 0);
  assert.notStrictEqual(judged.verdict, 'contradicted');
  assert.match(judged.explanation, /fallback model/);
});

test(`Gemini's own "disagree" stands, whatever our model reads`, async () => {
  reset(null);
  hostedProvider = 'gemini';
  hostedReply = disagreeing();
  ownReadings = COVERAGE.map(() => reading('entailment', 0.95));
  const judged = await judgeClaim('India won 85 medals at the Asian Games, the most ever.', COVERAGE);
  assert.ok(judged.contradictingEvidence.length > 0 || judged.verdict === 'contradicted');
});

test('local: one outlet our model reads as agreeing does not confirm the claim', async () => {
  reset('local');
  ownReadings = [reading('entailment', 0.995), reading('neutral', 0.5), reading('neutral', 0.5)];
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.verdict, 'unverified');
  assert.strictEqual(judged.ownJudged, true);
  assert.match(judged.explanation, /not enough to confirm/);
});

test(`local: two outlets our model reads as agreeing confirm it`, async () => {
  reset('local');
  ownReadings = [reading('entailment', 0.995), reading('entailment', 0.995), reading('neutral', 0.5)];
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.verdict, 'supported');
  assert.strictEqual(judged.ownJudged, true);
});

test(`the hosted model's reading is not marked as ours`, async () => {
  reset(null);
  ownReadings = COVERAGE.map(() => reading('entailment', 0.999));
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.ownJudged, false);
});

test(`local: our model's "agree" does not stand when the headline reverses who did what`, async () => {
  reset('local');
  const reversed = [
    outlet('The Hindu', 'India beat Australia in the World Cup final'),
    outlet('NDTV', 'World Cup final: India beat Australia to lift the trophy')
  ];
  ownReadings = reversed.map(() => reading('entailment', 0.999));
  const judged = await judgeClaim('Australia beat India in the World Cup final', reversed);
  assert.strictEqual(judged.supportingEvidence.length, 0);
  assert.notStrictEqual(judged.verdict, 'supported');
});

test(`a fallback model's "agree" is set aside where our model is sure the headline says the opposite`, async () => {
  reset(null);
  hostedProvider = 'ollama';
  ownReadings = COVERAGE.map(() => reading('contradiction', 0.97));
  const judged = await judgeClaim(CLAIM, COVERAGE);
  assert.strictEqual(judged.supportingEvidence.length, 0);
  assert.notStrictEqual(judged.verdict, 'supported');
});
