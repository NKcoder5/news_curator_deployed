// backend/services/claimMatchJudge.js
//
// The one question the signature cannot settle: two claims name the same
// people and agree on every figure, date and polarity, but are worded too
// differently to compare word by word ("Elon Musk bought Reliance Jio" against
// "Reliance Jio was taken over by Elon Musk"). A model is asked only for these
// ambiguous pairs, at temperature 0 (so the answer is cached and repeatable),
// and is told that merging two different claims is the worse error.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { UNTRUSTED_NOTICE, fence } = require('../utils/untrusted');

/**
 * @returns {Promise<boolean>} true only when the model judges them the same claim
 */
const sameClaim = async (a, b) => {
  // Both statements were extracted from what readers sent, so either can
  // carry wording meant for the model; merging two claims is the worse error.
  const prompt = `Are these two statements the same factual claim?

${UNTRUSTED_NOTICE}

A:
${fence(a, { label: 'statement a', max: 400 })}
B:
${fence(b, { label: 'statement b', max: 400 })}

They are the same claim only if they assert the same thing about the same people, organisations, places and events, so that if one is true the other must be true. If they differ in any figure, date, place, person, outcome or in whether something did or did not happen, they are NOT the same claim. Sharing a topic or a name is not enough. When unsure, answer false.

Return a JSON object: {"same": true or false}`;
  try {
    const result = await callNimApiJson(prompt, { maxTokens: 200, temperature: 0, requiredKeys: ['same'], label: 'claim matching' });
    return result.same === true;
  } catch (_) {
    return false;   // an unanswered question never merges two claims
  }
};

module.exports = { sameClaim };
