// backend/agents/verdictTranslation.js
//
// The verdict's one-line reason in the reader's own language.
//
// Someone who forwards a Tamil message and gets the answer back only in
// English has been half answered. The reason sentence is short and factual,
// so it is translated once, at temperature 0, by the hosted model; outlet
// names, figures and quoted words are kept as they are. If the translation
// fails, the English line stands alone — the page loses nothing it had.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { UNTRUSTED_NOTICE, fence, clip } = require('../utils/untrusted');

const CALL_WORDS = {
  ta: { FAKE: 'போலி', REAL: 'உண்மை', 'CANNOT VERIFY': 'உறுதிப்படுத்த முடியவில்லை', 'PARTLY FALSE': 'பகுதி பொய்' },
  hi: { FAKE: 'फर्जी', REAL: 'सच', 'CANNOT VERIFY': 'पुष्टि नहीं हो सकी', 'PARTLY FALSE': 'आंशिक रूप से गलत' }
};

/**
 * Is this a translation of that line, or something else?
 *
 * The line quotes headlines and claims, which came from outside, so the
 * reply is held to what a translation must keep: every figure in the English
 * line is still there, and the length is that of a translation of one
 * sentence, not of an answer to some other request. Tamil and Hindi run
 * longer than English in characters; four times is generous.
 */
const looksTranslated = (english, translated) => {
  if (!translated) return false;
  if (translated.length > Math.max(80, english.length * 4)) return false;
  // Devanagari and Tamil digits are the same figures as ASCII ones.
  const ascii = (text) => String(text).replace(/[०-९௦-௯]/g,
    d => String((d.charCodeAt(0) - (d >= '௦' ? 0x0BE6 : 0x0966))));
  const figures = (text) => (ascii(text).match(/\d+(?:[.,]\d+)*/g) || []).map(f => f.replace(/,/g, ''));
  const kept = new Set(figures(translated));
  return figures(english).every(f => kept.has(f));
};

/**
 * @returns {Promise<{call: string|null, oneLine: string, language: string}|null>}
 */
const translateVerdict = async (oneLine, call, languageCode, languageName) => {
  if (!oneLine || !languageCode || languageCode === 'en') return null;
  const prompt = `Translate this fact-check result into ${languageName} for an ordinary reader. Keep names of news outlets and fact-checkers, numbers and anything inside quotation marks exactly as they are.

${UNTRUSTED_NOTICE} Translate it as it stands.

${fence(oneLine, { label: 'result', max: 600 })}

Return a JSON object: {"text": "<the translation>"}`;
  try {
    const result = await callNimApiJson(prompt, { maxTokens: 400, temperature: 0, requiredKeys: ['text'], label: 'verdict translation' });
    const text = clip(result.text, 2400);
    if (!looksTranslated(oneLine, text)) return null;
    return { call: CALL_WORDS[languageCode]?.[call] || null, oneLine: text, language: languageName };
  } catch (_) {
    return null;
  }
};

module.exports = { translateVerdict, looksTranslated };
