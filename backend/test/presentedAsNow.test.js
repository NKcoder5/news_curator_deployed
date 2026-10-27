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

// Rulings 1-60, 27 Oct: "Starting 1st April 2026, the Income Tax Department will have the legal authority
// to access social media activity" was read by a fallback model as a prediction, held back as uncheckable,
// and refused as naming nothing. A forecast whose date has passed is a claim about what happened.
test('a forecast whose date has passed is checked as an event', async () => {
  const { datePassed } = require('../agents/inputUnderstanding');
  const now = Date.UTC(2026, 9, 27);
  assert.strictEqual(datePassed('Starting 1st April 2026, the department will', now), true);
  assert.strictEqual(datePassed('from September 2026', now), true, 'a month that is over');
  assert.strictEqual(datePassed('from October 2026', now), false, 'the current month is not over');
  assert.strictEqual(datePassed('by December 31, 2026 the RBI will', now), false);
  assert.strictEqual(datePassed('RBI will cut rates in December', now), false, 'no year, no date');

  const nimPath = require.resolve('../utils/nvidiaNimApi');
  const real = require.cache[nimPath];
  require.cache[nimPath] = { id: nimPath, filename: nimPath, loaded: true, exports: {
    callNimApi: async () => '', extractJson: () => null,
    callNimApiJson: async () => ({ language: 'en', speech_act: 'assertion', english: 'x',
      claims: [{ claim: 'The Income Tax Department will have legal authority to access social media activity from 1 April 2026.', kind: 'prediction', time: 'future', checkable: false, subject: 'Income Tax Department' }] })
  } };
  const modPath = require.resolve('../agents/inputUnderstanding');
  delete require.cache[modPath];
  try {
    const { understandInput } = require(modPath);
    const read = await understandInput('Starting 1st April 2026, the Income Tax Department will have the legal authority to access social media activity, emails, cloud data to curb tax evasion.');
    assert.strictEqual(read.checkableClaims.length, 1);
    assert.strictEqual(read.checkableClaims[0].kind, 'event');
    assert.strictEqual(read.checkableClaims[0].time, 'past');
  } finally {
    if (real) require.cache[nimPath] = real; else delete require.cache[nimPath];
    delete require.cache[modPath];
  }
});
