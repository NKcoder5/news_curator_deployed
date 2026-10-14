// backend/agents/factCheckSearch.js
//
// Has a professional fact-checker already ruled on this claim?
//
// The news search asks whether newsrooms report the same event. That catches a
// wrong figure or a reversed result, because the real figure and the real
// result are reported. It cannot catch a viral rumour that newsrooms simply
// ignore: "all Saturdays are now bank holidays" or "this video shows the Army
// chief dancing" is never reported as news, so the news channel finds nothing
// and the honest answer was "cannot verify".
//
// Those rumours are exactly what the fact-checking desks exist for. BOOM, Alt
// News, Factly, The Quint's WebQoof, India Today, AFP, PTI, Vishvas News and
// most other IFCN signatories publish each verdict with ClaimReview markup, and
// Google indexes it. This module searches that index, keeps only the reviews
// that examined the SAME assertion the user typed, and reports what they found.
//
// Two retrieval routes, because neither is complete on its own:
//
//   1. The ClaimReview index (Google Fact Check Explorer). Structured: the
//      claim that was checked, the outlet, the date and the rating.
//   2. Google News, asked for "<claim> fact check". Catches desks that publish
//      without the markup, PIB Fact Check among them, at the cost of having
//      only a headline to go on.
//
// A fact-check of a DIFFERENT claim on the same topic is the main hazard: ask
// about "Modi visited Tamil Nadu" and the index returns a debunked "Go back
// Modi" placard. So every candidate goes through one narrow model judgement —
// is this the same assertion, and what does the finding mean for the user's
// text — before it may count.
const axios = require('axios');
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchGoogleNews, cached, withRetry } = require('../utils/newsFetcher');
const { UNTRUSTED_NOTICE, fence, addressesModel, asBool, oneOf, clip, numberedItems } = require('../utils/untrusted');
const { signatureOf } = require('../services/claimSignature');

const FINDINGS = new Set(['false', 'true', 'misleading']);

const EXPLORER_URL = 'https://toolbox.google.com/factcheck/api/search';
const OFFICIAL_URL = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

/** Reviews shown to the matcher. More than this and it starts to skim. */
const MAX_CANDIDATES = 10;

// The index matches every word, so a full sentence usually returns nothing:
// "Government declared all Saturdays as bank holidays from November 2026"
// found no review, "Government declared Saturdays bank holidays" found The
// Quint's. Queries are cut to a few content words, and dates are dropped so a
// rumour that recirculates every year still meets its earlier debunk.
const QUERY_WORDS = 5;
const FILLER = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will', 'would', 'shall',
  'that', 'this', 'these', 'those', 'it', 'its', 'all', 'every', 'any', 'some', 'now', 'today',
  'new', 'news', 'says', 'said', 'claims', 'claim', 'viral', 'video', 'shows', 'photo', 'image',
  'officially', 'reportedly', 'just', 'also', 'very', 'after', 'before', 'during', 'into', 'over'
]);
const DATE_WORD = /^(?:(?:19|20)\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}(?:st|nd|rd|th)?)$/i;

const shortQuery = (text, words = QUERY_WORDS) => String(text || '')
  .replace(/[‘’“”"'`]/g, '')
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .split(/\s+/)
  .filter(w => w && !FILLER.has(w.toLowerCase()) && !DATE_WORD.test(w))
  .slice(0, words)
  .join(' ');

/**
 * The phrasings to look up, most specific first.
 *
 * The extracted search keywords are already the short form the index wants;
 * the headline and the claim are cut down to their first content words; and a
 * three-word form catches a review worded differently from the user's text.
 */
const queriesFor = (claims = [], title = '') => {
  const queries = [];
  const add = (q) => {
    const query = String(q || '').trim();
    if (query.split(/\s+/).length >= 2 && !queries.some(x => x.toLowerCase() === query.toLowerCase())) queries.push(query);
  };
  for (const c of claims.slice(0, 2)) {
    add(shortQuery(c.keywordsEn || c.keywords, 5));
    add(shortQuery(c.headline));
    add(shortQuery(c.claim));
    add(shortQuery(c.headline || c.claim, 3));
  }
  if (claims.length === 0) {
    add(shortQuery(title));
    add(shortQuery(title, 3));
  }
  return queries.slice(0, 6);
};

/** Parse the Explorer's reply: a JSON array behind an anti-hijacking prefix. */
const parseExplorer = (raw) => {
  let data;
  try {
    data = JSON.parse(String(raw).replace(/^\)\]\}'\s*/, ''));
  } catch (_) {
    return [];
  }
  const block = Array.isArray(data) && data.find(x => Array.isArray(x) && x[0] === 'claims_response');
  const out = [];
  for (const item of (block && block[1]) || []) {
    const entry = item && item[0];
    if (!Array.isArray(entry)) continue;
    for (const review of entry[3] || []) {
      if (!Array.isArray(review)) continue;
      out.push({
        claimReviewed: String(entry[0] || ''),
        claimant: (entry[1] || [])[0] || null,
        publisher: (review[0] && (review[0][0] || review[0][1])) || null,
        site: (review[0] && review[0][1]) || null,
        url: review[1] || null,
        reviewedAt: review[2] ? new Date(review[2] * 1000).toISOString().slice(0, 10) : null,
        rating: review[3] ? String(review[3]) : null,
        title: review[8] ? String(review[8]) : null,
        relevance: Number(item[2]) || 0,
        via: 'claimreview'
      });
    }
  }
  return out;
};

/**
 * Search the ClaimReview index.
 *
 * The official Fact Check Tools API is used when FACT_CHECK_API_KEY holds a key
 * with that API enabled. A Gemini key is NOT such a key — the API answers 401
 * "API keys are not supported by this API" — so by default the same index is
 * read through the Explorer's public endpoint, which needs no key at all.
 */
const searchClaimReviews = async (query, limit = 6) => {
  const key = process.env.FACT_CHECK_API_KEY;
  if (key) {
    try {
      const { data } = await cached(`factcheck-api|${query}`, () => withRetry(() => axios.get(OFFICIAL_URL, {
        params: { query, pageSize: limit, languageCode: 'en', key }, timeout: 8000
      })));
      return (data.claims || []).flatMap(c => (c.claimReview || []).map(r => ({
        claimReviewed: String(c.text || ''),
        claimant: c.claimant || null,
        publisher: r.publisher?.name || r.publisher?.site || null,
        site: r.publisher?.site || null,
        url: r.url || null,
        reviewedAt: r.reviewDate ? String(r.reviewDate).slice(0, 10) : null,
        rating: r.textualRating ? String(r.textualRating) : null,
        title: r.title || null,
        relevance: 1,
        via: 'claimreview'
      })));
    } catch (_) {
      // A wrong or restricted key falls back to the keyless route below rather
      // than switching the channel off.
    }
  }

  const raw = await cached(`factcheck-explorer|${query}`, () => withRetry(async () => {
    const response = await axios.get(EXPLORER_URL, {
      params: { hl: 'en', num_results: limit, force: 'false', offset: 0, query },
      responseType: 'text',
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    return String(response.data || '');
  }));
  return parseExplorer(raw);
};

// Desks whose articles are fact-checks by definition, as Google News names
// them. Anything else must say so in its headline.
const FACT_CHECK_DESKS = /\b(boom|alt ?news|factly|vishvas|newschecker|newsmeter|fact ?crescendo|newsmobile|dfrac|pib|press information bureau|logically|full ?fact|politifact|snopes|lead stories|factcheck\.org|youturn|south ?check|digiteye|telugupost|webqoof|afp fact|reuters fact)\b/i;
const FACT_CHECK_HEADLINE = /\bfact[\s-]*check|\bfake\b|\bfalse\b|\bmisleading\b|\bdebunk|\bmorphed\b|\bdoctored\b|\bdeepfake|\bai[\s-]generated\b|\bhoax\b|\bnot true\b|\bbaseless\b|\bold (?:video|photo|image)\b|\bedited (?:video|photo|image)\b|\bfalse claim\b/i;

/** Fact-check articles in Google News, for desks that publish no markup. */
const searchFactCheckHeadlines = async (query) => {
  const items = await searchGoogleNews(`${query} fact check`, '', 10, 'en');
  return items
    .filter(a => FACT_CHECK_HEADLINE.test(a.title) && (FACT_CHECK_DESKS.test(a.source) || /\bfact[\s-]*check/i.test(a.title)))
    .map(a => ({
      claimReviewed: '',
      claimant: null,
      publisher: a.source,
      site: a.sourceUrl ? a.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '') : null,
      url: a.url,
      reviewedAt: a.publishedAt ? a.publishedAt.slice(0, 10) : null,
      rating: null,
      title: a.title,
      relevance: 0,
      via: 'news-search'
    }));
};

/**
 * Collapse a desk's free-text rating into a class.
 *
 * Ratings are not standardised: "False", "FALSE", "Pants on Fire", "Four
 * Pinocchios", "This is incorrect, the new coronavirus is a virus and...",
 * "Misleading", "Missing context". The words below cover what the Indian desks
 * and the large international ones actually use; anything else is "unrated"
 * and left to the matcher to read.
 */
const ratingClass = (rating) => {
  const r = String(rating || '').toLowerCase();
  if (!r) return 'unrated';
  if (/\b(mostly false|partly false|partially false|half[\s-]true|mixture|mixed|missing context|lacks context|needs context|out of context|misleading|exaggerat|distort|cherry|misattribut|misrepresent|old (video|photo|image)|satire|spoof)/.test(r)) return 'misleading';
  if (/\b(false|fake|incorrect|wrong|fabricated|hoax|baseless|untrue|not true|no evidence|pants on fire|pinocchio|scam|doctored|morphed|edited|altered|deepfake|ai[\s-]generated|manipulated|debunk|bogus|rumou?r)/.test(r)) return 'false';
  if (/\b(true|correct|accurate|genuine|real|verified|authentic)\b/.test(r)) return 'true';
  return 'unrated';
};

/**
 * Ask one narrow question of every candidate review at once: did it examine
 * the same assertion the user typed, and what does its finding make of it?
 *
 * The finding is translated, not copied. A review rating "Army chief dancing
 * video is real" False makes the user's "Army chief dancing video is fake"
 * TRUE; the matcher states what the review means for the text in front of it.
 */
const matchReviews = async (claimText, candidates) => {
  const today = new Date().toISOString().slice(0, 10);
  // Every field is one line, so a line break inside a retrieved title cannot
  // open a review number of its own.
  const oneLine = (text, max) => String(text || '').replace(/\s+/g, ' ').slice(0, max);
  const lines = candidates.map((c, i) => [
    `${i + 1}. Fact-checker: ${oneLine(c.publisher, 80) || 'unknown'}${c.reviewedAt ? ` (${oneLine(c.reviewedAt, 10)})` : ''}`,
    c.claimReviewed ? `   Claim it checked: "${oneLine(c.claimReviewed, 300)}"` : null,
    c.rating ? `   Its rating: "${oneLine(c.rating, 200)}"` : null,
    c.title ? `   Its headline: "${oneLine(c.title, 200)}"` : null
  ].filter(Boolean).join('\n')).join('\n');

  const prompt = `Today is ${today}. A user wants to know whether this text is true:

${fence(claimText, { label: 'user text', max: 700 })}

${UNTRUSTED_NOTICE}

Professional fact-checkers have published the reviews below. For EACH review, decide whether it examined the SAME assertion as the user's text, and what its finding means for the user's text.

Rules:
- "same_claim" is true only when the review checks the same assertion: the same people or organisations, the same event or rumour, the same figure. Sharing a topic is NOT enough. A review of a "Go back Modi" placard is not about "Modi visited Tamil Nadu"; a review of a 2022 medal count is not about a 2026 medal count.
- The same rumour recirculating later is the same claim. A different occurrence of a similar event is not.
- "user_text_is" is what the review's finding makes of the USER'S text: "false" when the review shows the user's assertion is false or fabricated, "true" when it shows it is true, "misleading" when the review says it is misleading, out of context, or an old video or photo passed off as new, "unclear" when the review does not settle it. If the user's text says the opposite of the claim the review checked, reverse the finding: a review rating "the video is genuine" as False makes "the video is fake" true.
- Use only what is written below. Do not use your own knowledge of the facts.

Reviews:
${fence(lines, { label: 'reviews', max: MAX_CANDIDATES * 820 })}

Return a JSON object: {"items": [{"n": <review number>, "same_claim": true or false, "user_text_is": "false" | "true" | "misleading" | "unclear", "why": "<one short sentence>"}]}`;

  const result = await callNimApiJson(prompt, {
    maxTokens: 1400, temperature: 0, requiredKeys: ['items'], label: 'fact-check match'
  });
  // Only reviews that were shown, each judged once.
  return numberedItems(result?.items, candidates.length);
};

// Words that turn a statement about a video, photo or event into its denial:
// "the video is fake" says the opposite of "the video is genuine".
const FALSITY_WORDS = /\b(?:fake|false|falsely|wrongly|hoax|morphed|doctored|edited|deepfake|ai[\s-]generated|fabricated|untrue|misleading|old)\b/gi;

/** Which way a sentence points: false for a plain assertion, true for its denial. */
const deniesIt = (text) => {
  const falsity = (String(text || '').match(FALSITY_WORDS) || []).length;
  return ((signatureOf(text).negated ? 1 : 0) + falsity) % 2 === 1;
};

/**
 * May the matcher's finding stand against the desk's own rating?
 *
 * The prompt allows one reason for a finding that opposes the rating: the
 * user's text says the opposite of the claim the desk checked ("the video is
 * fake" against a review of "the video is genuine"). That reason is checked
 * here, not taken on trust. A reversal between two sentences that point the
 * same way is how a message that says "the fact-checks below confirm this"
 * would turn a desk's False into a reason to call a rumour true (rule R2c in
 * agents/verdictEngine.js needs only one such match), so it is not counted.
 */
const reversalHolds = (finding, rated, userText, reviewedText) => {
  const opposes = (rated === 'false' && finding === 'true') || (rated === 'true' && finding === 'false');
  if (!opposes || !reviewedText) return true;
  return deniesIt(userText) !== deniesIt(reviewedText);
};

/**
 * Look the claims up in the fact-checking record.
 *
 * @param {Array}  claims - extracted claims ({claim, headline, keywords, keywordsEn})
 * @param {Object} [context]
 * @param {string} [context.title] - used when no claim could be extracted
 * @param {string} [context.text]
 * @returns {Promise<{status: string, matches: Array, considered: number, explanation: string}>}
 *   status: 'debunked' | 'misleading' | 'confirmed' | 'none' | 'error'
 */
const checkFactCheckers = async (claims = [], { title = '', text = '' } = {}) => {
  const queries = queriesFor(claims, title);
  if (queries.length === 0) {
    return { status: 'none', matches: [], considered: 0, queries, explanation: 'There was nothing specific enough to look up.' };
  }

  const [reviewBatches, headlineBatch] = await Promise.all([
    Promise.allSettled(queries.map(q => searchClaimReviews(q))),
    searchFactCheckHeadlines(queries[0]).catch(() => [])
  ]);
  const reviewSearchFailed = reviewBatches.every(r => r.status === 'rejected');

  // Pool the reviews, keeping each query's best-ranked first so that one broad
  // query cannot crowd out the precise one.
  const pooled = [];
  const seen = new Set();
  const take = (item) => {
    const key = item.url || `${item.publisher}|${item.claimReviewed}`;
    if (!key || seen.has(key)) return;
    // A review whose text tells the matcher what to answer is not a review.
    if (addressesModel(`${item.claimReviewed} ${item.title || ''} ${item.rating || ''}`)) return;
    seen.add(key);
    pooled.push(item);
  };
  const lists = reviewBatches.map(r => (r.status === 'fulfilled' ? r.value : []));
  for (let i = 0; i < 6; i++) for (const list of lists) if (list[i]) take(list[i]);
  for (const item of headlineBatch.slice(0, 3)) take(item);

  const candidates = pooled.slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) {
    return {
      status: reviewSearchFailed ? 'error' : 'none', matches: [], considered: 0, queries,
      explanation: reviewSearchFailed
        ? 'The fact-check search could not run just now.'
        : 'No fact-checking desk has published a review of this claim.'
    };
  }

  const claimText = claims.length
    ? claims.slice(0, 2).map(c => c.claim).join(' ')
    : `${title}${text && text !== title ? `. ${String(text).slice(0, 400)}` : ''}`;

  let judged;
  try {
    judged = await matchReviews(claimText, candidates);
  } catch (_) {
    return { status: 'error', matches: [], considered: candidates.length, queries, explanation: 'The fact-check reviews could not be compared with this claim.' };
  }

  const matches = [];
  for (const item of judged) {
    const candidate = candidates[item.n - 1];
    if (!candidate || asBool(item.same_claim) !== true) continue;
    const finding = oneOf(item.user_text_is, FINDINGS, null);
    if (!finding) continue;
    // The desk's own rating is kept beside the matcher's reading of it, so the
    // reader can see both: they differ, legitimately, when the user's text
    // negates the claim the desk checked.
    const rated = ratingClass(candidate.rating);
    if (!reversalHolds(finding, rated, claimText, candidate.claimReviewed || candidate.title)) {
      console.warn(`Fact-check match: a "${finding}" reading of a review rated ${rated} was set aside; the two sentences do not point opposite ways.`);
      continue;
    }
    matches.push({
      publisher: candidate.publisher,
      site: candidate.site,
      url: candidate.url,
      reviewedAt: candidate.reviewedAt,
      claimReviewed: candidate.claimReviewed || candidate.title,
      rating: candidate.rating,
      ratingClass: rated,
      finding,
      why: clip(item.why, 240),
      via: candidate.via
    });
  }

  // One desk, one voice: AFP's English and Hindi reviews of the same video are
  // one fact-check, not two.
  const byDesk = new Map();
  for (const m of matches) {
    const desk = String(m.publisher || m.site || m.url).toLowerCase().replace(/\s*fact\s*check$/, '').trim();
    if (!byDesk.has(desk)) byDesk.set(desk, m);
  }
  const distinct = [...byDesk.values()];

  const against = distinct.filter(m => m.finding === 'false');
  const misleading = distinct.filter(m => m.finding === 'misleading');
  const supporting = distinct.filter(m => m.finding === 'true');

  // The desks disagreeing among themselves is reported as it is, not resolved
  // by vote: that is a claim the reader should look at, not one we settle.
  let status = 'none';
  if (against.length > 0 && supporting.length === 0) status = 'debunked';
  else if (misleading.length > 0 && supporting.length === 0) status = 'misleading';
  else if (supporting.length > 0 && against.length === 0 && misleading.length === 0) status = 'confirmed';
  else if (distinct.length > 0) status = 'disputed';

  const names = (list) => list.map(m => m.publisher).filter(Boolean).slice(0, 4).join(', ');
  const explanation = {
    debunked: `Rated false by ${against.length} fact-checking ${against.length === 1 ? 'desk' : 'desks'}: ${names(against)}.`,
    misleading: `Rated misleading by ${names(misleading)}.`,
    confirmed: `Rated true by ${names(supporting)}.`,
    disputed: 'Fact-checking desks reached different conclusions on this claim.',
    none: `${candidates.length} published ${candidates.length === 1 ? 'review was' : 'reviews were'} found, but none examined this exact claim.`
  }[status];

  return {
    status,
    matches: [...against, ...misleading, ...supporting],
    considered: candidates.length,
    queries,
    explanation
  };
};

module.exports = { checkFactCheckers, ratingClass, parseExplorer, queriesFor, shortQuery, reversalHolds };
