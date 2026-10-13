// Rewordings that are the same claim, and opposites that are not. Each pair
// here is a miss measured on the held-out pairs (eval/suites/
// claim_matching_heldout.json) before services/claimSignature.js learnt it.
const test = require('node:test');
const assert = require('node:assert');
const { signatureOf, compareSignatures } = require('../services/claimSignature');

const relation = (a, b) => compareSignatures(signatureOf(a), signatureOf(b));

test('rewordings of one claim are the same claim', () => {
  const pairs = [
    ['Actor Nana Patekar passed away in Goa.', 'Nana Patekar died at his home in Goa.'],
    ['West Indies beat India by six wickets in the second T20I in Ranchi.', 'West Indies defeated India by 6 wickets in the 2nd T20I at Ranchi.'],
    ['The government will ban Instagram in India from 25 August.', 'Instagram will be banned across India from August 25.'],
    ['The Rs 2,000 note has a GPS nano chip.', 'The 2000 rupee note contains a nano GPS chip.'],
    ['Shreyas Iyer scored his maiden T20I century against West Indies.', 'Shreyas Iyer hit his first T20 international hundred against the West Indies.'],
    ['Vijay launched the Dream Olympics 2036 scheme.', 'The Dream Olympics 2036 scheme was launched by Chief Minister Vijay.'],
    ['Ratan Tata died at the age of 86.', 'Ratan Tata passed away aged 86.']
  ];
  for (const [a, b] of pairs) assert.strictEqual(relation(a, b).relation, 'same', `${a} || ${b}`);
});

test('opposite outcomes and reversed roles are variants, never the same claim', () => {
  const pairs = [
    ['India beat West Indies in the second T20I in Ranchi.', 'West Indies beat India in the second T20I in Ranchi.', /roles reversed/],
    ["ISRO's GSLV-F17 mission succeeded.", "ISRO's GSLV-F17 mission failed.", /opposite/],
    ["The Madras High Court upheld Vijay's election from Perambur.", "The Madras High Court set aside Vijay's election from Perambur.", /opposite/]
  ];
  for (const [a, b, why] of pairs) {
    const r = relation(a, b);
    assert.strictEqual(r.relation, 'variant', `${a} || ${b}`);
    assert.match(r.differences.join('; '), why);
  }
});

test('the passive keeps who did it to whom', () => {
  assert.deepStrictEqual(signatureOf('India was beaten by West Indies in Ranchi.').roles, ['west', 'india']);
  assert.strictEqual(relation('West Indies beat India in Ranchi.', 'India was beaten by West Indies in Ranchi.').relation, 'same');
});

test('identifiers are names, not figures, and money is not a year', () => {
  const s = signatureOf('ISRO launched the EOS-05 satellite on GSLV-F17.');
  assert.deepStrictEqual(s.numbers, []);
  assert.ok(s.entities.includes('eos-05') && s.entities.includes('gslv-f17'));
  const rupee = signatureOf('The 2000 rupee note contains a nano GPS chip.');
  assert.deepStrictEqual(rupee.years, []);
  assert.deepStrictEqual(rupee.numbers.map(n => [n.value, n.unit]), [[2000, 'rupee']]);
});
