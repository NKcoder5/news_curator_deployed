const test = require('node:test');
const assert = require('node:assert');
const { presentedAsNow } = require('../agents/inputUnderstanding');

const today = new Date().toISOString().slice(0, 10);

test('old news presented as today is a claim about now, even when the model dates it', () => {
  assert.strictEqual(presentedAsNow(`Chandrayaan-3 landed on the Moon on ${today}.`, 'Chandrayaan-3 lands on the Moon today'), true);
  assert.strictEqual(presentedAsNow('Chandrayaan-3 landed on the Moon.', 'Chandrayaan-3 lands on the Moon today, India becomes first'), true);
  assert.strictEqual(presentedAsNow('Narendra Modi resigned as Prime Minister today.', 'Modi resigned today!!'), true);
});

test('"today" in Tamil or Hindi counts too', () => {
  assert.strictEqual(presentedAsNow('Narendra Modi resigned as Prime Minister.', 'மோடி இன்று ராஜினாமா செய்தார்'), true);
  assert.strictEqual(presentedAsNow('Narendra Modi resigned as Prime Minister.', 'मोदी ने आज इस्तीफा दे दिया'), true);
});

test('a standing fact or a dated event is not turned into a claim about now', () => {
  assert.strictEqual(presentedAsNow('India is the first country to land near the south pole of the Moon.', 'Chandrayaan-3 lands on the Moon today, India first to reach the south pole', 'standing_fact'), false);
  assert.strictEqual(presentedAsNow('India won the Cricket World Cup in 2011.', 'Today I learnt India won the World Cup in 2011'), false);
  assert.strictEqual(presentedAsNow('TVK won both bypolls.', 'TVK won both bypolls'), false);
});
