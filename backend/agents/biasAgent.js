// backend/agents/biasAgent.js
// Factor 3: Bias and emotional-language detection — structured LLM call that
// flags specific sentences so the frontend can highlight them.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { languageDirective } = require('../utils/language');
const { biasByRules } = require('./heuristics');

const { UNTRUSTED_NOTICE, fence, oneOf, clip } = require('../utils/untrusted');

const BIAS_TYPES =['political bias', 'emotional manipulation', 'loaded language', 'one-sided reporting', 'opinion as fact', 'sensationalism'];
const LEANS = ['left', 'center', 'right', 'none-detected'];

/**
 * Analyze article text for bias and emotionally manipulative language.
 * @param {string} title - Article headline
 * @param {string} content - Article body text (may be truncated by the news API)
 * @returns {Promise<{score: number, biasLevel: string, politicalLean: string, flaggedSentences: Array<{sentence: string, type: string, reason: string}>, explanation: string}>}
 *          score is 0-10 where 10 = neutral/objective, 0 = heavily biased.
 */
const analyzeBias = async (title, content, language) => {
  const text = `${title}. ${content || ''}`.slice(0, 3000);


  // Keys described, not drawn — see the note in manipulationAgent.js:
  // under constrained JSON decoding a placeholder template is itself a
  // valid completion, and these agents were returning objects with the
  // required key missing.
  const prompt = `You are a media bias analysis system. Analyze this news text for bias and emotionally manipulative language.

${UNTRUSTED_NOTICE}

Text:
${fence(text, { label: 'news text', max: 3000 })}

Look for: ${BIAS_TYPES.join(', ')}.
Quote flagged sentences EXACTLY as they appear in the text. Only flag sentences that genuinely show bias — a neutral article should have an empty list.

Return a JSON object with these keys:
- "bias_score": a number from 0 to 10, where 0 is fully neutral and objective and 10 is extremely biased.
- "political_lean": one of left, center, right, none-detected.
- "flagged_sentences": an array, empty when nothing stands out. Each entry has "sentence" (the exact quote), "type" (one of: ${BIAS_TYPES.join(', ')}) and "reason" (short).
- "explanation": one or two sentences summarising the overall tone and objectivity.` + languageDirective(language);

  try {
    // Temperature 0, as the other writing checks (see clickbaitAgent.js).
    const result = await callNimApiJson(prompt, { maxTokens: 700, temperature: 0, requiredKeys: ['bias_score'], label: 'bias' });
    let biasScore = Number(result.bias_score);
    // A score that is not a number is no reading at all: taken as 0 it passed as "fully neutral".
    if (result.bias_score === null || result.bias_score === '' || !Number.isFinite(biasScore)) {
      throw new Error(`bias_score was not a number (${JSON.stringify(result.bias_score)?.slice(0, 40)})`);
    }
    biasScore = Math.min(10, Math.max(0, biasScore));

    // Shown to the reader as highlights, so each is held to the shape asked
    // for: a sentence, one of the named types, a short reason.
    const flagged = Array.isArray(result.flagged_sentences)
      ? result.flagged_sentences
          .filter(f => f && typeof f === 'object' && clip(f.sentence, 600))
          .slice(0, 8)
          .map(f => ({
            sentence: clip(f.sentence, 600),
            type: oneOf(f.type, BIAS_TYPES, 'bias'),
            reason: clip(f.reason, 300)
          }))
      : [];

    const biasLevel = biasScore <= 2 ? 'low' : biasScore <= 5 ? 'moderate' : 'high';

    return {
      // Invert: high score = objective article
      score: Math.round((10 - biasScore) * 10) / 10,
      biasLevel,
      politicalLean: oneOf(result.political_lean, LEANS, 'none-detected'),
      flaggedSentences: flagged,
      explanation: clip(result.explanation, 500) || 'No explanation provided.',
      method: 'model'
    };
  } catch (err) {
    console.error('Bias analysis failed, falling back to rules:', err.message);
    return { ...biasByRules(title, content), degraded: true };
  }
};

module.exports = { analyzeBias };
