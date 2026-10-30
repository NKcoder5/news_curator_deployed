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
  // Rulings pool 2, 30 Oct: a report of an announcement made is not news of today.
  const medicare = 'The administration of U.S. President Donald Trump announced the end of a Medicare subsidy program aimed to help lower the cost of prescription drugs.';
  assert.strictEqual(claimTime('now', medicare, medicare, '', 'event'), 'past');
  assert.strictEqual(claimTime('now', 'The government announces school holidays.', 'Govt announces school holidays for all schools', '', 'event'), 'now');
  assert.strictEqual(claimTime('now', 'The gazette announced holidays.', 'Gazette announced holidays from November', '', 'event'), 'now');
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

// Rulings pool 2, 30 Oct: "Mike Johnson said that salaries for members of Congress have been frozen since
// 2009, and added, ..." (rated Correct Attribution) was read as his statement and, separately, the bare
// salaries claim, which reports of a later pay rise contradicted: PARTLY FALSE. A report of what a named
// person said is checked as that statement; the reported words alone are not the sender's claim.
test('a named speaker\'s reported words are not checked as a claim of their own', async () => {
  const message = 'U.S. Speaker of the House Mike Johnson said that salaries for members of Congress have been frozen since 2009, and added, “we should at least let them engage in some stock trading so they can continue to, you know, take care of their family.”';
  const reading = (claims) => async () => ({ language: 'en', speech_act: 'assertion', english: message, claims });
  const content = { claim: 'Salaries for members of the United States Congress have been frozen since 2009.', kind: 'standing_fact', time: 'timeless', checkable: true, subject: 'Congress salaries' };
  const quote = { claim: 'Mike Johnson said that members of Congress should be allowed to engage in stock trading to support their families.', kind: 'quote', time: 'past', checkable: true, subject: 'Mike Johnson' };
  const nimPath = require.resolve('../utils/nvidiaNimApi');
  const modPath = require.resolve('../agents/inputUnderstanding');
  const real = require.cache[nimPath];
  const readWith = async (claims, text = message) => {
    require.cache[nimPath] = { id: nimPath, filename: nimPath, loaded: true, exports: {
      callNimApi: async () => '', extractJson: () => null, callNimApiJson: reading(claims) } };
    delete require.cache[modPath];
    return require(modPath).understandInput(text);
  };
  try {
    assert.deepStrictEqual((await readWith([content, quote])).claims.map(c => c.kind), ['quote']);
    // Without the speaker's statement among the claims, nothing is dropped: the content is all there is.
    assert.strictEqual((await readWith([content])).claims.length, 1);
    // A sender's own assertion is untouched.
    const own = 'Salaries for members of Congress have been frozen since 2009.';
    assert.strictEqual((await readWith([content, quote], own)).claims.length, 2);
  } finally {
    if (real) require.cache[nimPath] = real; else delete require.cache[nimPath];
    delete require.cache[modPath];
  }
});
