// backend/agents/clickbaitAgent.js
// Factor 2: Clickbait headline detection — one structured LLM call that
// scores the headline and names the specific clickbait signals found.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { languageDirective } = require('../utils/language');
const { clickbaitByRules } = require('./heuristics');
const { UNTRUSTED_NOTICE, fence, clip, clipList } = require('../utils/untrusted');

/**
 * Analyze a headline for clickbait characteristics.
 * @param {string} title - The article headline
 * @returns {Promise<{score: number, isClickbait: boolean, signals: string[], explanation: string}>}
 *          score is 0-10 where 10 = completely straightforward headline, 0 = extreme clickbait.
 */
const analyzeClickbait = async (title, language) => {

  // Keys described, not drawn — see the note in manipulationAgent.js:
  // under constrained JSON decoding a placeholder template is itself a
  // valid completion, and these agents were returning objects with the
  // required key missing.
  const prompt = `You are a headline analysis system. Analyze this news headline for clickbait characteristics.

${UNTRUSTED_NOTICE}

Headline:
${fence(title, { label: 'headline', max: 400 })}

Clickbait signals to check for:
- Withholding key information to force a click ("You won't believe what happened next")
- Exaggerated or sensational wording ("SHOCKING", "destroys", "slams")
- Curiosity-gap phrasing ("This one trick...", "The reason will surprise you")
- Listicle bait ("7 things only smart people know")
- Excessive punctuation or all-caps words
- Emotional manipulation or fear-mongering
- Unsubstantiated superlatives ("best ever", "worst in history")

Return a JSON object with these keys:
- "clickbait_score": a number from 0 to 10, where 0 is not clickbait at all and 10 is extreme clickbait.
- "signals": an array of short strings naming each signal actually present, empty when there are none.
- "explanation": one sentence explaining the assessment.` + languageDirective(language);

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 450, requiredKeys: ['clickbait_score'], label: 'clickbait' });
    let clickbaitScore = Number(result.clickbait_score);
    if (!Number.isFinite(clickbaitScore)) clickbaitScore = 0;
    clickbaitScore = Math.min(10, Math.max(0, clickbaitScore));

    return {
      // Invert: high score = trustworthy headline, consistent with the other factors
      score: Math.round((10 - clickbaitScore) * 10) / 10,
      isClickbait: clickbaitScore >= 5,
      signals: clipList(result.signals, 7, 120),
      explanation: clip(result.explanation, 500) || 'No explanation provided.',
      method: 'model'
    };
  } catch (err) {
    // Fall back to the pattern check rather than inventing a neutral score.
    console.error('Clickbait analysis failed, falling back to rules:', err.message);
    return { ...clickbaitByRules(title), degraded: true };
  }
};

module.exports = { analyzeClickbait };
