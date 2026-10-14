const test = require('node:test');
const assert = require('node:assert');
const { arithmeticReport, evaluate } = require('../services/arithmetic');

test('an equation is worked out and answered with the working', () => {
  const wrong = arithmeticReport('2 + 2 = 5');
  assert.strictEqual(wrong.call, 'FAKE');
  assert.strictEqual(wrong.oneLine, 'False: 2 + 2 is 4, not 5.');
  assert.strictEqual(wrong.decision.rule, 'arithmetic');
  assert.strictEqual(arithmeticReport('12 × 3 = 36').call, 'REAL');
  assert.strictEqual(arithmeticReport('(10 - 4) / 2 = 3').call, 'REAL');
  assert.strictEqual(arithmeticReport('2^10 = 1024.').call, 'REAL');
});

test('anything that is not a bare equation goes through the ordinary check', () => {
  assert.strictEqual(arithmeticReport('India won 84 medals'), null);
  assert.strictEqual(arithmeticReport('5 = 5'), null, 'no operation to work out');
  assert.strictEqual(arithmeticReport('2 + 2 = 4 = 5'), null);
  assert.strictEqual(arithmeticReport('1 / 0 = 1'), null, 'division by zero is not answered');
  assert.throws(() => evaluate('process.exit()'));
});
