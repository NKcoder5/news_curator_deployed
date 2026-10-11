const test = require('node:test');
const assert = require('node:assert');
const { buildEvidenceLedger, decideVerdict } = require('../agents/verdictEngine');

const outlet = (source, title, publishedAt = new Date().toISOString(), reported = '') =>
  ({ source, title, description: '', url: `https://${source.replace(/\s/g, '')}.test/${encodeURIComponent(title).slice(0, 20)}`, reliability: 8, publishedAt, reported });

const ledgerFor = (claims, extra = {}) => buildEvidenceLedger({
  claims,
  sourceResult: { matched: false, score: 5 },
  transparencyResult: { score: 5 },
  manipulationResult: { techniques: [] },
  title: claims[0]?.claim || '',
  ...extra
});

test('one claim confirmed and another contradicted is PARTLY FALSE, not REAL or FAKE', () => {
  const decision = decideVerdict(ledgerFor([
    { claim: 'India won 85 medals at the Asian Games 2026.', verdict: 'supported',
      supportingEvidence: [outlet('DD India', 'India ends campaign with 85 medals'), outlet('The Hindu', 'Record 85-medal haul for India')], contradictingEvidence: [] },
    { claim: 'The RBI cut the repo rate by 50 basis points.', verdict: 'contradicted', supportingEvidence: [],
      contradictingEvidence: [outlet('Reuters', 'RBI raises repo rate by 25 bps', undefined, 'raises repo rate by 25 bps'), outlet('NDTV', 'RBI hikes rates to 5.5%', undefined, 'hikes rates to 5.5%')] }
  ]));
  assert.strictEqual(decision.call, 'PARTLY FALSE');
  assert.strictEqual(decision.rule, 'claims-partly-false');
  assert.match(decision.oneLine, /raises repo rate by 25 bps/);
});

test('a "now" claim confirmed only by years-old coverage is old news, not REAL', () => {
  const old = '2016-11-08T18:00:00Z';
  const decision = decideVerdict(ledgerFor([
    { claim: 'Narendra Modi announced that 500 and 1000 rupee notes will be invalid from midnight tonight.', verdict: 'supported', time: 'now',
      supportingEvidence: [outlet('BBC News', 'India scraps 500 and 1000 rupee notes', old), outlet('The Hindu', 'Rs 500, Rs 1000 notes withdrawn', old)],
      contradictingEvidence: [] }
  ]));
  assert.strictEqual(decision.call, 'FAKE');
  assert.strictEqual(decision.rule, 'old-news-presented-as-new');
  assert.match(decision.oneLine, /2016-11-08/);
});

test('the same claim about the past is simply confirmed', () => {
  const old = '2016-11-08T18:00:00Z';
  const decision = decideVerdict(ledgerFor([
    { claim: 'India withdrew 500 and 1000 rupee notes in November 2016.', verdict: 'supported', time: 'past',
      supportingEvidence: [outlet('BBC News', 'India scraps 500 and 1000 rupee notes', old), outlet('The Hindu', 'Rs 500, Rs 1000 notes withdrawn', old)],
      contradictingEvidence: [] }
  ]));
  assert.strictEqual(decision.call, 'REAL');
});

test('a standing fact stated by a reference entry is confirmed without news coverage', () => {
  const decision = decideVerdict(ledgerFor(
    [{ claim: 'Bengaluru is the capital of Karnataka.', verdict: 'no-coverage', time: 'timeless', kind: 'standing_fact', supportingEvidence: [], contradictingEvidence: [] }],
    { premiseResult: { status: 'consistent', contradictions: [], confirmations: [{ entity: 'Karnataka', referenceStates: 'Its capital and largest city is Bengaluru.' }] } }
  ));
  assert.strictEqual(decision.call, 'REAL');
  assert.strictEqual(decision.rule, 'confirmed-by-reference');
});

test('a reference entry cannot confirm today\'s news', () => {
  const decision = decideVerdict(ledgerFor(
    [{ claim: 'Narendra Modi resigned today.', verdict: 'no-coverage', time: 'now', kind: 'event', supportingEvidence: [], contradictingEvidence: [] }],
    { premiseResult: { status: 'consistent', contradictions: [], confirmations: [{ entity: 'Narendra Modi', referenceStates: 'Narendra Modi is an Indian politician.' }] } }
  ));
  assert.notStrictEqual(decision.call, 'REAL');
});
