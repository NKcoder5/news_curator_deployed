// backend/agents/checkability.js
//
// Is there anything here we could actually check?
//
// Once people can paste whatever they found — a WhatsApp forward, an Instagram
// caption, a line someone said in a video — most of what arrives is not a
// factual claim at all. "They are hiding the truth from you, wake up" asserts
// nothing that any newsroom could confirm or deny. Running the pipeline on it
// produces a verdict, and that verdict is meaningless.
//
// So the gate comes first. A system that answers every question, including the
// ones it cannot answer, teaches people to distrust the answers it gets right.
// If the input will not support a verdict, we say so and say what is missing,
// instead of manufacturing one.
//
// A claim is checkable when it makes an assertion about the world that is
// specific enough to look up. In practice that means it needs an ANCHOR — a
// name, a place, a number, a date. Without one there is nothing to search for,
// and no amount of analysis invents it.
//
// Deterministic, no model call, and it runs before anything expensive.

const MIN_CHARACTERS = 40;
const MIN_WORDS = 8;
// A one-line claim typed by a reader ("tvk lost 2026 bye elections") is the
// most common input of all. It is short, but it is still a claim: it is let
// through when it has at least this much and something specific in it.
const MIN_SHORT_CHARACTERS = 15;
const MIN_SHORT_WORDS = 4;

/** Words that carry no searchable specificity. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'from', 'by', 'with', 'this', 'that', 'these', 'those', 'it', 'its', 'is',
  'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will', 'would',
  'they', 'them', 'their', 'there', 'you', 'your', 'we', 'our', 'he', 'she',
  'his', 'her', 'who', 'what', 'when', 'where', 'why', 'how', 'all', 'some',
  'more', 'most', 'very', 'just', 'now', 'then', 'than', 'so', 'if', 'not'
]);

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

// Statements about the speaker's own feelings or preferences. These are not
// false — they are simply not the kind of thing another outlet can confirm.
const OPINION_MARKERS = /\b(i think|i believe|i feel|in my opinion|should|ought to|must be|disgusting|beautiful|terrible|wonderful|best|worst|amazing|pathetic|hate|love)\b/i;

// Pure exhortation. Characteristic of forwarded messages, and asserts nothing.
// Words that open a sentence without naming anyone. A one-sentence claim's
// first word is otherwise counted when capitalised (see below), so these are
// the openers that must not be.
const SENTENCE_OPENERS = new Set([
  'wake', 'share', 'please', 'forward', 'breaking', 'urgent', 'attention', 'alert', 'beware',
  'note', 'read', 'watch', 'look', 'listen', 'everyone', 'friends', 'dear', 'today', 'tomorrow',
  'yesterday', 'now', 'just', 'people', 'someone', 'everybody', 'nobody', 'they', 'we', 'you',
  'he', 'she', 'there', 'here', 'why', 'how', 'what', 'when', 'where', 'who', 'did', 'does',
  'will', 'can', 'could', 'should', 'would', 'must', 'many', 'some', 'every', 'all', 'no', 'big',
  'shocking', 'viral', 'new', 'latest', 'finally', 'officially', 'reportedly'
]);

const EXHORTATION = /\b(share this|forward this|wake up|spread the word|do not let them|before (it is|it's) too late|tell everyone|pass it on)\b/i;

/**
 * The specific things a claim is about: proper nouns, numbers and dates.
 * These are what a search can be built from; everything else is connective
 * tissue.
 */
const findAnchors = (text) => {
  const raw = String(text || '');
  const names = new Set();
  const numbers = new Set();

  raw.split(/(?<=[.!?])\s+/).forEach(sentence => {
    sentence.trim().split(/\s+/).forEach((word, index) => {
      const clean = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
      if (!clean) return;
      if (/\d/.test(clean)) { numbers.add(clean.toLowerCase()); return; }
      // The first word of a sentence is capitalised by grammar, not by being a
      // name, so sentence openers and common stopwords are skipped. Genuine proper
      // nouns ("India", "Modi", "Vijay") are kept.
      const lower = clean.toLowerCase();
      if (index === 0 && (SENTENCE_OPENERS.has(lower) || STOPWORDS.has(lower))) return;
      if (/^\p{Lu}/u.test(clean) && clean.length > 2 && !STOPWORDS.has(lower)) {
        names.add(clean);
      }
    });
  });

  const dates = MONTHS.test(raw) ? [raw.match(MONTHS)[0]] : [];
  return { names: [...names], numbers: [...numbers], dates };
};

/**
 * Decide whether a piece of user-supplied content can be fact-checked at all.
 *
 * @param {string} text - what the user pasted
 * @param {string} [title] - a headline, when there is one
 * @returns {{checkable: boolean, kind: string, reason: string|null,
 *            missing: string[], anchors: Object, anchorCount: number}}
 */
const assessCheckability = (text, title = '') => {
  // A headline is a sentence of its own, and joining it to the body with a
  // bare space makes the body's first word mid-sentence — so its grammatical
  // capital gets read as a proper noun by findAnchors below.
  //
  // Measured: the forwarded message "Wake up. They are hiding the truth from
  // you. Wake up before it is too late…" ingests with the title "Wake up",
  // which joined to "Wake up before…" put the second "Wake" at index 1 of the
  // first sentence. That single phantom anchor was enough to carry pure
  // exhortation past this gate and into a CANNOT VERIFY verdict — a verdict on
  // content that asserts nothing, which is what this gate exists to prevent.
  const head = String(title || '').trim();
  const body = String(text || '').trim();
  // Pasted text and screenshots have no headline of their own: the ingester
  // uses the first line of the body, stripped of its closing "?" or "!". Adding
  // it again in front turned "Is the government planning…?" into a statement
  // followed by a question, and the question check below stopped recognising
  // it. A headline the body already opens with adds nothing, so it is left out.
  const repeatsBody = head && body.toLowerCase().startsWith(head.toLowerCase());
  const combined = head && !repeatsBody
    ? `${/[.!?]$/.test(head) ? head : `${head}.`} ${body}`.trim()
    : body;
  const words = combined.split(/\s+/).filter(Boolean);
  const anchors = findAnchors(combined);
  const short = words.length < MIN_WORDS;
  if (short) {
    // In a one-line claim the first word is often the name ("Modi visited
    // Chennai"), and readers often type in lower case ("tvk", "modi"). Both
    // are counted here; the claim extractor reads the text properly after.
    const lowerCase = combined === combined.toLowerCase();
    words.forEach((word, index) => {
      const clean = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
      if (!clean || /\d/.test(clean) || clean.length < 3 || STOPWORDS.has(clean.toLowerCase())) return;
      // "share this before they delete it": an opener is not a name, in any case.
      if (index === 0 && SENTENCE_OPENERS.has(clean.toLowerCase())) return;
      if ((index === 0 && /^\p{Lu}/u.test(clean)) || /^\p{Lu}{2,}$/u.test(clean) || (lowerCase && index === 0)) {
        if (!anchors.names.includes(clean)) anchors.names.push(clean);
      }
    });
  }
  // A typed one-line claim very often opens with its subject: "India has
  // banned cricket nationwide from this week" was refused as naming no one,
  // because a sentence's first word is skipped above. In a single sentence
  // the first word is counted after all, unless it is a word that opens
  // sentences without naming anything. A forwarded message of several
  // sentences keeps the strict rule — "Wake up. They are hiding…" is what
  // that rule exists for.
  const sentences = combined.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!short && sentences.length === 1) {
    const first = (words[0] || '').replace(/[^\p{L}\p{N}\p{M}]/gu, '');
    if (/^\p{Lu}/u.test(first) && first.length > 2 && !/\d/.test(first)
      && !STOPWORDS.has(first.toLowerCase()) && !SENTENCE_OPENERS.has(first.toLowerCase())
      && !anchors.names.includes(first)) {
      anchors.names.push(first);
    }
  }
  const anchorCount = anchors.names.length + anchors.numbers.length + anchors.dates.length;

  const result = (kind, reason, missing = []) => ({
    checkable: kind === 'claim',
    kind,
    reason,
    missing,
    anchors,
    anchorCount
  });

  const tooShort = short
    ? (combined.length < MIN_SHORT_CHARACTERS || words.length < MIN_SHORT_WORDS)
    : combined.length < MIN_CHARACTERS;
  if (tooShort) {
    return result('too-short',
      'There is not enough here to check. Write the claim as a short sentence, saying who did what, for example "TVK lost the 2026 Dharapuram by-election".',
      ['the full text']);
  }

  // A question asks rather than asserts. There is no claim to verify.
  const withoutQuestions = combined.replace(/[^.!?]*\?/g, '').trim();
  const statementWords = withoutQuestions.split(/\s+/).filter(Boolean).length;
  if (/\?/.test(combined) && statementWords < Math.min(MIN_WORDS, words.length)) {
    return result('question',
      'This asks a question rather than stating something. Paste the claim you want checked, not the question about it.',
      ['a statement of what is claimed']);
  }

  if (anchorCount === 0) {
    const missing = [];
    if (anchors.names.length === 0) missing.push('who or where it happened');
    if (anchors.numbers.length === 0 && anchors.dates.length === 0) missing.push('when it happened, or a figure');

    if (EXHORTATION.test(combined)) {
      return result('unfalsifiable',
        'This tells the reader what to do but does not say what actually happened. There is no specific claim here for another outlet to confirm or deny.',
        missing);
    }
    if (OPINION_MARKERS.test(combined)) {
      return result('opinion',
        'This reads as someone’s opinion rather than a factual claim. Opinions are not true or false in a way anyone can check.',
        missing);
    }
    return result('too-vague',
      'This does not name anyone, anywhere or any figure, so there is nothing specific to look up. Add the names, places or numbers involved.',
      missing);
  }

  // It has something specific to say, but says it only about feelings.
  if (OPINION_MARKERS.test(combined) && anchorCount < 2 && !MONTHS.test(combined)) {
    return result('opinion',
      'This is mostly an opinion. We can only check statements about what happened.',
      ['a factual claim about what happened']);
  }

  return result('claim', null, []);
};

module.exports = { assessCheckability, findAnchors, MIN_CHARACTERS, MIN_WORDS, STOPWORDS, SENTENCE_OPENERS };
