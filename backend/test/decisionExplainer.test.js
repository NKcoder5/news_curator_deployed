const test = require('node:test');
const assert = require('node:assert');
const { explainDecision } = require('../services/decisionExplainer');
const { replayVerdict } = require('../agents/verdictEngine');

const outlet = (source, title, reported = '') =>
  ({ source, title, description: '', url: `https://${source.replace(/\s/g, '')}.test/${title.length}`, reliability: 8, publishedAt: '2026-10-09T08:00:00Z', reported });

const base = (claims, extra = {}) => ({
  claims,
  verificationStatus: 'contradicted',
  premiseResult: { status: 'consistent', contradictions: [], confirmations: [] },
  factCheckResult: { status: 'none', matches: [] },
  currentCoverageResult: { status: 'silent', subject: 'x', headlinesRead: 20, outletsRead: 9, presupposingFalse: [] },
  unconfirmedClaimResult: null,
  sourceResult: { matched: false, score: 5, impersonates: null, type: null },
  transparencyResult: { score: 6 },
  manipulationResult: { techniques: [] },
  title: claims[0]?.claim || '',
  publishedAt: null, domainAge: null, indexLagHours: 3,
  asOf: Date.parse('2026-10-12T07:30:00Z'),
  ...extra
});

const figureClaim = {
  claim: 'India won 84 medals at the Asian Games 2026.', verdict: 'contradicted', time: 'past',
  supportingEvidence: [],
  contradictingEvidence: [
    outlet('DD India', 'India ends Asian Games campaign with 85 medals', '85 medals'),
    outlet('The Indian Express', 'Complete list of all 85 medals won by India', '85 medals'),
    outlet('News On AIR', 'India finishes 4th with 85 medals', '85 medals')
  ]
};

test('the decisive channel is the one whose removal changes the verdict', () => {
  const x = explainDecision(base([figureClaim]));
  assert.strictEqual(x.verdict.call, 'FAKE');
  const news = x.decisive.find(d => d.channel === 'news-against');
  assert.strictEqual(news.decisive, true);
  assert.notStrictEqual(news.without.call, 'FAKE');
});

test('the explanation is faithful: removing the decisive evidence really changes the verdict', () => {
  const input = base([figureClaim]);
  const x = explainDecision(input);
  for (const d of x.decisive) {
    const changed = JSON.parse(JSON.stringify(input));
    if (d.channel === 'news-against') changed.claims.forEach(c => { c.contradictingEvidence = []; });
    assert.strictEqual(replayVerdict(changed).call === x.verdict.call, !d.decisive);
  }
});

test('a verdict resting on two independent lines of evidence says so', () => {
  const x = explainDecision(base([figureClaim], {
    factCheckResult: { status: 'debunked', matches: [{ publisher: 'Factly', finding: 'false', rating: 'False', claimReviewed: 'India won 84 medals', url: 'https://factly.test/x' }] }
  }));
  assert.strictEqual(x.verdict.call, 'FAKE');
  assert.ok(x.restsOn >= 2, `expected two lines of evidence, got ${x.restsOn}`);
  assert.ok(x.decisive.every(d => d.decisive === false), 'neither line alone is decisive when the other also gives FAKE');
});

test('what would change it: an even split leaves it undecided, a majority confirms it', () => {
  const x = explainDecision(base([figureClaim]));
  const steps = x.wouldChange.filter(w => w.added.stance === 'for');
  assert.deepStrictEqual(steps.map(w => [w.added.outlets, w.result.call]), [[3, 'CANNOT VERIFY'], [4, 'REAL']]);
  assert.strictEqual(x.wouldChange.filter(w => w.added.stance === 'against').length, 0,
    'more contradiction cannot change a verdict that is already FAKE');
});

test('an unconfirmed claim needs only one independent outlet to be confirmed', () => {
  const x = explainDecision(base([{ claim: 'A new bakery opened on Gandhi Road in Erode.', verdict: 'no-coverage', time: 'past', supportingEvidence: [], contradictingEvidence: [] }],
    { verificationStatus: 'unverified' }));
  assert.strictEqual(x.verdict.call, 'CANNOT VERIFY');
  const flip = x.wouldChange.find(w => /confirming/.test(w.change));
  assert.match(flip.change, /^1 more independent outlet confirming it$/);
  assert.strictEqual(flip.result.call, 'REAL');
  assert.ok(x.wouldChange.some(w => /fact-checker/.test(w.change) && w.result.call === 'FAKE'));
});

test('an answer that stands with every line of evidence removed is said to come from absence', () => {
  const x = explainDecision(base([{ claim: 'A new bakery opened on Gandhi Road in Erode.', verdict: 'no-coverage', time: 'past', supportingEvidence: [], contradictingEvidence: [] }],
    { verificationStatus: 'unverified' }));
  assert.strictEqual(x.fromAbsence, true);
  assert.strictEqual(x.restsOn, 0);
});

test('a high-impact claim judged on warning signs names the writing as decisive, not "several lines of evidence"', () => {
  const x = explainDecision(base([{ claim: 'RBI has banned 500 rupee notes from tomorrow.', verdict: 'no-coverage', time: 'now', supportingEvidence: [], contradictingEvidence: [] }], {
    verificationStatus: 'unverified',
    manipulationResult: { techniques: [{ technique: 'urgency' }, { technique: 'fear appeal' }] }
  }));
  assert.strictEqual(x.verdict.rule, 'uncorroborated-high-impact-with-risk-signals');
  const writing = x.decisive.find(d => d.channel === 'writing');
  assert.strictEqual(writing.decisive, true);
  assert.strictEqual(writing.without.call, 'CANNOT VERIFY');
  assert.strictEqual(x.fromAbsence, false);
});
