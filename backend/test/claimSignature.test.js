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

test(`who did it to whom is read in the verb's own clause`, () => {
  const differences = (a, b) => compareSignatures(signatureOf(a), signatureOf(b)).differences;
  // The name before a headline's colon is the event, not the winner.
  assert.match(differences('Australia beat India in the World Cup final', 'World Cup final: India beat Australia to lift the trophy')[0], /^roles reversed/);
  assert.deepStrictEqual(differences('India beat Australia in the World Cup final', 'World Cup final: India beat Australia to lift the trophy'), []);
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

// A swapped name is a changed fact. On 8 Nov 2026 the live registry filed "The Taj Mahal is located in
// Chennai, India" under the record of "... in Agra, India": three of four names shared and the same wording
// compared as the same claim, and the Agra record then showed the Chennai verdict, FAKE.
test('a claim with one name swapped for another is a variant, never the same claim', () => {
  const swap = (a, b) => compareSignatures(signatureOf(a), signatureOf(b));
  const place = swap('The Taj Mahal is located in Chennai, India.', 'The Taj Mahal is located in Agra, India.');
  assert.strictEqual(place.relation, 'variant');
  assert.deepStrictEqual(place.differences, ['name: chennai vs agra']);
  assert.notStrictEqual(relation('Narendra Modi met Joe Biden in Washington.', 'Narendra Modi met Vladimir Putin in Washington.'), 'same');
  assert.notStrictEqual(relation('Narendra Modi visited Chennai on 11 October 2026.', 'Narendra Modi visited Delhi on 11 October 2026.'), 'same');
  // Adding or dropping a name is not a swap: these stay the same claim.
  assert.strictEqual(relation('Narendra Modi resigned as Prime Minister today.', 'PM Modi resigned today.'), 'same');
  assert.strictEqual(relation('The Taj Mahal is located in Agra, India.', 'The Taj Mahal is located in Agra.'), 'same');
});
