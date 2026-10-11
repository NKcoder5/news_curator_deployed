// backend/agents/claimVerificationAgent.js
// Factor 4: Cross-source verification — extract the article's key checkable
// claims, search for coverage from OTHER outlets, and have the LLM judge
// whether that independent coverage supports or contradicts each claim.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchCoverageBroadening, searchGoogleNews } = require('../utils/newsFetcher');
const { getSourceReputation } = require('./sourceReputationAgent');
const { isSearchable } = require('../utils/language');
const { filterRelevant, anchorTerms, distinctiveTerms } = require('./evidenceRelevance');

/**
 * Search terms for a claim the model described but did not supply keywords for.
 *
 * Proper nouns and figures first, because those are what pin a claim to one
 * event; ordinary content words only when the claim carries no anchors, which
 * is the case where corroboration was never going to establish anything
 * anyway.
 */
const deriveKeywords = (claim) => {
  const anchors = [...anchorTerms(claim)];
  const terms = anchors.length >= 2 ? anchors : [...distinctiveTerms(claim)];
  return terms.slice(0, 4).join(' ');
};

/**
 * Step 1: extract up to `maxClaims` checkable factual claims plus search keywords.
 */
const extractClaims = async (title, content, maxClaims = 2, language = null) => {
  const isForeign = language && language.code && language.code !== 'en';

  // For a non-English article we ask for English keywords as well. An event
  // reported in Tamil is very often also reported in English, and searching
  // only in the original language would find nothing and conclude — wrongly —
  // that no other outlet covers the story. English search terms are what make
  // the corroboration check work across languages.
  // Described in words and formatted as bullets, matching the "claim" line.
  // The earlier version rendered these as indented `"key": "<placeholder>"`
  // lines outside the list, and under JSON mode the model read them as a
  // continuation of the claim description rather than as keys it had to
  // produce: it returned four well-formed claims and no keywords at all, and
  // every one was then discarded below. See the filter for what that cost.
  const keywordFields = isForeign
    ? `- "search_keywords": one string of exactly 3 or 4 of the most distinctive words IN ${language.name.toUpperCase()}, most important first.
- "search_keywords_en": one string of the same 3 or 4 distinctive terms in English, proper nouns transliterated.`
    : '- "search_keywords": one string of exactly 3 or 4 of the most distinctive words — names, places or events — most important first, no quotes or operators.';

  const prompt = `You are a fact-checking assistant. Extract the most important CHECKABLE factual claims from this news article — concrete statements about events, numbers, or actions that other news outlets would also report if true. Skip opinions and vague statements.

Title: ${title}
Content: ${(content || '').slice(0, 2000)}

Return a JSON object with one key, "claims": an array of at most ${maxClaims} entries, empty when the article contains nothing checkable. Each entry has:
- "claim": the factual claim in one sentence.
- "headline": the same claim written as a short English news headline, the way a newspaper reporting it would phrase it (for "UAE lost to Namibia" write "Namibia beat UAE").
- "subject": the specific person, organisation, event or thing the claim is about, in 1 to 4 English words a news search would use, specific enough that news found for it is about this subject ("Narendra Modi", "income tax India", "Asian Games India", "Virat Kohli", "RBI") — not a whole country on its own.
${keywordFields}
Do not split one statement into a trivial part and its real point: for "UAE lost to Namibia" give one claim about who won or lost, not a separate claim that the match took place.
Return at most ${maxClaims} claims. If the article contains no checkable claims, return an empty array.${isForeign ? `\nWrite "claim" in English so the verdict can be explained to the reader, but keep "search_keywords" in ${language.name}.` : ''}`;

  // Without requiredKeys, any valid JSON lacking a `claims` key silently
  // became an empty list — and an empty list here is read as a finding: the
  // article asserts nothing another outlet could check. The same article came
  // back REAL on one run and NOT A FACTUAL CLAIM on the next because of it.
  // Temperature 0: the same text must yield the same claims, or the verdict changes from run to run.
  // Text in another language goes to its own route. The local model rendered
  // the Tamil "தவெக" (TVK) as "DMK", and the claim it extracted — "the DMK won
  // in Dharapuram" — was then rightly contradicted by every outlet reporting
  // TVK's win: a true message called FAKE through a mistranslation.
  const label = isForeign ? 'claim extraction (non-English)' : 'claim extraction';
  const result = await callNimApiJson(prompt, { maxTokens: 800, temperature: 0, requiredKeys: ['claims'], allowArray: true, label });

  // Some models return the array directly rather than wrapping it. That is a
  // usable answer, not a malformed one.
  const claims = Array.isArray(result) ? result
    : Array.isArray(result.claims) ? result.claims
    : [];

  // A claim with no keywords is a claim we have to build search terms for, not
  // a claim that was never made.
  //
  // Measured on a live BBC report of five terrorism arrests: the model
  // returned four correct, checkable claims and omitted search_keywords from
  // all four. Requiring the keywords here discarded every one, the ledger saw
  // zero checkable claims, and the verdict engine called a hard news story
  // "NOT A FACTUAL CLAIM — argument or analysis, nothing here to verify".
  // Dropping a field we can reconstruct must never be reported as the article
  // asserting nothing; that is a failure wearing the costume of a finding.
  return claims
    .filter(c => c && c.claim)
    .slice(0, maxClaims)
    .map(c => {
      const given = String(c.search_keywords || '').trim();
      const keywords = given || deriveKeywords(c.claim);
      return {
        claim: String(c.claim),
        keywords,
        keywordsEn: c.search_keywords_en ? String(c.search_keywords_en) : null,
        headline: c.headline ? String(c.headline).slice(0, 160) : null,
        subject: c.subject ? String(c.subject).slice(0, 60) : null,
        keywordsDerived: !given
      };
    })
    .filter(c => c.keywords);
};

/**
 * Step 2: judge one claim against headlines/descriptions from other outlets.
 */
const norm = (text) => String(text || '').toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').trim();

/** How many headlines the stance judgement reads. */
const JUDGED_HEADLINES = 12;

// The kinds of quantity a claim states: "84 medals", "84-medal", "8 wickets",
// "5,000 crore". The unit word is what a headline must share to report the same
// quantity; the number is what decides whether it agrees.
const QUANTITY = /(\d[\d,.]*)\s*-?\s*(?:per\s*cent|percent|%|([\p{L}]{3,}))/giu;
const quantityUnits = (text) => {
  const units = new Set();
  for (const m of String(text || '').matchAll(QUANTITY)) {
    if (/^(?:19|20)\d{2}$/.test(m[1])) continue;   // a year, not a quantity
    const unit = (m[2] || 'percent').toLowerCase().replace(/s$/, '');
    units.add(unit);
  }
  return units;
};

/**
 * The figure the coverage reports for the claim's quantity when it differs from
 * the claim's own: for "India won 84 medals", the "85" in "India's 85-medal
 * campaign". The most frequent such figure is returned, with its unit.
 */
const competingFigure = (claim, articles) => {
  const own = new Map();   // unit -> the claim's number for it
  for (const m of String(claim || '').matchAll(QUANTITY)) {
    if (/^(?:19|20)\d{2}$/.test(m[1])) continue;
    own.set((m[2] || 'percent').toLowerCase().replace(/s$/, ''), m[1].replace(/,/g, ''));
  }
  if (!own.size) return null;
  const counts = new Map();
  for (const a of articles) {
    for (const m of String(a.title || '').matchAll(QUANTITY)) {
      const unit = (m[2] || 'percent').toLowerCase().replace(/s$/, '');
      const value = m[1].replace(/,/g, '').replace(/\.$/, '');
      if (!own.has(unit) || value === own.get(unit) || /^(?:19|20)\d{2}$/.test(value)) continue;
      const key = `${value}|${unit}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  // Frequency alone picked the wrong figure: four headlines about the Army's own
  // "20 medals" outnumbered the reports of India's 85. A figure close to the
  // claimed one is far likelier to be the same quantity, so closeness weighs in.
  const closeness = (value, unit) => {
    const mine = Number(own.get(unit)); const theirs = Number(value);
    if (!Number.isFinite(mine) || !Number.isFinite(theirs) || mine === 0) return 0;
    return 1 - Math.min(1, Math.abs(theirs - mine) / Math.abs(mine));
  };
  return [...counts.entries()]
    .map(([key, n]) => { const [value, unit] = key.split('|'); return { value, unit, weight: n * (1 + 2 * closeness(value, unit)) }; })
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 2)
    .map(({ value, unit }) => ({ value, unit: unit === 'percent' ? 'per cent' : `${unit}s`, raw: unit }));
};

/**
 * Order retrieved headlines by how useful they are for judging this claim.
 *
 * Results from five searches used to be interleaved, so each search had about
 * two of the places that get judged. For "India won 84 medals at the Asian
 * Games 2026" the headlines that settle it ("India's 85-medal campaign",
 * "India signs off with 85 medals") sat fourth and seventh in their lists and
 * were cut, and the claim came back CANNOT VERIFY instead of FAKE.
 *
 * Score: distinctive terms shared with the claim, plus a large bonus when the
 * headline states a quantity of the same kind as the claim does (any "N
 * medals" for a medal-count claim), because that is the headline that can
 * confirm or refute the figure. Ties keep the search order.
 */
const rankForClaim = (claim, articles) => {
  const claimTerms = distinctiveTerms(claim);
  const units = quantityUnits(claim);
  const claimValues = new Map();
  for (const m of String(claim || '').matchAll(QUANTITY)) {
    if (/^(?:19|20)\d{2}$/.test(m[1])) continue;
    claimValues.set((m[2] || 'percent').toLowerCase().replace(/s$/, ''), m[1].replace(/,/g, ''));
  }
  return articles
    .map((a, index) => {
      const text = `${a.title || ''} ${a.description || ''}`;
      const terms = distinctiveTerms(text);
      let score = [...claimTerms].filter(t => terms.has(t)).length;
      if (units.size) {
        const theirs = quantityUnits(text);
        if ([...units].some(u => theirs.has(u))) score += 4;
        // A figure near the claimed one is most likely the same quantity.
        const near = [...String(text).matchAll(QUANTITY)].some(m => {
          const unit = (m[2] || 'percent').toLowerCase().replace(/s$/, '');
          const v = Number(m[1].replace(/,/g, '').replace(/\.$/, ''));
          const c = Number(claimValues.get(unit));
          return Number.isFinite(v) && Number.isFinite(c) && c !== 0 && Math.abs(v - c) / Math.abs(c) <= 0.5;
        });
        if (near) score += 3;
      }
      return { a, index, score };
    })
    .sort((x, y) => y.score - x.score || x.index - y.index)
    .map(x => x.a);
};

const judgeClaim = async (claim, coverage) => {
  let reportedByItem = new Map();
  // Six items, not ten, and a tighter budget each. The failure this addresses
  // scaled with the amount there was to walk through: eight items at 300
  // characters invited the model to narrate its way through every one of them
  // and run out of reply budget before answering. Corroboration needs two
  // independent outlets, so six candidates is ample.
  const evidenceText = coverage
    .slice(0, JUDGED_HEADLINES)
    .map((a, i) => `[${i + 1}] ${a.source}: "${a.title}" — ${a.description}`.slice(0, 220))
    .join('\n');

  // Each headline is judged on its own. Asked for one overall verdict, the local
  // model matched on topic: "TVK lost the 2026 bye elections" was marked as
  // supported by headlines saying "TVK sweeps both seats", because both are
  // about TVK and the by-elections. Judging item by item, with the opposite-
  // outcome case spelled out, is what a small model gets right.
  const prompt = `You check a claim against news headlines from other outlets.

Claim: "${claim}"

Headlines:
${evidenceText}

For EACH headline decide its stance towards the claim:
- "agree": it reports the same outcome or fact as the claim.
- "disagree": it is about the SAME event and reports an outcome that cannot be true at the same time as the claim (for example the claim says a party lost and the headline says that party won; the claim says something happened and the headline says it did not).
- "unrelated": it is about a different event, place, person or party, or does not say enough to tell. A headline about some other state, candidate or result is "unrelated", not "disagree".
Read carefully: a headline about the same people or event is NOT automatically "agree". Compare what actually happened.

Before you mark "disagree", ask whether the claim and the headline could BOTH be true. "PM visited Chennai in May" and "Chief Minister met the PM in Delhi in May" can both be true, so that headline is "unrelated", not "disagree".

Numbers matter. If the claim gives a figure and a headline about the same event gives a different figure for the same thing, the two cannot both be true and the headline is "disagree": the claim says "India won 84 medals" and the headline says "India signs off with 85 medals". A part-way figure (medals won on one day, an early count) is not the same thing as a final total, so it is "unrelated". The same amount written in different units is the same figure, not a different one: Rs 5 crore is Rs 50 million, 1 lakh is 100,000, 2.5 billion is 2,500 million, a quarter percentage point is 25 basis points, 5.5% is 5.50%. Convert before comparing. A bound is not a figure: "crossed 80 medals", "more than 80", "over 80" or "nearly 90" agrees with a headline giving 85, because 85 satisfies it; "more than 100 medals" disagrees with 85. Time matters too: an earlier report that something is under way does not contradict a later one that it is done — "rescue operations under way" and "elephant rescued" are both true, hours apart — so the earlier one is "unrelated", not "disagree".

Return a JSON object with these keys:
- "items": an array with one object per headline: {"n": <headline number>, "same_event": true or false, "both_can_be_true": true or false, "stance": "agree" | "disagree" | "unrelated", "reported": "<the exact words in the headline that state the fact the claim is about, such as \"85 medals\" or \"TVK sweeps both seats\"; empty if the headline does not state it>"}.
- "explanation": one sentence saying what the headlines report compared with the claim.`;

  // A model that could not be reached, or whose reply could not be parsed,
  // has not judged this claim. The old code let that fall through to the
  // default verdict below - "unverified" - which the report then presented to
  // the reader as "no other outlet is reporting this", about coverage it was
  // holding in its hand at the time.
  let result;
  try {
    result = await callNimApiJson(prompt, {
      maxTokens: 1400,
      // A judgement must not change between two runs on the same headlines; at
      // the default temperature the same claim came back REAL once and FAKE once.
      temperature: 0,
      // The shape the caller cannot work without. Without this the gateway
      // accepted a bare `[1]` as a successful reply and the verdict below fell
      // through to undetermined, which the report showed the reader as
      // "we could not complete the search" on a story eight outlets carried.
      requiredKeys: ['items'],
      label: 'stance judgement'
    });
  } catch (err) {
    console.error('Claim judgement failed:', err.message);
    return { verdict: 'undetermined', failed: true, supportingEvidence: [], contradictingEvidence: [],
      discardedEvidence: [], explanation: 'This claim could not be judged against the coverage that was found.' };
  }

  // The verdict is derived from the per-item stances here, not asked for.
  if (Array.isArray(result?.items)) {
    const stance = (it) => String(it?.stance || '').toLowerCase();
    // A disagreement counts only about the same event, and only when the two
    // statements cannot both hold: the same guard the premise check uses.
    result.supporting_indices = result.items
      .filter(it => stance(it) === 'agree' && it.same_event !== false)
      .map(it => Number(it.n));
    // A contradiction has to be found in the headline itself: the words the
    // model quotes as what the outlet reports must actually be there. A quote
    // that is not in the headline is the model's own invention, not evidence.
    const inHeadline = (it) => {
      const quoted = norm(it.reported);
      if (!quoted) return true;
      const item = coverage[Number(it.n) - 1];
      return Boolean(item) && norm(item.title + ' ' + (item.description || '')).includes(quoted);
    };
    result.contradicting_indices = result.items
      .filter(it => stance(it) === 'disagree' && it.same_event === true && it.both_can_be_true === false && inHeadline(it))
      .map(it => Number(it.n));
    reportedByItem = new Map(result.items.map(it => [Number(it.n), String(it.reported || '').trim()]));
    result.verdict = result.contradicting_indices.length > result.supporting_indices.length
      ? 'contradicted'
      : result.supporting_indices.length > 0 ? 'supported'
        : result.contradicting_indices.length > 0 ? 'contradicted' : 'unverified';
  }

  // A recovered-but-truncated reply can arrive without the field at all. That
  // is not a judgement of "unverified" either.
  if (!['supported', 'contradicted', 'unverified'].includes(result?.verdict)) {
    // Logged, because this is the most common way verification fails and it
    // used to fail in silence: the only trace was the reader being told the
    // check had not run.
    console.error('Claim judgement unusable: verdict was', JSON.stringify(result?.verdict));
    return { verdict: 'undetermined', failed: true, supportingEvidence: [], contradictingEvidence: [],
      discardedEvidence: [], explanation: 'The judgement of this claim came back unreadable, so it was not counted.' };
  }

  const pick = (indices) =>
    (Array.isArray(indices) ? indices : [])
      .map(n => coverage[Number(n) - 1] && { ...coverage[Number(n) - 1], reported: reportedByItem.get(Number(n)) || '' })
      .filter(Boolean)
      // `description` travels with the evidence because wire syndication is
      // detected from the agency credit in the headline or standfirst — see
      // agents/independence.js. Dropping it here would make five reprints of one
      // Reuters story look like five independent confirmations.
      .map(a => ({
        source: a.source,
        title: a.title,
        description: a.description || '',
        url: a.url,
        publishedAt: a.publishedAt,
        reported: a.reported || '',
        reliability: getSourceReputation(a.source, a.url).score
      }));

  let verdict = result.verdict;

  // The model will cite coverage that is not about this claim at all. Measured
  // on the adversarial set, an invented "secret chemical leak" was reported as
  // supported by real articles concerning an unrelated evacuation — turning a
  // fabrication into "likely true". Evidence that shares no distinctive terms
  // with the claim is therefore discarded before it can count, and a verdict
  // left with no surviving evidence falls back to unverified.
  const support = filterRelevant(claim, pick(result.supporting_indices));
  const contradiction = filterRelevant(claim, pick(result.contradicting_indices));

  if (verdict === 'supported' && support.kept.length === 0) verdict = 'unverified';
  if (verdict === 'contradicted' && contradiction.kept.length === 0) {
    verdict = support.kept.length > 0 ? 'supported' : 'unverified';
  }

  const notes = [support.note, contradiction.note].filter(Boolean);

  return {
    verdict,
    supportingEvidence: support.kept,
    contradictingEvidence: contradiction.kept,
    discardedEvidence: [...support.dropped, ...contradiction.dropped],
    explanation: [String(result.explanation || ''), ...notes].filter(Boolean).join(' ')
  };
};

/**
 * Retrieve coverage of one claim, in the article's own language and in English.
 *
 * A story published in Tamil, Hindi or Malayalam is frequently also covered in
 * English, and an English-only search would miss the native coverage while a
 * native-only search would miss the English. Searching both and merging is what
 * lets the corroboration count work across a language boundary — and an outlet
 * reporting the same facts in a different language is genuinely independent
 * evidence, often more so than a same-language reprint.
 *
 * @returns {Promise<Array>} deduplicated coverage, each item tagged with the
 *          search language that found it
 */
const gatherCoverage = async ({ claim, headline, keywords, keywordsEn, sourceName, language }) => {
  const code = language?.code || 'en';
  const searches = [];

  if (isSearchable(code)) {
    searches.push({ query: keywords, lang: code });
  }
  // English is searched whenever the article is not English, using the
  // translated terms when the extractor supplied them.
  if (code !== 'en') {
    const englishQuery = keywordsEn || keywords;
    if (englishQuery) searches.push({ query: englishQuery, lang: 'en' });
  } else if (!searches.some(s => s.lang === 'en')) {
    // Only when the branch above did not already add it: English text used to
    // run the identical search twice.
    searches.push({ query: keywords, lang: 'en' });
  }

  // A search that could not run is recorded as such rather than as an empty
  // result. With two searches in flight, one failing while the other returns
  // coverage is still a usable answer; both failing is not an answer at all.
  const keywordBatches = searches.map(({ query, lang }) =>
    searchCoverageBroadening(query, sourceName, 8, 2, lang)
      .then(({ articles }) => ({ articles: articles.map(a => ({ ...a, foundIn: lang })) }))
      .catch(err => {
        console.error(`Coverage search (${lang}) could not run:`, err.message);
        return { articles: [], failed: true };
      }));

  // The claim itself is also searched, as a sentence. Keywords drop the words
  // that say what happened: "UAE lost to Namibia in CWC League 2" became "UAE
  // Namibia CWC League", whose top results were match previews, and the report
  // of the result ("Namibia cruise to eight-wicket win over UAE") never reached
  // the stance judgement. Google ranks by the whole sentence, outcome included.
  // Its results come first, since they are the most specific.
  // The claim is also searched as a headline. Outlets report a result as "Namibia
  // beat UAE" or "Namibia cruise to win over UAE", never as "UAE lost to
  // Namibia", so the extractor writes each claim the way a headline would and
  // that phrasing is searched alongside the claim sentence.
  const asQuery = (text) => String(text || '').replace(/[.!?"]+$/g, '').split(/\s+/).slice(0, 14).join(' ');
  // A claim with a figure in it is also searched without the figure. Searched
  // with "84", "India won 84 medals at the Asian Games" found nothing that gave
  // a total, and the eight outlets reporting 85 medals were never judged; the
  // claim came back CANNOT VERIFY instead of FAKE. Years are kept: they say
  // which event, not what is disputed.
  const withoutFigures = (text) => String(text || '')
    .replace(/(?:₹|rs\.?\s*)?(?<![\p{L}\p{N}])\d[\d,.]*(?:\s*(?:per\s*cent|percent|%|crore|lakh|million|billion))?/giu,
      m => (/^(?:19|20)\d{2}[.,]?$/.test(m.trim()) ? m : ' '))
    .replace(/(^|\s)-+/g, ' ').replace(/\s+/g, ' ').trim();
  const hasFigure = (text) => /\d/.test(String(text || '').replace(/(?<!\d)(?:19|20)\d{2}(?!\d)/g, ''));
  const phrasings = [...new Set([
    asQuery(headline),
    asQuery(claim),
    hasFigure(claim) ? asQuery(withoutFigures(claim)) : ''
  ].filter(Boolean))];
  const claimBatch = Promise.all(phrasings.map(q => searchGoogleNews(q, sourceName, 8, 'en')
    .then(articles => ({ articles }))
    .catch(() => ({ articles: [], failed: true }))))
    .then(found => ({
      lists: found.map(f => f.articles.map(a => ({ ...a, foundIn: 'en' }))),
      failed: found.length === 0 || found.every(f => f.failed)
    }));

  const [fromClaim, ...batches] = await Promise.all([claimBatch, ...keywordBatches]);

  const seen = new Set();
  const merged = [];
  // Interleaved: the first result of every search, then the second of every
  // search, and so on. Taking one search's results first let the headline
  // search ("TVK lose bypolls" found May's assembly-election stories) crowd the
  // keyword search's by-election results out of the headlines that are judged.
  const lists = [...fromClaim.lists, ...batches.map(b => b.articles)];
  const interleaved = [];
  for (let i = 0; lists.some(l => i < l.length); i++) {
    for (const l of lists) if (i < l.length) interleaved.push(l[i]);
  }
  const addAll = (articles) => {
    for (const article of articles) {
      const key = article.url || `${article.source}|${article.title}`;
      const titleKey = String(article.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (seen.has(key) || seen.has(titleKey)) continue;
      seen.add(key);
      seen.add(titleKey);
      merged.push(article);
    }
  };
  addAll(interleaved);

  // When the coverage states a different figure for the same quantity — the
  // claim says 84 medals, a headline says 85 — that figure is searched for
  // directly, so every outlet reporting it is found and judged, not only the
  // one the general search happened to return.
  const competing = competingFigure(claim, merged) || [];
  const probes = await Promise.all(competing.map(c =>
    searchGoogleNews(`${c.value} ${c.unit} ${withoutFigures(claim)}`.split(/\s+/).slice(0, 14).join(' '), sourceName, 8, 'en')
      .catch(() => [])));
  for (const found of probes) addAll(found.map(a => ({ ...a, foundIn: 'en' })));
  return {
    articles: rankForClaim(claim, merged).slice(0, JUDGED_HEADLINES),
    searchFailed: batches.every(b => b.failed) && (fromClaim.failed || fromClaim.lists.every(l => l.length === 0))
  };
};

/**
 * Aggregate per-claim verdicts into a factor score and a status.
 *
 * Baseline 5 (unknown). Each supported claim adds, weighted by how reliable
 * the corroborating outlets are; each contradicted claim subtracts. A claim
 * whose check never ran is counted apart from one that was checked and found
 * nothing, because the two mean opposite things to the reader.
 */
const summariseResults = (results) => {
  let score = 5;
  let supported = 0, contradicted = 0, unverified = 0, undetermined = 0;
  for (const r of results) {
    if (r.failed) {
      undetermined++;
    } else if (r.verdict === 'supported') {
      const bestReliability = Math.max(...(r.supportingEvidence || []).map(e => e.reliability), 5);
      score += 2.5 * (bestReliability / 10);
      supported++;
    } else if (r.verdict === 'contradicted') {
      score -= 3;
      contradicted++;
    } else {
      unverified++;
    }
  }
  score = Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;

  const status = contradicted > 0 ? 'contradicted'
    : supported > 0 ? 'corroborated'
    : 'unverified';

  const parts = [];
  if (supported) parts.push(`${supported} claim(s) corroborated by other outlets`);
  if (contradicted) parts.push(`${contradicted} claim(s) contradicted by other coverage`);
  if (unverified) parts.push(`${unverified} claim(s) could not be verified`);
  if (undetermined) parts.push(`${undetermined} claim(s) could not be checked at all`);

  return { score, status, partialFailure: undetermined > 0, explanation: parts.join('; ') + '.' };
};

/**
 * Full cross-source verification for an article.
 * @returns {Promise<{score: number, status: string, claims: Array, explanation: string}>}
 *          score 0-10: supported claims from reliable outlets push it up,
 *          contradicted claims push it down, no coverage stays neutral.
 */
const verifyClaims = async (title, content, sourceName, preExtractedClaims = null, extractionFailed = false, language = null) => {
  try {
    // An extraction that FAILED and an article with nothing worth checking both
    // arrive here as an empty list, and they mean opposite things: one is an
    // absence of knowledge, the other is a finding about the article. Conflating
    // them let a model outage reclassify every article as commentary, which
    // carries a much higher ceiling. The caller tells us which happened.
    if (extractionFailed) {
      return {
        score: 5,
        status: 'error',
        claims: [],
        explanation: 'The claims in this article could not be read, so nothing was checked against other outlets.',
        failed: true
      };
    }

    // The orchestrator extracts claims once and shares them, so we accept them
    // rather than extracting again.
    const claims = preExtractedClaims || await extractClaims(title, content, 2, language);
    if (claims.length === 0) {
      return {
        score: 5,
        status: 'no-claims',
        claims: [],
        explanation: 'No independently checkable claims were found in this article.'
      };
    }

    // Claims are independent of one another, so they are checked together
    // rather than one after the next. This loop used to run strictly in series
    // — search, wait, judge, wait, then the same again for the next claim —
    // which made verification the slowest factor in the pipeline at ~28s.
    // The model gateway still caps how many calls are actually in flight.
    const results = await Promise.all(claims.map(async ({ claim, headline, keywords, keywordsEn, time, kind }) => {
      const { articles: coverage, searchFailed } = await gatherCoverage({ claim, headline, keywords, keywordsEn, sourceName, language });
      // The time frame and kind the reader's message gave the claim, when it
      // was read by the understanding step: the verdict needs them to tell old
      // news passed off as new, and a standing fact, from an ordinary event.
      const framing = { time: time || null, kind: kind || null };
      if (searchFailed) {
        return {
          claim,
          ...framing,
          verdict: 'undetermined',
          failed: true,
          supportingEvidence: [],
          contradictingEvidence: [],
          explanation: 'Other outlets could not be searched for this claim.'
        };
      }
      if (coverage.length === 0) {
        return {
          claim,
          ...framing,
          verdict: 'no-coverage',
          supportingEvidence: [],
          contradictingEvidence: [],
          explanation: 'No coverage of this claim was found from other outlets.'
        };
      }
      const judgement = await judgeClaim(claim, coverage);
      return { claim, ...framing, ...judgement };
    }));

    // If not one claim could actually be checked, the article has not been
    // verified and has not failed verification - the check did not happen.
    // Saying anything else about other outlets here would be inventing a
    // finding out of an outage.
    if (results.every(r => r.failed)) {
      return {
        score: 5,
        status: 'error',
        claims: results,
        explanation: 'The check against other outlets could not be completed, so nothing was confirmed or denied.',
        failed: true
      };
    }

    return { claims: results, ...summariseResults(results) };
  } catch (err) {
    console.error('Claim verification failed:', err.message);
    return {
      score: 5,
      status: 'error',
      claims: [],
      explanation: 'Cross-source verification unavailable — treated as neutral.',
      failed: true
    };
  }
};

module.exports = {
  verifyClaims,
  extractClaims,
  // Exposed for the regression tests that cover what happens when the search
  // or the judgement cannot run. Not part of the pipeline's interface.
  __test: { judgeClaim, gatherCoverage, summariseResults, deriveKeywords }
};
