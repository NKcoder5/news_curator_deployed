const test = require('node:test');
const assert = require('node:assert');
const { buildEvidenceLedger, decideVerdict } = require('../agents/verdictEngine');
const { subjectsFor } = require('../agents/currentCoverage');
const { weighCurrentCoverage } = require('../agents/weightOfEvidence');

const claim = { claim: 'PM Modi resigned as Prime Minister today.', verdict: 'unverified', supportingEvidence: [], contradictingEvidence: [] };
const ledgerFor = (overrides = {}) => buildEvidenceLedger({
  claims: [claim],
  sourceResult: { matched: false, score: 5 },
  transparencyResult: { score: 5 },
  manipulationResult: { techniques: [] },
  title: claim.claim,
  ...overrides
});

const headline = (source, title, reported) => ({ source, title, url: `https://${source.replace(/\s/g, '')}.test/x`, publishedAt: '2026-10-11T08:00:00Z', reported, reliability: 0 });

test('subjects come from the extractor, once each', () => {
  assert.deepStrictEqual(subjectsFor([{ subject: 'Narendra Modi' }, { subject: 'narendra modi' }, { subject: '' }]), ['Narendra Modi']);
});

test('two outlets whose news this week rules the claim out make it probably false', () => {
  const decision = decideVerdict(ledgerFor({
    currentCoverageResult: {
      status: 'presupposed-false', subject: 'Narendra Modi', headlinesRead: 20, outletsRead: 9,
      presupposingFalse: [
        headline('News On AIR', 'PM Modi launches development projects worth Rs 13,000 crore in Tamil Nadu', 'PM Modi launches development projects'),
        headline('NDTV', 'PM Modi reaches out to Gen Z in Chennai', 'PM Modi reaches out to Gen Z')
      ]
    }
  }));
  assert.strictEqual(decision.call, 'FAKE');
  assert.strictEqual(decision.rule, 'contradicted-by-current-coverage');
  assert.match(decision.oneLine, /PM Modi launches development projects/);
});

test('one such outlet is not enough', () => {
  const decision = decideVerdict(ledgerFor({
    currentCoverageResult: {
      status: 'presupposed-false', subject: 'Narendra Modi', headlinesRead: 20, outletsRead: 9,
      presupposingFalse: [headline('NDTV', 'PM Modi reaches out to Gen Z in Chennai', 'PM Modi reaches out')]
    }
  }));
  assert.strictEqual(decision.call, 'CANNOT VERIFY');
});

test('absence counts only from heavy coverage', () => {
  const absent = (headlinesRead, outletsRead) => decideVerdict(ledgerFor({
    currentCoverageResult: { status: 'absent', subject: 'Virat Kohli', headlinesRead, outletsRead, presupposingFalse: [] }
  }));
  assert.strictEqual(absent(20, 14).rule, 'absent-from-heavy-coverage');
  assert.strictEqual(absent(20, 14).call, 'FAKE');
  assert.strictEqual(absent(9, 4).call, 'CANNOT VERIFY');
});

test('the week is ignored when the event itself is reported', () => {
  const outlet = (source, title) => ({ source, title, description: '', url: `https://${source}.test/y`, reliability: 8 });
  const decision = decideVerdict(ledgerFor({
    claims: [{ ...claim, verdict: 'supported', supportingEvidence: [outlet('Reuters', 'Modi steps down as prime minister'), outlet('BBC News', 'India\'s Modi resigns')] }],
    currentCoverageResult: {
      status: 'presupposed-false', subject: 'Narendra Modi', headlinesRead: 20, outletsRead: 9,
      presupposingFalse: [headline('A', 'PM Modi in Chennai', 'PM Modi in Chennai'), headline('B', 'PM Modi meets Gen Z', 'PM Modi meets')]
    }
  }));
  assert.strictEqual(decision.call, 'REAL');
});

test('the week enters the probability only when it was counted', () => {
  assert.ok(weighCurrentCoverage('presupposedFalse').decibans > 10);
  assert.ok(weighCurrentCoverage('absentFromHeavyCoverage').decibans > 5);
  assert.strictEqual(weighCurrentCoverage(null), null);
});
