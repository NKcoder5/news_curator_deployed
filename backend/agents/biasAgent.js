// backend/agents/biasAgent.js
// Factor 3: Bias and emotional-language detection — structured LLM call that
// flags specific sentences so the frontend can highlight them.
const { callNimApiJson } = require('../utils/nvidiaNimApi');

const BIAS_TYPES = ['political bias', 'emotional manipulation', 'loaded language', 'one-sided reporting', 'opinion as fact', 'sensationalism'];

/**
 * Analyze article text for bias and emotionally manipulative language.
 * @param {string} title - Article headline
 * @param {string} content - Article body text (may be truncated by the news API)
 * @returns {Promise<{score: number, biasLevel: string, politicalLean: string, flaggedSentences: Array<{sentence: string, type: string, reason: string}>, explanation: string}>}
 *          score is 0-10 where 10 = neutral/objective, 0 = heavily biased.
 */
const analyzeBias = async (title, content) => {
  const text = `${title}. ${content || ''}`.slice(0, 3000);

  const prompt = `You are a media bias analysis system. Analyze this news text for bias and emotionally manipulative language.

Text:
"""
${text}
"""

Look for: ${BIAS_TYPES.join(', ')}.
Quote flagged sentences EXACTLY as they appear in the text. Only flag sentences that genuinely show bias — a neutral article should have an empty list.

Respond with ONLY a JSON object, no other text:
{
  "bias_score": <number 0-10, where 0 = fully neutral and objective, 10 = extremely biased>,
  "political_lean": "<left | center | right | none-detected>",
  "flagged_sentences": [
    { "sentence": "<exact quote from the text>", "type": "<one of: ${BIAS_TYPES.join(' | ')}>", "reason": "<short reason>" }
  ],
  "explanation": "<1-2 sentences summarizing the overall tone and objectivity>"
}`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 700 });
    let biasScore = Number(result.bias_score);
    if (!Number.isFinite(biasScore)) biasScore = 0;
    biasScore = Math.min(10, Math.max(0, biasScore));

    const flagged = Array.isArray(result.flagged_sentences)
      ? result.flagged_sentences
          .filter(f => f && f.sentence)
          .map(f => ({
            sentence: String(f.sentence),
            type: String(f.type || 'bias'),
            reason: String(f.reason || '')
          }))
      : [];

    const biasLevel = biasScore <= 2 ? 'low' : biasScore <= 5 ? 'moderate' : 'high';

    return {
      // Invert: high score = objective article
      score: Math.round((10 - biasScore) * 10) / 10,
      biasLevel,
      politicalLean: String(result.political_lean || 'none-detected'),
      flaggedSentences: flagged,
      explanation: String(result.explanation || 'No explanation provided.')
    };
  } catch (err) {
    console.error('Bias analysis failed:', err.message);
    return {
      score: 5,
      biasLevel: 'unknown',
      politicalLean: 'none-detected',
      flaggedSentences: [],
      explanation: 'Bias analysis unavailable — treated as neutral.',
      failed: true
    };
  }
};

module.exports = { analyzeBias };
