// A message can name someone and state a general fact at once; its two reference checks count as one.
const test = require('node:test');
const assert = require('node:assert');
const { __test: { mergePremises } } = require('../agents/trustAnalysisAgent');

const early = {
  status: 'consistent', checked: [{ entity: 'Chennai' }, { entity: 'Tamil Nadu' }], contradictions: [],
  confirmations: [{ entity: 'Chennai', referenceStates: 'Chennai is the capital city of Tamil Nadu.' }],
  explanation: 'Checked 2 named subjects against reference entries and found nothing contradicted.'
};
const giraffe = {
  status: 'contradicted', checked: [{ entity: 'giraffe' }],
  contradictions: [{ entity: 'giraffe', articleStates: 'The giraffe is a fish.', referenceStates: 'Giraffes are large African hoofed mammals.' }],
  confirmations: []
};

test('a contradiction found for the general fact counts beside the names checked first', () => {
  const merged = mergePremises(early, giraffe);
  assert.strictEqual(merged.status, 'contradicted');
  assert.strictEqual(merged.contradictions.length, 1);
  assert.strictEqual(merged.confirmations.length, 1, 'the confirmation of the named subject is kept');
  assert.strictEqual(merged.checked.length, 3);
  assert.match(merged.explanation, /about giraffe/);
});

test('a second check that found nothing to look up adds nothing; one that failed marks the result partial', () => {
  assert.strictEqual(mergePremises(early, { status: 'no-entities', checked: [], contradictions: [] }), early);
  assert.strictEqual(mergePremises(early, null), early);
  const failed = mergePremises(early, { status: 'error', checked: [], contradictions: [] });
  assert.strictEqual(failed.status, 'consistent');
  assert.strictEqual(failed.partialFailure, true);
});
