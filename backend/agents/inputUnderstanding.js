// backend/agents/inputUnderstanding.js
//
// What is this message actually asserting?
//
// The evidence channels answer one question well: is THIS claim true. What
// people paste is rarely a claim. It is a question ("is it true that RBI
// banned 500 notes?"), a hedge ("I heard Modi resigned"), a forward in
// capitals and emoji, a sarcastic aside ("oh sure, and Musk bought Jio too"),
// an opinion wrapped round a fact, two claims in one breath, or all of these
// in Tamil, in Hindi, or in Tamil typed in English letters ("resign
// pannitaru"). Fed to the channels raw, each of these failed differently:
// questions were refused, Tanglish was searched as English, a hedge was
// checked as "I heard", and a message with one true and one false claim got
// one verdict.
//
// This step reads the message once, in whatever language and tone it comes
// in, and returns what it asserts: the language (romanised or not), the kind
// of speech act, the tone, an English rendering, and up to three claims, each
// as a neutral English sentence with its time frame, its kind, a headline, a
// subject and search terms. The channels then check the claims; the writing
// checks still read the message as it was written, because tone is evidence
// there.
//
// It is one call to a hosted model at temperature 0 (remembered for half an
// hour; see utils/nvidiaNimApi.js). If it fails, the caller falls back to the
// regular-expression gate and the ordinary claim extractor, so the page still
// works — less well — rather than not at all.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { findAnchors } = require('./checkability');

const SPEECH_ACTS = new Set(['assertion', 'question', 'hedged', 'sarcasm', 'opinion', 'exhortation', 'prediction', 'mixed']);
const TIMES = new Set(['now', 'past', 'timeless', 'future']);
const KINDS = new Set(['event', 'figure', 'quote', 'standing_fact', 'prediction', 'opinion']);

const LANGUAGE_NAMES = {
  en: 'English', ta: 'Tamil', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali',
  mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', or: 'Odia'
};

// Keywords arrive as a string or as a list, sometimes comma-separated; the
// search wants plain words.
const asWords = (value) => (Array.isArray(value) ? value.join(' ') : String(value || ''))
  .replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();

const buildPrompt = (text) => {
  const today = new Date().toISOString().slice(0, 10);
  return `You read a message someone wants fact-checked and work out exactly what it asserts. The message may be in any language or a mix of languages — Tamil, Hindi, English, or Tamil or Hindi typed in English letters ("resign pannitaru", "istifa de diya") — and it may be a question, sarcastic, a forward in capitals with emoji, hedged ("I heard", "apparently", "my friend says"), opinion mixed with fact, or several claims at once.

Today is ${today}. Judge every date against today, not against what you remember: events dated in 2026 up to today have already happened, and the user is asking about them.

Message:
"""
${String(text).slice(0, 1800)}
"""

Return a JSON object with these keys:
- "language": the ISO 639-1 code of the message's main language ("ta", "hi", "en", ...). Tamil or Hindi typed in English letters is still "ta" or "hi".
- "romanized": true when an Indian language is typed in English letters.
- "speech_act": "assertion", "question", "hedged" (passes on what others say), "sarcasm" (mocks a claim or says the opposite of what it means), "opinion", "exhortation" (tells the reader to do something and states no fact), "prediction" (about the future), or "mixed".
- "tone": a list of one to three of "neutral", "alarmist", "emotional", "celebratory", "sarcastic", "angry", "urgent".
- "english": the whole message in plain English, without emoji. Copy it if it is already English.
- "claims": up to 3 factual claims the message makes or asks about, most important first. List only facts the message asserts or asks about, not facts an opinion merely takes for granted: "Vijay is the best Chief Minister Tamil Nadu has ever had" asserts an opinion and no fact, so it has no claims, while "TVK is unstoppable — it won both bypolls" asserts that TVK won both bypolls. Each is an object with:
  - "claim": one neutral, declarative English sentence. Spell names in full and in their usual English form ("Modi ji" → "Narendra Modi", "தவெக" → "TVK"; keep abbreviations such as TVK, DMK, RBI). For a question, the proposition asked about ("Did India win 84 medals?" → "India won 84 medals at the Asian Games 2026."). For a hedge, the claim being passed on, not the hedge. For sarcasm, the literal claim being mocked ("Oh sure, and Musk bought Jio too" → "Elon Musk bought Reliance Jio."). Keep negation exactly as stated ("TVK did not lose" stays negative). Keep every figure, place and date the message gives, and add none it does not.
  - "time": "now" if presented as happening today or this week, "past" for an earlier event, "timeless" for a standing fact, "future" only for a forecast of something that has not happened ("RBI will cut rates in December"). An announcement or decision reported as made, even one that takes effect later ("gazette declares holidays from November", "notes invalid from midnight"), is "now": the claim is that the announcement was made.
  - "kind": "event", "figure", "quote", "standing_fact", "prediction" (a forecast, not a reported decision) or "opinion".
  - "checkable": true only if it names a specific person, organisation, place, event or figure, so that news reports or a reference work could confirm or refute it. Opinions, predictions and vague statements are false.
  - "headline": the claim as a short English news headline.
  - "subject": the specific person, organisation, event or thing it is about, in 1 to 4 English words a news search would use — not a whole country on its own.
  - "other_subject": a second person, organisation or thing the claim is about, in the same form, or an empty string ("Elon Musk bought Reliance Jio": subject "Elon Musk", other_subject "Reliance Jio").
  - "search_keywords": 3 or 4 distinctive words in the message's own language and script.
  - "search_keywords_en": 3 or 4 distinctive English words, names first.
- "not_checkable_reason": if no claim is checkable, one plain sentence to the user saying why; otherwise an empty string.`;
};

/**
 * @param {string} text - the message as the user gave it (or as read from a screenshot)
 * @returns {Promise<Object|null>} the reading, or null when it could not be made
 */
const understandInput = async (text) => {
  const body = String(text || '').trim();
  if (!body) return null;

  let result;
  try {
    result = await callNimApiJson(buildPrompt(body), {
      maxTokens: 1400, temperature: 0, requiredKeys: ['claims', 'speech_act'], label: 'input understanding'
    });
  } catch (_) {
    return null;
  }

  const language = String(result.language || 'en').toLowerCase().slice(0, 2);
  const romanized = Boolean(result.romanized) && language !== 'en';
  const speechAct = SPEECH_ACTS.has(result.speech_act) ? result.speech_act : 'assertion';

  const claims = (Array.isArray(result.claims) ? result.claims : [])
    .filter(c => c && c.claim)
    .slice(0, 3)
    .map(c => {
      const claim = String(c.claim).trim();
      const keywordsEn = asWords(c.search_keywords_en) || null;
      // Romanised Tamil keywords match nothing: the press writes Tamil in Tamil
      // script and English in English. Search in English for those.
      const native = asWords(c.search_keywords);
      const keywords = romanized || !native ? (keywordsEn || claim) : native;
      // A claim the model calls checkable must still name something: a model
      // can talk itself into "checkable" about "something big is coming".
      const anchors = findAnchors(claim);
      const firstWord = (claim.split(/\s+/)[0] || '').replace(/[^\p{L}\p{N}]/gu, '');
      const named = anchors.names.length + anchors.numbers.length + anchors.dates.length > 0
        || (/^\p{Lu}/u.test(firstWord) && firstWord.length > 2 && !/^(The|This|That|There|They|It|A|An|Some|Something|Everyone|People)$/.test(firstWord));
      return {
        claim,
        headline: c.headline ? String(c.headline).slice(0, 160) : null,
        subject: c.subject ? String(c.subject).slice(0, 60) : null,
        otherSubject: c.other_subject ? String(c.other_subject).slice(0, 60) : null,
        keywords,
        keywordsEn,
        time: TIMES.has(c.time) ? c.time : 'past',
        kind: KINDS.has(c.kind) ? c.kind : 'event',
        // The model's own "checkable" is advisory. It has marked a claim about
        // the 2026 Asian Games uncheckable because, from its training, 2026
        // had not happened yet. A named factual claim goes to the evidence; if
        // nothing bears on it the verdict says so, which is safe. Only
        // opinions and forecasts are held back.
        checkable: named && !['prediction', 'opinion'].includes(c.kind)
          && (Boolean(c.checkable) || ['event', 'figure', 'quote', 'standing_fact'].includes(c.kind))
      };
    });

  return {
    language,
    languageName: LANGUAGE_NAMES[language] || language,
    romanized,
    speechAct,
    tone: (Array.isArray(result.tone) ? result.tone : []).map(String).slice(0, 3),
    english: String(result.english || '').trim() || body,
    claims,
    checkableClaims: claims.filter(c => c.checkable),
    notCheckableReason: String(result.not_checkable_reason || '').trim()
  };
};

module.exports = { understandInput, LANGUAGE_NAMES };
