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

const CALL_WORDS = {
  ta: { FAKE: 'போலி', REAL: 'உண்மை', 'CANNOT VERIFY': 'உறுதிப்படுத்த முடியவில்லை', 'PARTLY FALSE': 'பகுதி பொய்' },
  hi: { FAKE: 'फर्जी', REAL: 'सच', 'CANNOT VERIFY': 'पुष्टि नहीं हो सकी', 'PARTLY FALSE': 'आंशिक रूप से गलत' }
};

/**
 * @returns {Promise<{call: string|null, oneLine: string, language: string}|null>}
 */
const translateVerdict = async (oneLine, call, languageCode, languageName) => {
  if (!oneLine || !languageCode || languageCode === 'en') return null;
  const prompt = `Translate this fact-check result into ${languageName} for an ordinary reader. Keep names of news outlets and fact-checkers, numbers and anything inside quotation marks exactly as they are.

"${oneLine}"

Return a JSON object: {"text": "<the translation>"}`;
  try {
    const result = await callNimApiJson(prompt, { maxTokens: 400, temperature: 0, requiredKeys: ['text'], label: 'verdict translation' });
    const text = String(result.text || '').trim();
    if (!text) return null;
    return { call: CALL_WORDS[languageCode]?.[call] || null, oneLine: text, language: languageName };
  } catch (_) {
    return null;
  }
};

module.exports = { translateVerdict };
