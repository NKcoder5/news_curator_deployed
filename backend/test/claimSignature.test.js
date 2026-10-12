const test = require('node:test');
const assert = require('node:assert');
const { signatureOf, compareSignatures } = require('../services/claimSignature');

const relation = (a, b) => compareSignatures(signatureOf(a), signatureOf(b)).relation;

test('the same claim in different words is recognised as the same', () => {
  assert.strictEqual(relation('India won 84 medals at the Asian Games 2026.', 'India won 84 medals at the 2026 Asian Games.'), 'same');
  assert.strictEqual(relation('Narendra Modi resigned as Prime Minister today.', 'PM Modi resigned today.'), 'same');
  assert.strictEqual(relation('The Reserve Bank of India raised the repo rate by 25 basis points to 5.5%.',
    'RBI raised the repo rate by 25 basis points to 5.50%.'), 'same');
  // The same amount in other units is the same figure.
  assert.strictEqual(relation('Virat Kohli denied claims that he took Rs 5 crore to visit the ashram.',
    'Virat Kohli denied claims he took Rs 50 million to visit the ashram.'), 'same');
});

test('a changed figure, date or polarity makes a variant, and says which', () => {
  const figure = compareSignatures(signatureOf('India won 84 medals at the Asian Games 2026.'), signatureOf('India won 85 medals at the Asian Games 2026.'));
  assert.strictEqual(figure.relation, 'variant');
  assert.match(figure.differences[0], /84 medal vs 85 medal/);
  assert.strictEqual(relation('India won 84 medals at the Asian Games 2026.', 'India won 84 medals at the Asian Games 2022.'), 'variant');
  assert.strictEqual(relation('TVK lost the 2026 bypolls.', 'TVK did not lose the 2026 bypolls.'), 'variant');
  // Opposite verbs are the same claim stated the other way round.
  assert.strictEqual(relation('TVK lost the 2026 bypolls.', 'TVK won the 2026 bypolls.'), 'variant');
  assert.strictEqual(relation('TVK did not lose the 2026 bypolls.', 'TVK won the 2026 bypolls.'), 'same');
});

test('claims that only share a topic or a name are kept apart', () => {
  assert.strictEqual(relation('India won 84 medals at the Asian Games 2026.', 'India won 84 medals at the Commonwealth Games 2026.'), 'different');
  assert.strictEqual(relation('Narendra Modi resigned as Prime Minister today.', 'Narendra Modi launched projects worth Rs 13,000 crore in Chennai.'), 'different');
  // A figure stated in one and absent from the other is a different degree of
  // specificity, not the same claim.
  assert.strictEqual(relation('India won medals at the Asian Games 2026.', 'India won 84 medals at the Asian Games 2026.'), 'different');
});

test('figures are read with their units and scale; years are kept apart', () => {
  const s = signatureOf('PM Modi launched projects worth Rs 13,000 crore in Chennai in 2026');
  assert.deepStrictEqual(s.years, ['2026']);
  assert.strictEqual(s.numbers[0].unit, 'rupee');
  assert.strictEqual(s.numbers[0].value, 130000000000);
});
