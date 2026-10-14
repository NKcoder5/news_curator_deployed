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
const { UNTRUSTED_NOTICE, fence, asBool, oneOf, clip, clipList, addressesModel } = require('../utils/untrusted');

const SPEECH_ACTS = new Set(['assertion', 'question', 'hedged', 'sarcasm', 'opinion', 'exhortation', 'prediction', 'mixed']);
const TIMES = new Set(['now', 'past', 'timeless', 'future']);
const KINDS = new Set(['event', 'figure', 'quote', 'standing_fact', 'prediction', 'opinion']);
const TONES = new Set(['neutral', 'alarmist', 'emotional', 'celebratory', 'sarcastic', 'angry', 'urgent']);

// Every field of the reading is shown to the reader or searched for, so each
// is held to what the prompt asked for. A claim is one sentence, not an essay
// a message talked the model into writing.
const MAX_CLAIM_CHARS = 300;

const LANGUAGE_NAMES = {
  en: 'English', ta: 'Tamil', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali',
  mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', or: 'Odia'
};

// A claim the message presents as today's news is about now, whatever the
// model says. Measured: "Chandrayaan-3 lands on the Moon today" came back as
// a past event dated today, so the check for old news passed off as new
// (agents/verdictEngine.js) never ran and the verdict was PARTLY FALSE.
const TODAY_WORDS = /\b(?:today|tonight|this (?:morning|evening|afternoon)|just now|right now|breaking)\b|இன்று|இப்போது|आज|अभी/i;
const presentedAsNow = (claim, message, kind = 'event') => {
  const today = new Date().toISOString().slice(0, 10);
  if (TODAY_WORDS.test(claim) || claim.includes(today)) return true;
  // The message says "today" and the claim is an event without a year of its
  // own: the model dropped the word, not the framing. A standing fact the
  // message mentions alongside ("India is the first country to land near the
  // south pole") stays what it is.
  return kind === 'event' && TODAY_WORDS.test(message)
    && /\b(?:lands|landed|launche[sd]|wins|won|announce[sd]|declare[sd]|resigns|resigned|dies|died|passe[sd] away|arrested|sworn in)\b/i.test(claim)
    && !/\b(?:19|20)\d{2}\b/.test(claim);
};

// A claim is about now only when the message says so. The model's "time"
// varies from one call to the next, and a September launch read as "now"
// made its September coverage look like old news passed off as new: "ISRO
// successfully launched the EOS-05 satellite" came back FAKE on one run of
// the held-out suite and REAL on the next. Without a word placing it in the
// present — today, this week, breaking, from tomorrow, will — "now" is read
// as "past".
const NOW_MARKERS = /\b(?:today|tonight|now|currently|just|breaking|latest|live|ongoing|tomorrow|will|announce[sd]?|this (?:week|morning|evening|afternoon|month|year)|(?:on|from|by|till|until|before) (?:tomorrow|today|tonight|midnight|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d))\b|is being|are being|இன்று|இப்போது|நாளை|आज|अभी|कल/i;
const claimTime = (modelTime, claim, message, english, kind) => {
  if (presentedAsNow(claim, message, kind) && modelTime !== 'future') return 'now';
  const time = modelTime || 'past';
  if (time === 'now' && !NOW_MARKERS.test(`${message} ${english || ''}`)) return 'past';
  return time;
};

// Keywords arrive as a string or as a list, sometimes comma-separated; the
// search wants plain words.
const asWords = (value) => (Array.isArray(value) ? value.join(' ') : String(value || ''))
  .replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();

const buildPrompt = (text) => {
  const today = new Date().toISOString().slice(0, 10);
  return `You read a message someone wants fact-checked and work out exactly what it asserts. The message may be in any language or a mix of languages — Tamil, Hindi, English, or Tamil or Hindi typed in English letters ("resign pannitaru", "istifa de diya") — and it may be a question, sarcastic, a forward in capitals with emoji, hedged ("I heard", "apparently", "my friend says"), opinion mixed with fact, or several claims at once.

Today is ${today}. Judge every date against today, not against what you remember: events dated in 2026 up to today have already happened, and the user is asking about them.

${UNTRUSTED_NOTICE}

Message:
${fence(text, { label: 'message', max: 1800 })}

Return a JSON object with these keys:
- "language": the ISO 639-1 code of the message's main language ("ta", "hi", "en", ...). Tamil or Hindi typed in English letters is still "ta" or "hi".
- "romanized": true when an Indian language is typed in English letters.
- "speech_act": "assertion", "question", "hedged" (passes on what others say), "sarcasm" (mocks a claim or says the opposite of what it means), "opinion", "exhortation" (tells the reader to do something and states no fact), "prediction" (about the future), or "mixed".
- "tone": a list of one to three of "neutral", "alarmist", "emotional", "celebratory", "sarcastic", "angry", "urgent".
- "english": the whole message in plain English, without emoji. Copy it if it is already English.
- "claims": up to 3 factual claims the message makes or asks about, most important first. List only what the message asserts or asks about, never the background it takes for granted: a person's job or title ("General Dhiraj Seth is the Army chief"), that an organisation exists, or that an event took place when the message is about what happened at it. Those are not claims the message makes, and checking them separately would confirm the background while the real claim is false. Likewise an opinion merely takes facts for granted: "Vijay is the best Chief Minister Tamil Nadu has ever had" asserts an opinion and no fact, so it has no claims, while "TVK is unstoppable — it won both bypolls" asserts that TVK won both bypolls. Each is an object with:
  - "claim": one neutral, declarative English sentence. Spell names in full and in their usual English form ("Modi ji" → "Narendra Modi", "தவெக" → "TVK"; keep abbreviations such as TVK, DMK, RBI). For a question, the proposition asked about ("Did India win 84 medals?" → "India won 84 medals at the Asian Games 2026."). For a hedge, the claim being passed on, not the hedge. For sarcasm, the literal claim being mocked ("Oh sure, and Musk bought Jio too" → "Elon Musk bought Reliance Jio."). Keep negation exactly as stated ("TVK did not lose" stays negative). Keep every figure, place and date the message gives, and add none it does not.
  - "time": "now" if presented as happening today or this week — even when the event itself happened long ago ("Chandrayaan-3 lands on the Moon today" is "now": the message presents it as today's news, and that is what must be checked). Keep "today" as the word "today" in the claim; do not replace it with a date, "past" for an earlier event, "timeless" for a standing fact, "future" only for a forecast of something that has not happened ("RBI will cut rates in December"). An announcement or decision reported as made, even one that takes effect later ("gazette declares holidays from November", "notes invalid from midnight"), is "now": the claim is that the announcement was made.
  - "kind": "event", "figure", "quote", "standing_fact", "prediction" (a forecast, not a reported decision) or "opinion". A message that states as settled that an authority or organisation will do something soon — a power cut in Madurai from tomorrow, banks shut from Monday, notes invalid from midnight — is claiming the decision has been announced: write the claim as that announcement ("A week-long power cut in Madurai from tomorrow has been announced"), with time "now" and kind "event". Only a forecast of an outcome nobody has yet decided ("RBI will cut rates in December", "petrol prices will rise") is a "prediction".
  - "checkable": true if it names a specific person, organisation, place, event or figure, or states a general fact about something a reference work describes — an animal, a plant, a substance, a natural phenomenon, a body in space, a country ("Giraffe is a fish", "The sun rises in the west", "Water boils at 100 degrees Celsius") — so that news reports or a reference work could confirm or refute it. A general fact is kind "standing_fact", time "timeless", and its subject is the thing it is about ("giraffe", "Sun"). Opinions, predictions and vague statements are false, and so is anything about a private person known only to the sender ("my neighbour Ramesh bought a car", "my friend's son got a job"): no news report or reference work covers private lives.
  A title or label at the start of the message ("Punjab Anti-Drug Activist Saved: ...") is a claim the message makes, and is listed as its own claim even when the text after it says something else — a false title over true details is how such forwards mislead.
  A forward that tells the reader to act ("register now", "forward to everyone", "apply before Sunday") still asserts what it urges about: "Government is giving free laptops to all students, register at the link" claims that the government is giving free laptops to all students. List that claim, with time "now" and kind "event", even when the message's speech act is an exhortation.
  - "headline": the claim as a short English news headline.
  - "subject": the specific person, organisation, event or thing it is about, in 1 to 4 English words a news search would use — not a whole country on its own.
  - "other_subject": a second person, organisation or thing the claim is about, in the same form, or an empty string ("Elon Musk bought Reliance Jio": subject "Elon Musk", other_subject "Reliance Jio").
  - "search_keywords": 3 or 4 distinctive words in the message's own language and script.
  - "search_keywords_en": 3 or 4 distinctive English words, names first.
  - "region_language": when the claim is about a particular Indian state, district, city or town, the ISO 639-1 code of that region's main language ("Coimbatore" → "ta", "Pune" → "mr", "Hyderabad" → "te", "Kochi" → "ml", "Bengaluru" → "kn", "Kolkata" → "bn", "Lucknow" → "hi"); otherwise an empty string.
  - "search_keywords_regional": when region_language is set, 3 or 4 distinctive words for the claim in that language's own script, names written as the local press writes them; otherwise an empty string.
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

  // A language code is two letters; anything else is not one, and the reader
  // is not shown it as the name of their language.
  // A model that answers "Tamil" for "ta" has still said Tamil.
  const code = clip(result.language, 12).toLowerCase();
  const language = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/.test(code) ? code.slice(0, 2)
    : (Object.keys(LANGUAGE_NAMES).find(k => LANGUAGE_NAMES[k].toLowerCase() === code) || 'en');
  // Booleans are read as booleans: Boolean("false") is true.
  const romanized = asBool(result.romanized) === true && language !== 'en';
  const speechAct = oneOf(result.speech_act, SPEECH_ACTS, 'assertion');

  const claims = (Array.isArray(result.claims) ? result.claims : [])
    .filter(c => c && typeof c === 'object' && typeof c.claim === 'string' && c.claim.trim())
    .slice(0, 3)
    .map(c => {
      const claim = clip(c.claim, MAX_CLAIM_CHARS);
      const keywordsEn = clip(asWords(c.search_keywords_en), 120) || null;
      // The regional press of the place the claim is about, in its own
      // language: local stories rarely reach the national editions (see
      // agents/claimVerificationAgent.js, gatherCoverage).
      const regionLanguage = /^(?:ta|hi|te|kn|ml|mr|bn)$/.test(String(c.region_language || '')) ? c.region_language : null;
      const keywordsRegional = regionLanguage ? (clip(asWords(c.search_keywords_regional), 120) || null) : null;
      // Romanised Tamil keywords match nothing: the press writes Tamil in Tamil
      // script and English in English. Search in English for those.
      const native = clip(asWords(c.search_keywords), 120);
      const keywords = romanized || !native ? (keywordsEn || claim) : native;
      const kind = oneOf(c.kind, KINDS, 'event');
      const time = oneOf(c.time, TIMES, null);
      // A claim the model calls checkable must still name something: a model
      // can talk itself into "checkable" about "something big is coming".
      const anchors = findAnchors(claim);
      const firstWord = (claim.split(/\s+/)[0] || '').replace(/[^\p{L}\p{N}]/gu, '');
      // A general fact names its subject in lower case ("The sun rises in the
      // west"): the subject the model gives is the thing a reference work is
      // asked about. Measured: "Giraffe is a fish" was refused as naming
      // nothing, the worst answer to a plainly false statement.
      const named = (kind === 'standing_fact' && Boolean(clip(c.subject, 60)))
        || anchors.names.length + anchors.numbers.length + anchors.dates.length > 0
        || (/^\p{Lu}/u.test(firstWord) && firstWord.length > 2 && !/^(The|This|That|There|They|It|A|An|Some|Something|Everyone|People)$/.test(firstWord));
      return {
        claim,
        headline: clip(c.headline, 160) || null,
        subject: clip(c.subject, 60) || null,
        otherSubject: clip(c.other_subject, 60) || null,
        keywords,
        keywordsEn,
        regionLanguage: keywordsRegional ? regionLanguage : null,
        keywordsRegional,
        time: claimTime(time, claim, body, result.english, kind),
        kind,
        // The model's own "checkable" is advisory. It has marked a claim about
        // the 2026 Asian Games uncheckable because, from its training, 2026
        // had not happened yet. A named factual claim goes to the evidence; if
        // nothing bears on it the verdict says so, which is safe. Only
        // opinions and forecasts are held back.
        checkable: named && !['prediction', 'opinion'].includes(kind)
          && (asBool(c.checkable) === true || ['event', 'figure', 'quote', 'standing_fact'].includes(kind))
      };
    });

  // The title before a colon is checked even if the model left it out:
  // "Punjab Anti-Drug Activist Saved: Following the killing of ..." was read
  // as the true sentence after the colon alone, and came back REAL.
  const title = (body.match(/^\s*([^:\n]{8,90}):\s+\S/) || [])[1];
  if (title && claims.length < 3 && !addressesModel(body)) {
    const words = (t) => new Set(String(t).toLowerCase().match(/\p{L}{4,}/gu) || []);
    const own = [...words(title)];
    // Covered only when a claim keeps every word of it: "Activist Saved" read as
    // "activist was killed" keeps the name and drops the claim.
    const covered = claims.some(c => { const w = words(c.claim); return own.every(x => w.has(x)); });
    // Text addressed to a model is never a claim (utils/untrusted.js).
    const instructing = /(?:system|ignore|instructions?|assistant|prompt|override|developer)/i.test(title);
    const titleWords = title.trim().split(/\s+/).length;
    if (!covered && !instructing && titleWords >= 2 && titleWords <= 10 && findAnchors(title).names.length + (/^\p{Lu}/u.test(title.trim()) ? 1 : 0) > 0) {
      const base = claims[0] || {};
      claims.push({ ...base, claim: `${title.trim().replace(/[.!?]+$/, '')}.`, headline: title.trim(),
        keywords: base.keywords || title.trim(), keywordsEn: base.keywordsEn || title.trim(),
        time: base.time || 'past', kind: 'event', checkable: true, fromTitle: true });
    }
  }

  return {
    language,
    languageName: LANGUAGE_NAMES[language] || language,
    romanized,
    speechAct,
    tone: clipList(result.tone, 3, 20).map(t => t.toLowerCase()).filter(t => TONES.has(t)),
    english: clip(result.english, 2000) || body,
    claims,
    checkableClaims: claims.filter(c => c.checkable),
    notCheckableReason: clip(result.not_checkable_reason, 300)
  };
};

module.exports = { understandInput, LANGUAGE_NAMES, presentedAsNow, claimTime };
