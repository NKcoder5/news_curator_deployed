// backend/agents/evidenceRelevance.js
//
// Is this retrieved article actually about the claim?
//
// The language model is asked a narrow question — does this coverage support or
// contradict the claim — and it answers willingly even when the coverage is
// about something else. A fabricated story about a "secret chemical leak" and an
// "overnight evacuation" retrieves real articles about some other evacuation
// somewhere else, and the model reports the claim as supported. The verdict then
// says "likely true" about an invented event, which is the most damaging error
// this system can make.
//
// The fix is not a better prompt. It is a check the model does not get to make:
// evidence only counts if it mentions what the claim is about. Distinctive terms
// — names, places, numbers, uncommon words — must be shared between the claim and
// the evidence's own headline. This is deterministic, costs nothing, and is
// applied after the model has spoken, so the model cannot argue with it.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'from', 'by', 'with', 'about', 'into', 'over', 'after', 'before', 'that',
  'this', 'these', 'those', 'it', 'its', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'has', 'have', 'had', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'said', 'says', 'say', 'told', 'according', 'new',
  'now', 'more', 'most', 'other', 'some', 'all', 'they', 'their', 'there',
  'which', 'who', 'what', 'when', 'where', 'how', 'than', 'then', 'also',
  'report', 'reports', 'reported', 'news', 'year', 'years', 'day', 'days',
  'week', 'weeks', 'month', 'months', 'people', 'government', 'officials'
]);

/**
 * Content words worth matching on. Numbers are kept — "312 patients" and
 * "40 crore" are among the most distinctive things a claim contains.
 */
// Spellings of the same thing that headlines use interchangeably. Without these
// "TVK lost the 2026 bye elections" shared nothing but "2026" with "TN
// bye-polls: TVK wins Dharapuram", and correct coverage was thrown away.
//
// A body named in full is also named by its initials, because headlines use
// the short form: "The Reserve Bank of India hiked the repo rate" shared no
// name with "RBI raises repo rate by 25 basis points" and five confirming
// outlets were thrown away. Each run of capitalised words gains its initials
// (Reserve Bank of India → RBI, Bharatiya Janata Party → BJP, Tamilaga Vettri
// Kazhagam → TVK), and a decimal loses its trailing zeros (5.50 → 5.5).
const LEADING_ARTICLE = /^(?:The|A|An)$/;
const withInitials = (text) => {
  const initials = [];
  const runs = text.match(/(?:\p{Lu}[\p{L}\p{M}]+)(?:\s+(?:of|and|for|the)?\s*\p{Lu}[\p{L}\p{M}]+)+/gu) || [];
  for (const run of runs) {
    const words = run.split(/\s+/).filter(w => /^\p{Lu}/u.test(w) && !LEADING_ARTICLE.test(w));
    if (words.length >= 2 && words.length <= 6) initials.push(words.map(w => w[0]).join(''));
  }
  return initials.length ? `${text} ${initials.join(' ')}` : text;
};

const normalise = (text) => withInitials(String(text || ''))
  .replace(/(\d+)\.(\d*?)0+(?!\d)/g, (m, whole, decimals) => (decimals ? `${whole}.${decimals}` : whole))
  .replace(/\b(?:bye|by)[\s-]?(?:elections?|polls?)\b|\bbyelections?\b|\bbypolls?\b/gi, 'bypoll')
  .replace(/\b(?:assembly|general|lok sabha)[\s-]?polls?\b/gi, 'election')
  .replace(/\btamil\s?nadu\b/gi, 'Tamilnadu');

// An all-capital token such as TVK, DMK, BJP or ISRO is a name even though it
// is short; ordinary short words are not distinctive.
const isAcronym = (word) => /^\p{Lu}{2,6}$/u.test(word);

// "elections" and "election", "wins" and "win" should match.
const stem = (term) => (term.length > 4 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term);

const distinctiveTerms = (text) => {
  const terms = normalise(text)
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    // Anything containing a digit is kept whatever its length: "312" is three
    // characters and is the single most identifying thing in "312 patients".
    .filter(term => term && (isAcronym(term) || (/\d/.test(term) ? term.length >= 2 : term.length > 3))
      && !STOPWORDS.has(term.toLowerCase()))
    .map(term => stem(term.toLowerCase()));
  return new Set(terms);
};

/** Minimum distinctive terms a piece of evidence must share with the claim. */
const MIN_SHARED_TERMS = 2;
const UNANCHORED_HIGH_OVERLAP = 0.75;
const UNANCHORED_MIN_SHARED = 3;

/**
 * The terms that pin a claim to a particular event: proper nouns and numbers.
 *
 * Counting ordinary content words is not enough. "A secret chemical leak forced
 * the overnight evacuation of three districts near Visakhapatnam" and "Wildfire
 * prompts evacuation orders in northern California" share *evacuation* and
 * *overnight*, which is two content words and no connection whatsoever. What
 * separates them is the anchor: one is about Visakhapatnam and the other is not.
 *
 * Capitalisation is read from the claim before it is lowercased; the first word
 * is skipped because every sentence begins with a capital.
 */
const anchorTerms = (text) => {
  const raw = normalise(text);
  const anchors = new Set();

  const words = raw.split(/\s+/);
  let opening = null;
  words.forEach((word, index) => {
    const clean = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
    if (!clean) return;
    if (/\d/.test(clean)) { anchors.add(clean.toLowerCase()); return; }
    // An acronym is a name wherever it stands, including first in the sentence.
    if (isAcronym(clean) && !STOPWORDS.has(clean.toLowerCase())) { anchors.add(stem(clean.toLowerCase())); return; }
    if (index === 0) {
      if (/^\p{Lu}/u.test(clean) && clean.length > 3 && !STOPWORDS.has(clean.toLowerCase())) opening = clean;
      return;
    }
    if (/^\p{Lu}/u.test(clean) && clean.length > 3 && !STOPWORDS.has(clean.toLowerCase())) {
      anchors.add(stem(clean.toLowerCase()));
    }
  });

  // A capitalised first word is usually just the start of the sentence, so it
  // is not taken as a name — unless the claim has no other. Measured:
  // "Coimbatore district police seized drugs, gutkha and weapons in a special
  // drive" was confirmed by The Hindu and the Times of India, and every
  // headline was then set aside because the claim "names no place".
  if (anchors.size === 0 && opening) anchors.add(stem(opening.toLowerCase()));

  return anchors;
};

/**
 * Does this evidence item plausibly concern the claim?
 *
 * @param {string} claim
 * @param {{title?: string, description?: string}} evidence
 * @returns {{relevant: boolean, shared: string[], sharedAnchors: string[], score: number}}
 */
const isRelevant = (claim, evidence) => {
  const claimTerms = distinctiveTerms(claim);
  const evidenceText = `${evidence?.title || ''} ${evidence?.description || ''}`;
  const evidenceTerms = distinctiveTerms(evidenceText);

  const shared = [...claimTerms].filter(term => evidenceTerms.has(term));
  const anchors = anchorTerms(claim);
  const sharedAnchors = [...anchors].filter(term => evidenceTerms.has(term));

  const score = claimTerms.size ? shared.length / claimTerms.size : 0;

  // A claim that names nothing cannot be corroborated by anything.
  //
  // Anchors are what tie a claim to one event: a place, a person, a body, a
  // number. Without one, a claim describes a KIND of event rather than an
  // event, and no retrieved article can confirm it — only something of the
  // same kind, somewhere.
  //
  // This branch used to accept a share of ordinary vocabulary instead, and the
  // adversarial set shows what that buys. "A secret chemical leak forced the
  // overnight evacuation of three districts" names no district and no town, and
  // it matched a real story about a chemical plant leak in Ohio on the words
  // chemical, leak, overnight and evacuation — a score of 0.5 and four shared
  // terms. The pipeline reported the invented leak as corroborated by multiple
  // independent sources, which is the worst error this system can make.
  //
  // Topic overlap is not event identity. Where identity cannot be established
  // the honest outcome is that the claim stays unverified, which is what the
  // system is built to say.
  if (anchors.size === 0) {
    // Some precise claims have no proper name, place, organisation or figure:
    // scientific findings are a common example. Permit only near-verbatim
    // coverage in that case. Ordinary topic overlap remains insufficient, so
    // the chemical-leak/evacuation false-corroboration case stays rejected.
    const highOverlap = shared.length >= UNANCHORED_MIN_SHARED
      && score >= UNANCHORED_HIGH_OVERLAP;
    return {
      relevant: highOverlap,
      shared,
      sharedAnchors,
      score: Math.round(score * 100) / 100,
      unanchored: !highOverlap
    };
  }

  // With anchors present, one of them must appear: the evidence has to be about
  // the same place, body, person or quantity.
  const relevant = sharedAnchors.length >= 1 && shared.length >= MIN_SHARED_TERMS;

  return { relevant, shared, sharedAnchors, score: Math.round(score * 100) / 100 };
};

/**
 * Drop evidence that is not about the claim, and report what was dropped.
 *
 * @returns {{kept: Array, dropped: Array, note: string|null}}
 */
const filterRelevant = (claim, evidenceItems = []) => {
  const kept = [];
  const dropped = [];

  let unanchored = false;

  for (const item of evidenceItems) {
    const verdict = isRelevant(claim, item);
    if (verdict.unanchored) unanchored = true;
    if (verdict.relevant) {
      kept.push({ ...item, sharedTerms: verdict.shared });
    } else {
      dropped.push({ source: item.source, title: item.title });
    }
  }

  const note = unanchored && dropped.length
    ? 'This claim names no person, place, organisation or figure, so no retrieved '
      + `article can be shown to be about it. ${dropped.length} `
      + `article${dropped.length > 1 ? 's were' : ' was'} set aside.`
    : dropped.length
      ? `${dropped.length} retrieved article${dropped.length > 1 ? 's were' : ' was'} discarded for not being about this claim.`
      : null;

  return { kept, dropped, unanchored, note };
};

module.exports = { isRelevant, filterRelevant, distinctiveTerms, anchorTerms, MIN_SHARED_TERMS };
