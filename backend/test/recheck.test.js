const test = require('node:test');
const assert = require('node:assert');
const { bookRecheck, describeChange, RECHECK_HOURS } = require('../services/claimMemory');

const NOW = Date.parse('2026-10-12T10:00:00Z');
const hoursLater = (h) => new Date(NOW + h * 3600000).toISOString();

test('a reader’s unsettled claim is booked for 6, then 24, then 72 hours, and then left', () => {
  const record = { origin: 'user', recheck: {} };
  bookRecheck(record, 'CANNOT VERIFY', 'user', NOW);
  assert.strictEqual(record.recheck.due.toISOString(), hoursLater(RECHECK_HOURS[0]));
  bookRecheck(record, 'CANNOT VERIFY', 'recheck', NOW);
  assert.strictEqual(record.recheck.due.toISOString(), hoursLater(24));
  bookRecheck(record, 'CANNOT VERIFY', 'recheck', NOW);
  assert.strictEqual(record.recheck.due.toISOString(), hoursLater(72));
  bookRecheck(record, 'CANNOT VERIFY', 'recheck', NOW);
  assert.strictEqual(record.recheck.due, null);
  assert.strictEqual(record.recheck.stage, 3);
});

test('a settled verdict clears the booking', () => {
  const record = { origin: 'user', recheck: { due: new Date(NOW), stage: 1 } };
  bookRecheck(record, 'REAL', 'recheck', NOW);
  assert.strictEqual(record.recheck.due, null);
});

test('asking again does not push back a booking already made', () => {
  const due = new Date(NOW + 2 * 3600000);
  const record = { origin: 'user', recheck: { due, stage: 1 } };
  bookRecheck(record, 'CANNOT VERIFY', 'user', NOW);
  assert.strictEqual(record.recheck.due, due);
});

test('claims filed by the evaluation scripts are never booked', () => {
  const record = { origin: 'eval', recheck: {} };
  bookRecheck(record, 'CANNOT VERIFY', 'eval', NOW);
  assert.deepStrictEqual(record.recheck, {});
});

test('a changed verdict names the evidence that changed it', () => {
  const line = describeChange({
    prevCall: 'CANNOT VERIFY', call: 'REAL', trigger: 'recheck',
    prevEvidence: [],
    evidence: [
      { channel: 'news', side: 'for', source: 'The Hindu' },
      { channel: 'news', side: 'for', source: 'NDTV' },
      { channel: 'news', side: 'for', source: 'NDTV' }
    ]
  });
  assert.strictEqual(line, 'Verdict changed from CANNOT VERIFY to REAL on an automatic re-check: 2 new sources confirm it (The Hindu and NDTV).');
});

test('a new fact-check ruling and vanished sources are both named', () => {
  const line = describeChange({
    prevCall: 'REAL', call: 'FAKE',
    prevEvidence: [{ channel: 'news', side: 'for', source: 'Viral Daily' }],
    evidence: [{ channel: 'factcheck', side: 'against', source: 'Factly' }]
  });
  assert.match(line, /Factly has ruled on it/);
  assert.match(line, /1 earlier source is no longer found \(Viral Daily\)/);
});

test('the same evidence weighed differently says why', () => {
  const same = [{ channel: 'news', side: 'for', source: 'The Hindu' }];
  assert.match(describeChange({ prevCall: 'CANNOT VERIFY', call: 'REAL', prevEvidence: same, evidence: same, prevEngine: 'old-version' }),
    /the rules that weigh it have been updated/);
  assert.match(describeChange({ prevCall: 'CANNOT VERIFY', call: 'REAL', prevEvidence: same, evidence: same }),
    /only its age has changed/);
});
