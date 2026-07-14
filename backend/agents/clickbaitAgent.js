// backend/agents/clickbaitAgent.js
// Factor 2: Clickbait headline detection — one structured LLM call that
// scores the headline and names the specific clickbait signals found.
const { callNimApiJson } = require('../utils/nvidiaNimApi');

/**
 * Analyze a headline for clickbait characteristics.
 * @param {string} title - The article headline
 * @returns {Promise<{score: number, isClickbait: boolean, signals: string[], explanation: string}>}
 *          score is 0-10 where 10 = completely straightforward headline, 0 = extreme clickbait.
 */
const analyzeClickbait = async (title) => {
  const prompt = `You are a headline analysis system. Analyze this news headline for clickbait characteristics.

Headline: "${title}"

Clickbait signals to check for:
- Withholding key information to force a click ("You won't believe what happened next")
- Exaggerated or sensational wording ("SHOCKING", "destroys", "slams")
- Curiosity-gap phrasing ("This one trick...", "The reason will surprise you")
- Listicle bait ("7 things only smart people know")
- Excessive punctuation or all-caps words
- Emotional manipulation or fear-mongering
- Unsubstantiated superlatives ("best ever", "worst in history")

Respond with ONLY a JSON object, no other text:
{
  "clickbait_score": <number 0-10, where 0 = not clickbait at all and 10 = extreme clickbait>,
  "signals": [<array of short strings naming each signal actually present, empty array if none>],
  "explanation": "<one sentence explaining the assessment>"
}`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 300 });
    let clickbaitScore = Number(result.clickbait_score);
    if (!Number.isFinite(clickbaitScore)) clickbaitScore = 0;
    clickbaitScore = Math.min(10, Math.max(0, clickbaitScore));

    return {
      // Invert: high score = trustworthy headline, consistent with the other factors
      score: Math.round((10 - clickbaitScore) * 10) / 10,
      isClickbait: clickbaitScore >= 5,
      signals: Array.isArray(result.signals) ? result.signals.map(String) : [],
      explanation: String(result.explanation || 'No explanation provided.')
    };
  } catch (err) {
    console.error('Clickbait analysis failed:', err.message);
    return {
      score: 5,
      isClickbait: false,
      signals: [],
      explanation: 'Clickbait analysis unavailable — treated as neutral.',
      failed: true
    };
  }
};

module.exports = { analyzeClickbait };
