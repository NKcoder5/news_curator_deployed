// A figure's wording sets what it allows: "crossed 80" is 80 or more. The figure check, which overrules
// the stance step, used to compare plain values and ruled true bound claims contradicted.
const test = require('node:test');
const assert = require('node:assert');
const { __test: { figureConflicts } } = require('../agents/claimVerificationAgent');

const outlet = (source, title) => ({ source, title, description: '', url: `https://${source.replace(/\s/g, '').toLowerCase()}.test/x` });
const FINAL = [outlet('The Hindu', 'Asian Games 2026: India signs off with 85 medals'), outlet('NDTV', 'India finish Asian Games 2026 campaign with 85 medals')];
const conflicts = (claim, coverage = FINAL) => Boolean(figureConflicts(claim, coverage));

test('a bound the reported figure satisfies is not contradicted by it', () => {
  for (const claim of ['India crossed 80 medals at the Asian Games 2026.', 'India won more than 80 medals at the Asian Games 2026.',
    'India won over 80 medals at the Asian Games 2026.', 'India won at least 85 medals at the Asian Games 2026.',
    'India won nearly 90 medals at the Asian Games 2026.', 'India won about 85 medals at the Asian Games 2026.']) {
    assert.strictEqual(conflicts(claim), false, claim);
  }
});

test('a bound the reported figure breaks, and a different exact figure, are still contradicted', () => {
  for (const claim of ['India won more than 100 medals at the Asian Games 2026.', 'India won fewer than 80 medals at the Asian Games 2026.',
    'India won 84 medals at the Asian Games 2026.']) {
    assert.strictEqual(conflicts(claim), true, claim);
  }
  assert.strictEqual(conflicts('India won 85 medals at the Asian Games 2026.'), false);
});

test('a count on the way to its total says nothing against the total', () => {
  const interim = [outlet('The Hindu', 'Asian Games Day 9: India medal tally crosses 50'), outlet('NDTV', 'Asian Games live: India medals so far reach 52')];
  assert.strictEqual(conflicts('India won 84 medals at the Asian Games 2026.', interim), false);
});

test('a changed code is still a conflict', () => {
  const code = [outlet('NDTV', 'Air India flight squawked 7500, the hijack code, before landing'), outlet('India Today', 'Air India pilots squawked code 7500 mid-air')];
  assert.strictEqual(conflicts('The Air India flight squawked code 7400 before the emergency landing.', code), true);
});
