// backend/agents/manipulationAgent.js
//
// Propaganda / persuasion-technique detection.
//
// The bias factor answers "is this article slanted?". This answers a sharper
// question: "which specific rhetorical techniques is it using on the reader?"
//
// The taxonomy follows the propaganda-technique literature — SemEval-2020
// Task 11 (Detection of Propaganda Techniques in News Articles) — reduced to
// the techniques that appear most often in mainstream reporting and that a
// non-expert reader can recognise once they are named.
//
// This is a span-level task: each detection must quote the text it applies to,
// so the reader can see the technique in the article's own words.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { languageDirective } = require('../utils/language');
const { manipulationByRules } = require('./heuristics');
const { UNTRUSTED_NOTICE, fence, oneOf, clip } = require('../utils/untrusted');

const TECHNIQUES = {
  'loaded language': 'Emotionally charged words chosen to provoke a reaction rather than inform.',
  'name calling': 'Attaching a label or insult to a person or group instead of addressing the substance.',
  'appeal to fear': 'Promoting an idea by stoking alarm about the alternative.',
  'exaggeration': 'Overstating the scale, danger or importance of something.',
  'minimisation': 'Downplaying something significant to make it seem unimportant.',
  'casting doubt': "Undermining someone's credibility without evidence.",
  'flag waving': 'Appealing to group identity, patriotism or "us vs them" loyalty.',
  'causal oversimplification': 'Reducing a complex situation to a single cause.',
  'false dilemma': 'Presenting only two options when more exist.',
  'whataboutism': "Deflecting criticism by pointing at an opponent's faults.",
  'bandwagon': 'Arguing something is right because many people believe it.',
  'thought-terminating cliche': 'A phrase that shuts down discussion instead of engaging with it.',
  'appeal to authority': 'Claiming something is true because an authority says so, without evidence.',
  'unnamed sources': 'Relying on vague attribution — "experts say", "sources claim" — that cannot be checked.'
};

const TECHNIQUE_NAMES = Object.keys(TECHNIQUES);

const TECHNIQUE_ALIASES = {
  'fear appeal': 'appeal to fear',
  'fear-mongering': 'appeal to fear',
  'fear mongering': 'appeal to fear',
  'alarmism': 'appeal to fear',
  'scare tactics': 'appeal to fear',
  'emotional appeal': 'loaded language',
  'emotional manipulation': 'loaded language',
  'loaded words': 'loaded language',
  'name-calling': 'name calling',
  'ad hominem': 'name calling',
  'insult': 'name calling',
  'labeling': 'name calling',
  'minimization': 'minimisation',
  'downplaying': 'minimisation',
  'understatement': 'minimisation',
  'bandwagon effect': 'bandwagon',
  'appeal to popularity': 'bandwagon',
  'false dichotomy': 'false dilemma',
  'black and white thinking': 'false dilemma',
  'either-or': 'false dilemma',
  'oversimplification': 'causal oversimplification',
  'cherry picking': 'causal oversimplification',
  'faulty causality': 'causal oversimplification',
  'thought-terminating cliché': 'thought-terminating cliche',
  'cliche': 'thought-terminating cliche',
  'slogan': 'thought-terminating cliche',
  'unnamed source': 'unnamed sources',
  'anonymous sources': 'unnamed sources',
  'anonymous source': 'unnamed sources',
  'vague attribution': 'unnamed sources',
  'false authority': 'appeal to authority',
  'argument from authority': 'appeal to authority',
  'whataboutism': 'whataboutism',
  'tu quoque': 'whataboutism',
  'hyperbole': 'exaggeration',
  'sensationalism': 'exaggeration',
  'overstatement': 'exaggeration',
  'discrediting': 'casting doubt',
  'smear': 'casting doubt',
  'patriotism appeal': 'flag waving',
  'nationalism': 'flag waving'
};

const normalizeTechniqueName = (rawName) => {
  if (!rawName || typeof rawName !== 'string') return null;
  const cleaned = rawName.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/[éè]/g, 'e');
  if (TECHNIQUES[cleaned]) return cleaned;
  if (TECHNIQUE_ALIASES[cleaned]) return TECHNIQUE_ALIASES[cleaned];
  // A fragment too short to name anything ("a", "no") must not match the first name containing it.
  if (cleaned.length < 4) return null;
  for (const [alias, canonical] of Object.entries(TECHNIQUE_ALIASES)) {
    if (cleaned.includes(alias) || alias.includes(cleaned)) return canonical;
  }
  for (const canonical of TECHNIQUE_NAMES) {
    if (cleaned.includes(canonical) || canonical.includes(cleaned)) return canonical;
  }
  return null;
};

/**
 * The model's reply read into the factor's result. Shared with the merged writing check
 * (agents/writingChecks.js), so both paths read a reply the same way.
 */
const readManipulation = (result) => {
  if (!result || typeof result !== 'object') throw new Error('no persuasion reading in the reply');
  let rawList = [];
  if (Array.isArray(result)) {
    rawList = result;
  } else if (Array.isArray(result.techniques)) {
    rawList = result.techniques;
  } else if (Array.isArray(result.persuasion_techniques)) {
    rawList = result.persuasion_techniques;
  } else if (Array.isArray(result.items)) {
    rawList = result.items;
  } else if (result.techniques && typeof result.techniques === 'object') {
    rawList = Object.entries(result.techniques).map(([k, v]) => ({
      technique: k,
      ...(typeof v === 'object' && v !== null ? v : { quote: v })
    }));
  }

  const techniques = rawList
    .filter(t => t && typeof t === 'object')
    .map(t => {
      const rawTech = clip(t.technique || t.name || t.type || t.technique_name || t.persuasion_technique || '', 60);
      const rawQuote = clip(t.quote || t.example || t.text || t.sentence || t.excerpt || t.matched_text || '', 600);
      const rawEffect = clip(t.effect || t.description || t.explanation || t.impact || t.role || '', 300);

      // A technique that cannot be named is not counted. It used to be recorded as "loaded language",
      // and a finding about the writing can only count against a story, so a model's unnamed or
      // invented entry was held against it.
      const name = normalizeTechniqueName(rawTech) || oneOf(rawTech, TECHNIQUE_NAMES, null);
      return {
        technique: name,
        definition: TECHNIQUES[name] || '',
        quote: rawQuote,
        effect: rawEffect
      };
    })
    .filter(t => t.technique && t.quote)
    .slice(0, 3);

  const intensity = oneOf(result.intensity, ['none', 'light', 'moderate', 'heavy'], null)
    || (techniques.length === 0 ? 'none'
      : techniques.length === 1 ? 'light'
      : techniques.length === 2 ? 'moderate' : 'heavy');

  // Each distinct technique costs 2.6 points. The cost per technique is tied
  // to how many we ask for: at "at most 5" it was 1.6, and simply keeping
  // that after cutting to 3 would have floored this factor at 5.2, making it
  // impossible for a heavily manipulative article to score badly here.
  const score = Math.round(Math.max(0, Math.min(10, 10 - techniques.length * 2.6)) * 10) / 10;

  return {
    score,
    intensity,
    techniques,
    summary: clip(result.summary, 500),
    distinctCount: new Set(techniques.map(t => t.technique)).size,
    method: 'model'
  };
};

/**
 * Detect persuasion techniques in an article, with the exact text of each.
 * @param {string} title
 * @param {string} content
 * @returns {Promise<{score:number, intensity:string, techniques:Array, summary:string, failed?:boolean}>}
 *          score 0-10 where 10 = plain informative writing, 0 = heavily manipulative.
 */
const detectManipulation = async (title, content, language) => {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  let text = cleanContent;
  if (!text) {
    text = cleanTitle;
  } else if (cleanTitle && !text.startsWith(cleanTitle) && !cleanTitle.startsWith(text)) {
    text = `${cleanTitle}. ${text}`;
  }
  text = text.slice(0, 3000);

  const catalogue = TECHNIQUE_NAMES
    .map(name => `- ${name}: ${TECHNIQUES[name]}`)
    .join('\n');


  // The keys are DESCRIBED, not drawn as a template.
  //
  // Under constrained JSON decoding a placeholder schema is itself a valid
  // completion: given the object already written out with every slot a
  // "<placeholder>", the model can close it and stop. Measured on the summary
  // agent, that produced a bare `{}` on every attempt; here it produced JSON
  // with no `techniques` key, which the gateway correctly rejected and the
  // evaluation then had to abort the article over. Asked in words for an
  // object with named keys, the same model answers correctly.
  const prompt = `You are a propaganda-technique analyst. Identify persuasion techniques used in this news text.

${UNTRUSTED_NOTICE}

Text:
${fence(text, { label: 'news text', max: 3000 })}

Techniques to look for:
${catalogue}

Rules:
- Quote the text EXACTLY as it appears — never paraphrase.
- Only report a technique when it is clearly present. Straightforward factual reporting uses none, and an empty list is the correct answer for such an article.
- Report each distinct instance once. At most 3, the clearest ones.

Return a JSON object with these keys:
- "intensity": one of none, light, moderate, heavy.
- "techniques": an array, empty when the article uses none. Each entry has "technique" (one of: ${TECHNIQUE_NAMES.join(', ')}), "quote" (the exact wording from the article) and "effect" (one short sentence on what it does to the reader).
- "summary": one sentence describing how the article addresses its reader.` + languageDirective(language);

  try {
    // Budget trimmed: three well-evidenced techniques tell the reader as much as five,
    // and lower token limit ensures faster responses within deadline.
    // Temperature 0, as the other writing checks (see clickbaitAgent.js): the techniques found count
    // towards a verdict (verdictEngine R7).
    const result = await callNimApiJson(prompt, { maxTokens: 600, temperature: 0, requiredKeys: ['techniques'], allowArray: true, label: 'manipulation' });

    return readManipulation(result);
  } catch (err) {
    console.error('Manipulation analysis failed, falling back to rules:', err.message);
    const rules = manipulationByRules(title, content);
    // Fill in the definitions the lexicon path leaves blank.
    rules.techniques = rules.techniques.map(t => ({ ...t, definition: TECHNIQUES[t.technique] || '' }));
    return { ...rules, degraded: true };
  }
};

module.exports = { detectManipulation, readManipulation, TECHNIQUES, TECHNIQUE_NAMES };
