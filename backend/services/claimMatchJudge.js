// backend/services/claimMatchJudge.js
//
// The one question the signature cannot settle: two claims name the same
// people and agree on every figure, date and polarity, but are worded too
// differently to compare word by word ("Elon Musk bought Reliance Jio" against
// "Reliance Jio was taken over by Elon Musk"). A model is asked only for these
// ambiguous pairs, at temperature 0 (so the answer is cached and repeatable),
// and is told that merging two different claims is the worse error.
const { callNimApiJson } = require('../utils/nvidiaNimApi');

/**
 * @returns {Promise<boolean>} true only when the model judges them the same claim
 */
const sameClaim = async (a, b) => {
  const prompt = `Are these two statements the same factual claim?

A: "${String(a).slice(0, 400)}"
B: "${String(b).slice(0, 400)}"

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
