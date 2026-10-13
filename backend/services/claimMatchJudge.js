// backend/services/claimMatchJudge.js
//
// The one question the signature cannot settle: two claims name the same
// people and agree on every figure, date and polarity, but are worded too
// differently to compare word by word ("Elon Musk bought Reliance Jio" against
// "Reliance Jio was taken over by Elon Musk"). A model is asked only for these
// ambiguous pairs, at temperature 0 (so the answer is cached and repeatable),
// and is told that merging two different claims is the worse error.
//
// Our own pair model (services/localNli.js) is asked first, in both
// directions: two statements that each clearly entail the other are the same
// claim, and one it reads as contradicting the other is a different claim. Only
// what it is unsure of goes to the language model. Measured on the claim-
// matching pairs it found 46 of 50 same pairs and flagged all 40 variants; the
// strict 0.9 bar in both directions is there because a false merge is the
// worse error.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { judgePairs } = require('./localNli');

const SAME_MIN = 0.9;
const DIFFERENT_MIN = 0.5;

/** Our model's answer: true, false, or null when it is unsure or absent. */
const ownModelSays = async (a, b) => {
  let r = null;
  try { r = await judgePairs([{ premise: a, hypothesis: b }, { premise: b, hypothesis: a }]); } catch (_) { r = null; }
  if (!Array.isArray(r) || r.length !== 2 || !r[0] || !r[1]) return null;
  const [ab, ba] = r.map(x => x.scores);
  if (ab.contradiction >= DIFFERENT_MIN || ba.contradiction >= DIFFERENT_MIN) return false;
  if (ab.entailment >= SAME_MIN && ba.entailment >= SAME_MIN) return true;
  return null;
};
const { UNTRUSTED_NOTICE, fence } = require('../utils/untrusted');

/**
 * @returns {Promise<boolean>} true only when the model judges them the same claim
 */
const sameClaim = async (a, b) => {
  const own = await ownModelSays(a, b);
  if (own !== null) return own;
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

module.exports = { sameClaim, ownModelSays };
