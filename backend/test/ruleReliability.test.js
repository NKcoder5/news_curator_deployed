const test = require('node:test');
const assert = require('node:assert');
const { trackRecordFor } = require('../services/ruleReliability');
const table = require('../data/ruleReliability.json');

test('a rule with labelled test messages has a counted record and a 95% range around it', () => {
  const [rule, entry] = Object.entries(table.rules).find(([, r]) => !r.abstains);
  const record = trackRecordFor(rule);
  assert.strictEqual(record.n, entry.n);
  assert.strictEqual(record.right, entry.right);
  assert.ok(record.low <= record.rate && record.rate <= record.high);
  assert.ok(record.high - record.low > 0, 'a finite sample never has a zero-width range');
});

test('a rule no test message has reached has no record, rather than an invented one', () => {
  assert.strictEqual(trackRecordFor('a-rule-that-does-not-exist'), null);
  assert.strictEqual(trackRecordFor(null), null);
});
