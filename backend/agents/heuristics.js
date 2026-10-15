// backend/agents/heuristics.js
//
// Deterministic, no-LLM analysers — the safety net under the four content
// factors.
//
// Why this exists
// ---------------
// Every content factor used to answer a failed model call with `score: 5,
// failed: true`. Nothing read that flag, so an outage produced a confident
// "Mostly fine ~5.5/10" report assembled from four placeholders. A reader had
// no way to tell a checked article from an unchecked one, which is the single
// worst thing this system could do.
//
// The honest alternatives are to stand the factor down, or to answer it with
// something real. Three of these four factors are genuinely computable from the
// text itself: clickbait, persuasion technique and transparency are surface
// linguistic phenomena that lexicons and patterns detect reasonably well — that
// is precisely how they were measured before neural models, and it is why the
// SemEval propaganda task ships lexicon baselines.
//
// So these run when the model cannot. They are deliberately weaker than the
// model: they find fewer things and never claim otherwise. Every result they
// produce is stamped `method: 'rules'` so the orchestrator, the report and the
// reader all know the difference, and the score is reported as provisional.
//
// They are a fallback, not a replacement. The LLM path stays primary.

/* -------------------------------------------------------------------------
   Shared helpers
   ------------------------------------------------------------------------- */

/** Split text into sentences, keeping them intact enough to quote back. */
const sentencesOf = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(s => s.length > 15);

/** Count non-overlapping matches without throwing on an empty string. */
const countMatches = (text, re) => (String(text || '').match(re) || []).length;

/** Round to one decimal, clamped to the 0-10 scale every factor uses. */
const clamp10 = (n) => Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;

/* -------------------------------------------------------------------------
   Clickbait
   ------------------------------------------------------------------------- */

// Each pattern names the signal it detects, so a hit can be reported in the
// same vocabulary the model uses.
const CLICKBAIT_PATTERNS = [
  { signal: 'Curiosity gap — withholds the point to force a click', cost: 3.0,
    re: /\b(you won'?t believe|wait until you see|what happened next|the reason (why|will)|you'?ll never guess|this is what happens|here'?s (why|what)|the truth about|nobody talks about|will (shock|surprise|stun) you)\b/i },
  { signal: 'Listicle bait', cost: 2.0,
    re: /^\s*\d+\s+(things|ways|reasons|signs|facts|times|secrets|tricks|rules|habits)\b/i },
  { signal: 'Sensational verb', cost: 2.0,
    re: /\b(slams?|blasts?|destroys?|demolishes?|rips?|shreds?|eviscerates?|humiliates?|torches?|obliterates?)\b/i },
  { signal: 'Sensational adjective', cost: 2.0,
    re: /\b(shocking|explosive|bombshell|jaw-dropping|mind-blowing|unbelievable|insane|epic|savage|brutal|devastating)\b/i },
  { signal: 'Unsubstantiated superlative', cost: 1.5,
    re: /\b(best|worst|biggest|greatest|most important)\s+(ever|in history|of all time|you'?ll ever)\b/i },
  { signal: 'Addresses the reader directly', cost: 1.0,
    re: /\b(you|your)\b/i },
  { signal: 'Vague demonstrative instead of naming the subject', cost: 1.5,
    re: /^\s*(this|these|that|here'?s)\b/i },
  { signal: 'Excessive punctuation', cost: 1.5,
    re: /(!{2,}|\?{2,}|\?!|!\?)/ }
];

/**
 * Score a headline for clickbait without a model.
 * @param {string} title
 * @returns {{score:number, isClickbait:boolean, signals:string[], explanation:string, method:string}}
 *          score 0-10 where 10 = straightforward headline.
 */
const clickbaitByRules = (title) => {
  const headline = String(title || '').trim();
  const signals = [];
  let penalty = 0;

  for (const { signal, re, cost } of CLICKBAIT_PATTERNS) {
    if (re.test(headline)) {
      signals.push(signal);
      penalty += cost;
    }
  }

  // Shouted words, ignoring short tokens that are usually acronyms (US, EU, AP).
  const shouted = (headline.match(/\b[A-Z]{4,}\b/g) || [])
    .filter(w => !/^(NASA|NATO|OPEC|WHO|FIFA|NCAA)$/.test(w));
  if (shouted.length) {
    signals.push('Words set in all capitals');
    penalty += Math.min(2.5, shouted.length * 1.25);
  }

  const score = clamp10(10 - penalty);
  return {
    score,
    isClickbait: score < 5,
    signals,
    explanation: signals.length
      ? `Pattern check found ${signals.length} clickbait signal${signals.length === 1 ? '' : 's'} in the headline.`
      : 'Pattern check found no clickbait signals in the headline.',
    method: 'rules'
  };
};

/* -------------------------------------------------------------------------
   Bias
   ------------------------------------------------------------------------- */

// Loaded political and evaluative vocabulary. These words are not forbidden —
// they carry a judgement, and a reader deserves to see where the judgement sits.
const LOADED_TERMS = [
  'radical', 'extremist', 'regime', 'thug', 'elitist', 'far-left', 'far-right',
  'socialist agenda', 'communist', 'fascist', 'deep state', 'mainstream media',
  'corrupt', 'disgraceful', 'outrageous', 'shameful', 'appalling', 'horrific',
  'catastrophic', 'disastrous', 'reckless', 'dangerous agenda', 'so-called',
  'apologist', 'shill', 'puppet', 'witch hunt', 'hoax', 'smear'
];

const ABSOLUTES = /\b(everyone knows|no one can deny|it is obvious that|clearly|undeniably|without question|always|never)\b/i;

/**
 * Detect loaded and one-sided language without a model.
 * @param {string} title
 * @param {string} content
 * @returns {{score:number, biasLevel:string, politicalLean:string, flaggedSentences:Array, explanation:string, method:string}}
 *          score 0-10 where 10 = neutrally worded.
 */
const biasByRules = (title, content) => {
  const sentences = sentencesOf(`${title}. ${content || ''}`);
  const loadedRe = new RegExp(`\\b(${LOADED_TERMS.map(t => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`, 'i');

  const flaggedSentences = [];
  for (const sentence of sentences) {
    const loaded = sentence.match(loadedRe);
    if (loaded) {
      flaggedSentences.push({
        sentence,
        type: 'loaded language',
        reason: `Uses the loaded term "${loaded[1]}".`
      });
      continue;
    }
    const absolute = sentence.match(ABSOLUTES);
    if (absolute) {
      flaggedSentences.push({
        sentence,
        type: 'sweeping claim',
        reason: `States "${absolute[1]}" as beyond dispute.`
      });
    }
  }

  const flagged = flaggedSentences.slice(0, 5);
  // Judge density, not raw count: a long article naturally contains more of
  // everything, and penalising length would punish thorough reporting.
  const density = sentences.length ? flaggedSentences.length / sentences.length : 0;
  const score = clamp10(10 - Math.min(6, density * 20) - Math.min(2, flaggedSentences.length * 0.3));

  return {
    score,
    biasLevel: score >= 7.5 ? 'low' : score >= 5 ? 'moderate' : 'high',
    // Direction of lean is a judgement call this check cannot make honestly.
    politicalLean: 'not-assessed',
    flaggedSentences: flagged,
    explanation: flagged.length
      ? `Lexicon check flagged ${flaggedSentences.length} sentence${flaggedSentences.length === 1 ? '' : 's'} using loaded or absolute wording.`
      : 'Lexicon check found no loaded or absolute wording.',
    method: 'rules'
  };
};

/* -------------------------------------------------------------------------
   Persuasion techniques
   ------------------------------------------------------------------------- */

// A lexicon cannot see most of the taxonomy — whataboutism and false dilemma
// need discourse understanding. It reliably catches the lexical ones, so it
// only looks for those and stays quiet about the rest.
const TECHNIQUE_PATTERNS = [
  { technique: 'loaded language',
    re: /\b(shocking|outrageous|disgraceful|appalling|horrific|devastating|catastrophic|shameful|disastrous|evil|corrupt|scandal|scam|insane|vicious|brutal|nightmare)\b/i,
    effect: 'Pushes the reader toward an emotional reaction before they weigh the facts.' },
  { technique: 'name calling',
    re: /\b(thug|extremist|radical|fascist|communist|puppet|shill|apologist|traitor|clown|scumbag|crook|monster|idiot|fool)\b/i,
    effect: 'Labels a person or group instead of addressing what they did or said.' },
  { technique: 'appeal to fear',
    re: /\b(threatens? to destroy|could be catastrophic|before it'?s too late|on the brink|dire consequences|will devastate|wake up before|danger|deadly|terrifying|panic|destruction)\b/i,
    effect: 'Argues by alarm about what happens otherwise.' },
  { technique: 'exaggeration',
    re: /\b(unprecedented|never before in history|the worst .{0,20}ever|astronomical|infinitely|massive|total collapse|absolute disaster|100%|completely destroyed)\b/i,
    effect: 'Overstates scale, making the story feel larger than the evidence supports.' },
  { technique: 'flag waving',
    re: /\b(real (americans|patriots)|our way of life|un-?american|true patriots?|for the people)\b/i,
    effect: 'Appeals to group loyalty rather than to evidence.' },
  { technique: 'bandwagon',
    re: /\b(everyone (knows|agrees)|most people (know|agree)|nobody believes|we all know)\b/i,
    effect: 'Treats popularity as proof.' },
  { technique: 'thought-terminating cliche',
    re: /\b(it is what it is|end of story|case closed|enough said|period\.)\b/i,
    effect: 'Closes the discussion rather than engaging with it.' },
  { technique: 'unnamed sources',
    re: /\b(experts? (say|believe|warn)|sources? (say|claim|told)|studies show|research suggests|many believe|critics say|it is (said|believed)|whistleblower|insiders? (say|claim))\b/i,
    effect: 'Borrows authority the reader cannot check.' }
];

/**
 * Detect lexically visible persuasion techniques without a model.
 * @param {string} title
 * @param {string} content
 * @returns {{score:number, intensity:string, techniques:Array, summary:string, distinctCount:number, method:string}}
 *          score 0-10 where 10 = plain informative writing.
 */
const manipulationByRules = (title, content) => {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  let text = cleanContent;
  if (!text) {
    text = cleanTitle;
  } else if (cleanTitle && !text.startsWith(cleanTitle) && !cleanTitle.startsWith(text)) {
    text = `${cleanTitle}. ${text}`;
  }
  const sentences = sentencesOf(text);
  const techniques = [];
  const seen = new Set();

  for (const sentence of sentences) {
    for (const { technique, re, effect } of TECHNIQUE_PATTERNS) {
      if (seen.has(technique)) continue;   // report each technique once, with its first instance
      if (re.test(sentence)) {
        seen.add(technique);
        techniques.push({ technique, definition: '', quote: sentence, effect });
      }
    }
  }

  // Same scale as the model path in manipulationAgent.js: at most three
  // techniques, 2.6 points each, so both routes score comparably.
  const found = techniques.slice(0, 3);
  const score = clamp10(10 - found.length * 2.6);

  return {
    score,
    intensity: found.length === 0 ? 'none'
      : found.length === 1 ? 'light'
      : found.length === 2 ? 'moderate' : 'heavy',
    techniques: found,
    summary: found.length
      ? `Pattern check found ${found.length} persuasion technique${found.length === 1 ? '' : 's'} in the text.`
      : 'Pattern check found no persuasion techniques it can detect.',
    distinctCount: seen.size,
    method: 'rules'
  };
};

/* -------------------------------------------------------------------------
   Transparency
   ------------------------------------------------------------------------- */

const VAGUE_ATTRIBUTION_RE =
  /\b(experts? (?:say|believe|warn|suggest)|sources? (?:say|claim|told|close to)|studies show|research (?:shows|suggests)|many (?:believe|say)|some (?:say|believe|argue)|critics say|reports suggest|it is (?:said|believed|understood))\b/gi;

// Speech verbs that mark an attribution; a capitalised name beside one is a
// named source.
const ATTRIBUTION_RE =
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:said|says|told|stated|announced|confirmed|added|wrote)\b|according to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g;

const PRIMARY_EVIDENCE_RE =
  /\b(report|study|survey|poll|filing|court|ruling|statement|document|transcript|data|figures|analysis|audit|census|investigation)\b/i;

const SWEEPING_RE =
  /\b(everyone knows|no one can deny|always|never|all of them|none of them|undeniably|without question)\b/i;

/**
 * Assess how checkable an article is without a model, using the same checklist
 * the LLM path reports against.
 * @param {string} title
 * @param {string} content
 * @param {Array} checkDefs - the CHECKS array from transparencyAgent
 * @returns {{score:number, level:string, checks:Array, passedCount:number, totalChecks:number,
 *            namedExamples:string[], vagueAttributions:string[], summary:string, method:string}}
 */
const transparencyByRules = (title, content, checkDefs) => {
  const text = `${title}. ${content || ''}`;

  // Named sources: a proper name attached to a speech verb.
  const named = [];
  let m;
  const attributionRe = new RegExp(ATTRIBUTION_RE.source, 'g');
  while ((m = attributionRe.exec(text)) !== null) {
    const name = (m[1] || m[2] || '').trim();
    if (name && !named.includes(name)) named.push(name);
    if (named.length >= 4) break;
  }

  // Direct quotes: a quoted span long enough to be a real quotation.
  const quoteCount = countMatches(text, /["“][^"”]{25,}["”]/g);

  const results = {
    namedSources: named.length > 0,
    directQuotes: quoteCount > 0,
    primaryEvidence: PRIMARY_EVIDENCE_RE.test(text),
    // Concrete detail: a date, a percentage, or a figure with units.
    specificDetail:
      /\b(19|20)\d{2}\b/.test(text) ||
      /\b\d+(\.\d+)?\s?%/.test(text) ||
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i.test(text) ||
      countMatches(text, /\b\d[\d,]{2,}\b/g) > 0,
    measuredClaims: !SWEEPING_RE.test(text)
  };

  const checks = checkDefs.map(c => ({
    id: c.id,
    label: c.label,
    help: c.help,
    passed: results[c.id] === true
  }));

  const earned = checkDefs.reduce((sum, c) => sum + (results[c.id] ? c.weight : 0), 0);
  const total = checkDefs.reduce((sum, c) => sum + c.weight, 0);

  // Dedupe case-insensitively, keeping the casing as it first appeared —
  // "Experts say" and "experts say" are one phrase, not two findings.
  const seenPhrases = new Set();
  const vagueAttributions = [];
  for (const raw of (text.match(VAGUE_ATTRIBUTION_RE) || [])) {
    const phrase = raw.trim();
    const key = phrase.toLowerCase();
    if (seenPhrases.has(key)) continue;
    seenPhrases.add(key);
    vagueAttributions.push(phrase);
    if (vagueAttributions.length >= 5) break;
  }

  let score = (earned / total) * 10;
  score = clamp10(score - Math.min(2, vagueAttributions.length * 0.5));

  const passedCount = checks.filter(c => c.passed).length;

  return {
    score,
    level: score >= 7.5 ? 'well sourced'
      : score >= 5 ? 'partly sourced'
      : score >= 2.5 ? 'thinly sourced'
      : 'unsourced',
    checks,
    passedCount,
    totalChecks: checkDefs.length,
    namedExamples: named,
    vagueAttributions,
    summary: `Pattern check: ${passedCount} of ${checkDefs.length} journalism checks are visible in the text.`,
    method: 'rules'
  };
};

module.exports = {
  clickbaitByRules,
  biasByRules,
  manipulationByRules,
  transparencyByRules
};
