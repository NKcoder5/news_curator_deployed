const test = require('node:test');
const assert = require('node:assert');
const { assessCheckability } = require('../agents/checkability');

const CHECKABLE = [
  ['a forwarded claim with a name and a figure',
    'Breaking: the Tamil Nadu government has announced free electricity for all farmers starting from January. Share this with everyone!'],
  ['a claim with an institution and a number',
    'The Reserve Bank of India has withdrawn the 500 rupee note from circulation beginning 14 March, according to an internal circular.'],
  ['a spoken claim from a video',
    'A new study from Stanford University found that 94 per cent of participants recovered completely after taking the treatment.'],
  ['an ordinary news sentence',
    'Chennai corporation approved 42 crore rupees for the riverfront walkway on Tuesday, with work due to start in January.']
];

for (const [label, text] of CHECKABLE) {
  test(`accepts ${label}`, () => {
    const verdict = assessCheckability(text);
    assert.strictEqual(verdict.checkable, true, `rejected as ${verdict.kind}: ${verdict.reason}`);
    assert.ok(verdict.anchorCount > 0);
  });
}

// The case that makes the gate necessary. Run the pipeline on this and it
// produces a verdict; the verdict means nothing, because nothing was asserted.
test('rejects pure exhortation with nothing asserted', () => {
  const verdict = assessCheckability(
    'They are hiding the truth from you and the media will never report it. Wake up before it is too late and share this with everyone you know.');
  assert.strictEqual(verdict.checkable, false);
  assert.strictEqual(verdict.kind, 'unfalsifiable');
  assert.match(verdict.reason, /does not say what actually happened/);
  assert.ok(verdict.missing.length > 0, 'must say what would make it checkable');
});

test('rejects an opinion', () => {
  const verdict = assessCheckability(
    'I think the new policy is absolutely terrible and everyone involved should be ashamed of what they have done to us.');
  assert.strictEqual(verdict.checkable, false);
  assert.strictEqual(verdict.kind, 'opinion');
});

test('rejects text too short to work with', () => {
  const verdict = assessCheckability('Modi resigned today');
  assert.strictEqual(verdict.checkable, false);
  assert.strictEqual(verdict.kind, 'too-short');
});

test('rejects a question', () => {
  const verdict = assessCheckability('Is it true that the government is planning to ban cash transactions above ten thousand rupees?');
  assert.strictEqual(verdict.checkable, false);
  assert.strictEqual(verdict.kind, 'question');
});

test('rejects a claim with nothing specific in it', () => {
  const verdict = assessCheckability(
    'A lot of people are getting very sick these days and the doctors are not telling anyone about what is really going on.');
  assert.strictEqual(verdict.checkable, false);
  assert.strictEqual(verdict.kind, 'too-vague');
  assert.ok(verdict.missing.length > 0);
});

test('every rejection explains what would make it checkable', () => {
  const rejections = [
    'They are hiding the truth from you. Wake up before it is too late and share this now.',
    'A lot of people are getting very sick these days and nobody is telling anyone anything.',
    'Too short'
  ];
  for (const text of rejections) {
    const verdict = assessCheckability(text);
    assert.strictEqual(verdict.checkable, false);
    assert.ok(verdict.reason && verdict.reason.length > 20, 'a refusal must give a reason');
    assert.ok(verdict.missing.length > 0, 'a refusal must say what is missing');
  }
});

test('a sentence-initial capital is not mistaken for a name', () => {
  // "Everyone" and "Nobody" open sentences; neither is something to search for.
  const verdict = assessCheckability(
    'Everyone knows what is really going on here. Nobody wants to talk about it openly in public.');
  assert.strictEqual(verdict.checkable, false);
});

test('a one-sentence claim may open with its subject', () => {
  // Refused before as naming no one: "India" was skipped as a sentence-initial capital.
  assert.strictEqual(assessCheckability('India has banned cricket nationwide from this week').checkable, true);
  // A single-sentence exhortation still names nothing.
  assert.strictEqual(assessCheckability('Share this message with all your friends and family members now').checkable, false);
});
