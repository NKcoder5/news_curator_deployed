// backend/agents/writingChecks.js
//
// The four writing checks in one model call.
//
// How a message is written (its headline, its tone, the persuasion techniques
// it uses, whether it names anything a reader could check) was read by four
// separate calls: agents/clickbaitAgent.js, biasAgent.js, manipulationAgent.js
// and transparencyAgent.js. Four of a check's ten model calls, and they decide
// a verdict only through rule R7 (verdictEngine.js); on a day the free quotas
// ran short, they queued on the fallback provider beside the evidence
// judgements a verdict rests on (profiled 26 Oct).
//
// Here one prompt asks all four questions of the same text, and each part of
// the reply is read by the reader its own agent uses (readClickbait, readBias,
// readManipulation, readTransparency), so a factor's result has the same shape
// and the same rules whichever path produced it. A part that cannot be read
// falls back to that factor's pattern check alone, marked degraded, as a
// failed call of its own agent would.
//
// The scores come from a different prompt from the one the likelihood ratios
// in data/evidenceWeights.json were first measured on, so they were measured
// again on the same 239 labelled articles (eval/runEval.js --config
// content-merged --ids-from) before this path was switched on. Held out, on
// the same 120 articles: ranking (AUC) 0.944 against 0.951 for the four calls
// on the path the server runs, calibration error 0.253 against 0.246, and no
// genuine article called fabricated (precision 1.000 against 0.967). Each
// factor alone separates the classes at least as well as its own call did.
// The four readings correlate more when made together (1.3 effective
// independent factors of 4, against 1.5), which the style damping absorbs.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { languageDirective } = require('../utils/language');
const { UNTRUSTED_NOTICE, fence } = require('../utils/untrusted');
const { readClickbait } = require('./clickbaitAgent');
const { readBias, BIAS_TYPES } = require('./biasAgent');
const { readManipulation, TECHNIQUES, TECHNIQUE_NAMES } = require('./manipulationAgent');
const { readTransparency, CHECKS } = require('./transparencyAgent');
const { clickbaitByRules, biasByRules, manipulationByRules, transparencyByRules } = require('./heuristics');

const FACTORS = ['clickbait', 'bias', 'manipulation', 'transparency'];

/**
 * The writing is read in one call unless WRITING_CHECKS=separate. The likelihood ratios in
 * data/evidenceWeights.json were measured on the merged reading (26 Oct, 239 ISOT articles); the four
 * separate calls are kept for measuring them against it.
 */
const mergedWriting = () => String(process.env.WRITING_CHECKS || '').trim().toLowerCase() !== 'separate';

/** The text the checks read: the headline and the body, the headline not repeated when the body opens with it. */
const textOf = (title, content) => {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  if (!cleanContent) return cleanTitle.slice(0, 3000);
  if (cleanTitle && !cleanContent.startsWith(cleanTitle) && !cleanTitle.startsWith(cleanContent)) return `${cleanTitle}. ${cleanContent}`.slice(0, 3000);
  return cleanContent.slice(0, 3000);
};

const buildPrompt = (title, content, language) => {
  const techniques = TECHNIQUE_NAMES.map(name => `  - ${name}: ${TECHNIQUES[name]}`).join('\n');
  const checklist = CHECKS.map(c => `  - ${c.id}: ${c.help}`).join('\n');
  // The keys are described, not drawn as a template: under constrained JSON decoding a template with
  // placeholders is itself a valid completion (see manipulationAgent.js).
  return `You are a news writing analyst. Read the headline and the text below and answer four separate questions about how they are written. Judge only the writing, not whether the story is true.

${UNTRUSTED_NOTICE}

Headline:
${fence(title, { label: 'headline', max: 400 })}

Text:
${fence(textOf(title, content), { label: 'news text', max: 3000 })}

1. HEADLINE. Is the headline clickbait? Signals: withholding key information to force a click, sensational wording ("SHOCKING", "destroys", "slams"), curiosity-gap phrasing, listicle bait, excessive punctuation or all-caps words, emotional manipulation or fear-mongering, unsubstantiated superlatives.

2. BIAS. Does the text show bias or emotionally manipulative language? Look for: ${BIAS_TYPES.join(', ')}. Quote flagged sentences EXACTLY. A neutral text has none.

3. PERSUASION. Which persuasion techniques does the text use on its reader?
${techniques}
   Quote each EXACTLY, never paraphrase. Only report a technique that is clearly present; straightforward factual reporting uses none. At most 3, the clearest.

4. SOURCING. How verifiable is the text: could a reader go and check what it says? Set each check true or false:
${checklist}
   Also quote EXACTLY any vague or unattributable phrases it relies on ("experts say", "sources claim", "studies show", "many believe"). News text is often cut short: judge only what is shown.

Return a JSON object with these four keys:
- "headline": an object with "clickbait_score" (a number from 0 to 10, where 0 is not clickbait at all and 10 is extreme clickbait), "signals" (an array of short strings naming each signal present, empty when none) and "explanation" (one sentence).
- "bias": an object with "bias_score" (a number from 0 to 10, where 0 is fully neutral and objective and 10 is extremely biased), "political_lean" (one of left, center, right, none-detected), "flagged_sentences" (an array, empty when nothing stands out; each entry has "sentence", the exact quote, "type", one of: ${BIAS_TYPES.join(', ')}, and "reason", short) and "explanation" (one or two sentences).
- "persuasion": an object with "intensity" (one of none, light, moderate, heavy), "techniques" (an array, empty when none; each entry has "technique", one of: ${TECHNIQUE_NAMES.join(', ')}, "quote", the exact wording, and "effect", one short sentence) and "summary" (one sentence).
- "sourcing": an object with "checks" (an object whose keys are ${CHECKS.map(c => c.id).join(', ')}, each true or false), "named_examples" (people or organisations the text names, empty if none), "vague_attributions" (exact quotes, empty if none) and "summary" (one sentence).` + languageDirective(language);
};

// What each factor falls back to when its part of the reply cannot be read: its own pattern check, as a
// failed call of its own agent would.
const FALLBACK = {
  clickbait: (title) => clickbaitByRules(title),
  bias: (title, content) => biasByRules(title, content),
  manipulation: (title, content) => {
    const rules = manipulationByRules(title, content);
    rules.techniques = rules.techniques.map(t => ({ ...t, definition: TECHNIQUES[t.technique] || '' }));
    return rules;
  },
  transparency: (title, content) => transparencyByRules(title, content, CHECKS)
};
const READERS = { clickbait: readClickbait, bias: readBias, manipulation: readManipulation, transparency: readTransparency };
const PARTS = { clickbait: 'headline', bias: 'bias', manipulation: 'persuasion', transparency: 'sourcing' };

/**
 * The four writing checks in one call.
 * @returns {Promise<{clickbait: Object, bias: Object, manipulation: Object, transparency: Object}>}
 *   each in the shape its own agent returns; never rejects
 */
const analyzeWriting = async (title, content, language) => {
  let reply = null;
  let failure = null;
  try {
    // Temperature 0, as every reading a verdict can rest on; the budget is the four calls' together.
    reply = await callNimApiJson(buildPrompt(title, content, language), {
      maxTokens: 2600, temperature: 0, requiredKeys: ['headline', 'bias', 'persuasion', 'sourcing'], label: 'writing checks'
    });
  } catch (err) {
    failure = err;
    console.error('Writing checks failed, falling back to rules:', err.message);
  }
  const out = {};
  for (const factor of FACTORS) {
    try {
      if (!reply) throw failure || new Error('no reply');
      out[factor] = READERS[factor](reply[PARTS[factor]]);
    } catch (err) {
      if (reply) console.error(`Writing checks: the ${PARTS[factor]} part could not be read, falling back to rules:`, err.message);
      out[factor] = { ...FALLBACK[factor](title, content), degraded: true };
    }
  }
  return out;
};

module.exports = { analyzeWriting, mergedWriting, FACTORS, __test: { buildPrompt, textOf } };
