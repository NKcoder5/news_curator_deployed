const test = require('node:test');
const assert = require('node:assert');
const { isRelevant, filterRelevant } = require('../agents/evidenceRelevance');

// The case that made this module necessary: measured on the adversarial set, an
// invented "secret chemical leak" story was reported as supported by real
// coverage of an unrelated evacuation, and the verdict came back "likely true".
test('coverage of a different event does not support the claim', () => {
  const claim = 'A secret chemical leak forced the overnight evacuation of three districts near Visakhapatnam.';
  const unrelated = {
    source: 'Reuters',
    title: 'Wildfire prompts evacuation orders in northern California',
    description: 'Residents were told to leave as the fire spread overnight.'
  };
  assert.strictEqual(isRelevant(claim, unrelated).relevant, false);
});

test('coverage of the same event does support the claim', () => {
  const claim = 'A chemical leak forced the evacuation of three districts near Visakhapatnam.';
  const related = {
    source: 'The Hindu',
    title: 'Chemical leak at Visakhapatnam plant forces evacuation',
    description: 'Districts around the plant were cleared as a precaution.'
  };
  const verdict = isRelevant(claim, related);
  assert.strictEqual(verdict.relevant, true);
  assert.ok(verdict.shared.includes('visakhapatnam'));
});

test('numbers count as distinctive', () => {
  const claim = 'The trial enrolled 312 patients across three centres.';
  const related = { title: 'Trial of 312 patients reports results', description: '' };
  assert.strictEqual(isRelevant(claim, related).relevant, true);
});

// This test used to assert the opposite, on the reasoning that being unable to
// check relevance is not evidence of irrelevance. That is true, and it is the
// wrong conclusion to draw from it. The question the gate answers is not "is
// this evidence irrelevant?" but "may this evidence establish the claim?", and
// where identity cannot be established the answer to the second is no whatever
// the answer to the first. Standing aside meant accepting everything, which is
// how an invented chemical leak came to be reported as corroborated.
test('a claim too vague to identify cannot be established by anything', () => {
  const verdict = isRelevant('It was said to be so.', { title: 'Something else entirely', description: '' });
  assert.strictEqual(verdict.relevant, false);
  assert.strictEqual(verdict.unanchored, true, 'the reason is recorded so the reader can be told it');
});

test('filtering keeps the relevant and reports the discarded', () => {
  const claim = 'The Reserve Bank held the repo rate unchanged at its December meeting.';
  const result = filterRelevant(claim, [
    { source: 'Reuters', title: 'Reserve Bank holds repo rate steady in December', description: '' },
    { source: 'Some Site', title: 'Cricket team announces squad for tour', description: '' }
  ]);
  assert.strictEqual(result.kept.length, 1);
  assert.strictEqual(result.dropped.length, 1);
  assert.match(result.note, /discarded for not being about this claim/);
  assert.ok(result.kept[0].sharedTerms.length >= 2);
});

test('shared stopwords alone are not relevance', () => {
  const claim = 'The government said that the new policy will be introduced after the year ends.';
  const evidence = { title: 'The government said that there will be more people after the year', description: '' };
  assert.strictEqual(isRelevant(claim, evidence).relevant, false, 'common words carry no evidential weight');
});

// A claim that names nothing cannot be corroborated by anything.
//
// The adversarial item fab-04 reads "Secret chemical leak forces overnight
// evacuation of three districts". It names no district, no town, no company and
// no figure. The gate used to fall back to vocabulary overlap when a claim had
// no anchors, and a real story about a chemical plant leak in Ohio cleared it on
// chemical, leak, overnight and evacuation — four shared terms, score 0.5. The
// pipeline then reported the invented leak as corroborated by multiple
// independent sources, which is the worst error it can make.
test('an unanchored claim cannot be corroborated by same-topic coverage', () => {
  const claim = 'A secret chemical leak forced the overnight evacuation of three districts.';
  const sameTopic = {
    title: 'Chemical plant leak prompts overnight evacuation in Ohio',
    description: 'Residents were evacuated after a leak at a chemical facility.'
  };

  const verdict = isRelevant(claim, sameTopic);
  assert.equal(verdict.relevant, false, 'topic overlap is not event identity');
  assert.equal(verdict.unanchored, true, 'the reason must be recorded, not just the refusal');
});

test('a distinctive unanchored scientific claim accepts near-verbatim coverage', () => {
  const claim = "Some of the universe's biggest explosions may have never happened at all.";
  const related = {
    title: "Scientists discover that some of the universe's biggest explosions may have never happened at all",
    description: ''
  };

  const verdict = isRelevant(claim, related);
  assert.equal(verdict.relevant, true);
  assert.equal(verdict.unanchored, false);
});

test('subject coverage does not confirm a different claim about the same subject', () => {
  const claim = 'A planet 320 light-years away confirms what scientists long suspected.';
  const subjectHeadline = {
    source: 'SSBCrack',
    title: 'Astronomers Discover Key Evidence Linking Planetary and Stellar Chemistry in WASP-189b',
    description: ''
  };

  assert.equal(isRelevant(claim, subjectHeadline).relevant, false);
});

test('an anchored claim still matches coverage of the same event', () => {
  const claim = 'A Mississippi grand jury declined to bring charges in the death of Nolan Wells.';
  const verdict = isRelevant(claim, {
    title: 'Grand jury declines charges in Nolan Wells death',
    description: 'A Mississippi grand jury found no evidence to bring charges.'
  });
  assert.equal(verdict.relevant, true);
  assert.ok(verdict.sharedAnchors.includes('nolan'));
});

test('an anchored claim rejects coverage of a different event', () => {
  const claim = 'A Mississippi grand jury declined to bring charges in the death of Nolan Wells.';
  const verdict = isRelevant(claim, {
    title: 'Wildfire prompts evacuation in northern California',
    description: 'Residents left their homes overnight.'
  });
  assert.equal(verdict.relevant, false);
});

// The reader is told why, because "discarded for not being about this claim"
// understates a claim that could never have been matched in the first place.
test('the reason given distinguishes unmatchable from unmatched', () => {
  const unanchored = filterRelevant(
    'A secret chemical leak forced an overnight evacuation of three districts.',
    [{ source: 'Somewhere', title: 'Chemical leak prompts overnight evacuation', description: '' }]);
  assert.match(unanchored.note, /names no person, place, organisation or figure/i);

  const anchored = filterRelevant(
    'A Mississippi grand jury declined to charge anyone over the death of Nolan Wells.',
    [{ source: 'Somewhere', title: 'Wildfire prompts evacuation in California', description: '' }]);
  assert.match(anchored.note, /not being about this claim/i);
});

test('a body named in full matches its initials, and 5.50 matches 5.5', () => {
  const claim = 'The Reserve Bank of India hiked the repo rate by a quarter percentage point to 5.5%.';
  assert.strictEqual(isRelevant(claim, { title: 'RBI raises repo rate by 25 basis points to 5.50%' }).relevant, true);
  assert.strictEqual(isRelevant('Tamilaga Vettri Kazhagam won both bypolls', { title: 'TVK wins Dharapuram and Madurantakam bypolls' }).relevant, true);
  // Initials do not loosen the rule for a claim that names nothing.
  assert.strictEqual(isRelevant('A secret chemical leak forced the overnight evacuation of three districts',
    { title: 'Chemical leak forces overnight evacuation in Ohio' }).relevant, false);
});
