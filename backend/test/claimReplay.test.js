const test = require('node:test');
const assert = require('node:assert');
const { buildEvidenceLedger, decideVerdict, compactLedgerInput, replayVerdict } = require('../agents/verdictEngine');

const outlet = (source, title, publishedAt, reported = '') =>
  ({ source, title, description: '', url: `https://${source.replace(/\s/g, '')}.test/${title.length}`, reliability: 8, publishedAt, reported, extra: 'not needed' });

// A full input as the analysis builds it, including fields the ledger never reads.
const input = (claims, extra = {}) => ({
  claims,
  verificationStatus: 'contradicted',
  premiseResult: { status: 'consistent', contradictions: [], confirmations: [], checked: ['dropped'] },
  factCheckResult: { status: 'none', matches: [], considered: 4, queries: ['dropped'] },
  currentCoverageResult: { status: 'silent', subject: 'Asian Games India', headlinesRead: 20, outletsRead: 9, presupposingFalse: [], reporting: [] },
  unconfirmedClaimResult: null,
  sourceResult: { matched: false, score: 5, type: null, explanation: 'dropped' },
  transparencyResult: { score: 6, checks: ['dropped'] },
  manipulationResult: { techniques: [{ technique: 'Loaded language', quote: 'dropped' }] },
  title: 'India won 84 medals at the Asian Games 2026',
  publishedAt: null,
  domainAge: null,
  asOf: Date.parse('2026-10-12T07:30:00Z'),
  ...extra
});

const stored = (full) => JSON.parse(JSON.stringify(compactLedgerInput(full)));   // as the database keeps it

test('a stored verdict replays to the identical verdict and rule', () => {
  const full = input([{
    claim: 'India won 84 medals at the Asian Games 2026.', verdict: 'contradicted', time: 'past', kind: 'figure',
    supportingEvidence: [],
    contradictingEvidence: [
      outlet('DD India', 'India ends Asian Games campaign with 85 medals', '2026-10-09T06:59:00Z', '85 medals'),
      outlet('The Indian Express', 'Complete list of all 85 medals won', '2026-10-08T10:00:00Z', '85 medals'),
      outlet('News On AIR', 'India finishes 4th with 85 medals', '2026-10-09T12:00:00Z', '85 medals')
    ]
  }]);
  const original = decideVerdict(buildEvidenceLedger(full));
  const replayed = replayVerdict(stored(full));
  assert.strictEqual(replayed.call, original.call);
  assert.strictEqual(replayed.rule, original.rule);
  assert.strictEqual(replayed.oneLine, original.oneLine);
});

test('a time-dependent verdict replays as it was reached, not as it would be today', () => {
  // A claim presented as happening now, confirmed by coverage ten days before
  // the check: not yet "old news" at the time (that needs three weeks), so REAL.
  const asOf = Date.parse('2026-10-12T07:30:00Z');
  const tenDaysBefore = new Date(asOf - 10 * 86400000).toISOString();
  const full = input([{
    claim: 'The RBI raised the repo rate to 5.5%.', verdict: 'supported', time: 'now', kind: 'event',
    supportingEvidence: [
      outlet('The Hindu', 'RBI raises repo rate by 25 basis points to 5.50%', tenDaysBefore, 'raises repo rate'),
      outlet('Reuters', 'India raises policy rate by 25 bps', tenDaysBefore, 'raises policy rate')
    ],
    contradictingEvidence: []
  }], { verificationStatus: 'corroborated', asOf });
  const record = stored(full);
  assert.strictEqual(replayVerdict(record).call, 'REAL');
  // Re-reached a month later from the clock it would be old news; from the
  // record it is still what was concluded then.
  const aMonthLater = { ...record, asOf: asOf + 30 * 86400000 };
  assert.strictEqual(replayVerdict(aMonthLater).rule, 'old-news-presented-as-new');
  assert.strictEqual(replayVerdict(record).rule, 'corroborated-by-multiple-independent-sources');
});

test('the stored input keeps what the verdict read and drops what it did not', () => {
  const full = input([{ claim: 'x claim', verdict: 'unverified', supportingEvidence: [outlet('A', 'B title', null)], contradictingEvidence: [] }]);
  const record = stored(full);
  assert.strictEqual(record.sourceResult.explanation, undefined);
  assert.strictEqual(record.transparencyResult.checks, undefined);
  assert.strictEqual(record.claims[0].supportingEvidence[0].extra, undefined);
  assert.strictEqual(record.manipulationResult.techniques.length, 1);
  assert.strictEqual(record.asOf, full.asOf);
});
