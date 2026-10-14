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

const { claimTime } = require('../agents/inputUnderstanding');

test('a claim is about now only when the message places it in the present', () => {
  assert.strictEqual(claimTime('now', 'ISRO launched the EOS-05 satellite.', 'ISRO successfully launched the EOS-05 satellite on the GSLV-F17 rocket', '', 'event'), 'past');
  assert.strictEqual(claimTime('now', 'RBI cut the repo rate.', 'RBI cut the repo rate by 50 basis points this week', '', 'event'), 'now');
  assert.strictEqual(claimTime('now', 'Instagram will be banned.', 'Instagram will be banned in India from 25 August', '', 'event'), 'now');
  assert.strictEqual(claimTime('now', 'Banks will stay shut.', 'Banks shut from Monday!!', '', 'event'), 'now');
  assert.strictEqual(claimTime('past', 'Chandrayaan-3 landed on the Moon.', 'Chandrayaan-3 lands on the Moon today', '', 'event'), 'now');
  assert.strictEqual(claimTime('timeless', 'Giraffe is a mammal.', 'Giraffe is a mammal', '', 'standing_fact'), 'timeless');
});
