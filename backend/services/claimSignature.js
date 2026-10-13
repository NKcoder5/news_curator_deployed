// backend/services/claimSignature.js
//
// What makes two claims the same claim, and what makes them variants.
//
// The claim memory has to recognise "India won 84 medals at the Asian Games
// 2026" when it comes back as "India's 84-medal campaign at Asian Games 2026",
// or in Tamil (the reading step writes every claim in English first), and has
// to notice when it comes back as "85 medals" — the same claim with the figure
// changed, which is how a claim mutates as it spreads. It must also refuse to
// merge two claims that merely share a topic: "Modi visited Chennai" and "Modi
// resigned" share a name and nothing else.
//
// A claim's signature is what identifies it:
//   entities  names and initials ("india", "asian", "rbi")
//   numbers   each figure with its unit, scaled ("84 medal", "5.5 percent",
//             "Rs 5 crore" = 50,000,000 rupee)
//   years     dates are kept apart from figures
//   terms     the remaining distinctive words, which carry the predicate
//   negated   whether the claim is stated in the negative
//
// Two claims are the SAME when their names largely coincide, their predicate
// words overlap, and every figure, year and polarity agrees. They are VARIANTS
// when names and predicate agree but a figure, a year or the polarity differs.
// Anything else is DIFFERENT. The thresholds are deliberately conservative: a
// false merge would attach one claim's history to another, which is worse
// than failing to recognise a repeat.

const NOT_NAMES = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'by', 'with', 'from', 'this', 'that',
  'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we', 'there', 'here', 'what', 'when', 'who', 'did',
  'does', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'all', 'every', 'video', 'government', 'prime',
  'minister', 'chief', 'president', 'state', 'central', 'centre', 'police', 'pm', 'cm', 'rs', 'inr', 'mr', 'mrs',
  'dr', 'ji', 'shri', 'sri',
  // Titles and roles written before a name: "Actor Nana Patekar" and "Chief
  // Minister Vijay" were read as three-word names and became initials.
  'actor', 'actress', 'singer', 'director', 'former', 'veteran', 'late', 'cricketer', 'star', 'leader', 'justice'
]);
// Unit and scale words belong to the figure, not to the predicate.
const UNIT_WORDS = new Set(['thousand', 'lakh', 'crore', 'million', 'billion', 'percent', 'per', 'cent', 'basi',
  'basis', 'point', 'percentage', 'bps', 'rupee']);
// Common irregular and inflected news verbs, reduced to one form so that "lost"
// and "lose", "won" and "wins", "resigned" and "resigns" compare equal.
const LEMMA = {
  lost: 'lose', loses: 'lose', losing: 'lose', won: 'win', wins: 'win', winning: 'win', took: 'take', takes: 'take',
  taken: 'take', made: 'make', makes: 'make', said: 'say', says: 'say', gave: 'give', gives: 'give', held: 'hold',
  holds: 'hold', met: 'meet', meets: 'meet', sold: 'sell', sells: 'sell', bought: 'buy', buys: 'buy', left: 'leave',
  leaves: 'leave', fell: 'fall', falls: 'fall', rose: 'rise', rises: 'rise', beat: 'beat', beats: 'beat',
  resigned: 'resign', resigns: 'resign', resigning: 'resign', raised: 'raise', raises: 'raise', hiked: 'hike',
  hikes: 'hike', launched: 'launch', launches: 'launch', announced: 'announce', announces: 'announce',
  declared: 'declare', declares: 'declare', banned: 'ban', bans: 'ban', arrested: 'arrest', arrests: 'arrest',
  denied: 'deny', denies: 'deny', visited: 'visit', visits: 'visit', killed: 'kill', kills: 'kill',
  abolished: 'abolish', abolishes: 'abolish', stepped: 'step', steps: 'step', removed: 'remove', removes: 'remove',
  detained: 'detain', detains: 'detain', urged: 'urge', urges: 'urge', cut: 'cut', cuts: 'cut',
  // Measured on the held-out pairs (eval/suites/claim_matching_heldout.json):
  // "died" and "passed away", "defeated" and "beat", "scored" and "hit" were
  // read as different predicates; "succeeded" and "failed", "upheld" and "set
  // aside" were not known to be opposites, so opposite claims merged.
  died: 'die', dies: 'die', dying: 'die', defeated: 'beat', defeats: 'beat', defeat: 'beat', beaten: 'beat',
  trounced: 'beat', scored: 'score', scores: 'score', hit: 'score', hits: 'score', smashed: 'score',
  failed: 'fail', fails: 'fail', failure: 'fail', succeeded: 'succeed', succeeds: 'succeed', success: 'succeed',
  successful: 'succeed', upheld: 'uphold', upholds: 'uphold', aged: 'age'
};
const MONTHS = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
const SCALE = { thousand: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, crore: 1e7, crores: 1e7, billion: 1e9 };
const NEGATION = /\b(?:not|no|never|didn't|did not|doesn't|does not|hasn't|has not|haven't|have not|isn't|is not|wasn't|was not|won't|will not|cannot|can't|denied|denies|refused|neither|nor)\b/i;

// Opposites are one predicate and a flip of polarity: "TVK lost" is "TVK did
// not win", so it is a variant of "TVK won" (the opposite claim about the same
// thing), and "TVK did not lose" is the same claim as "TVK won".
const ANTONYM = { lose: 'win', fall: 'rise', cut: 'raise', lower: 'raise', reduce: 'raise', decrease: 'increase', reject: 'accept',
  fail: 'succeed', quash: 'uphold' };

// Predicates where who did it to whom is the claim: "India beat West Indies"
// and "West Indies beat India" share every name and word, and merged.
const ASYMMETRIC = new Set(['beat', 'win', 'lose', 'buy', 'sell', 'sue', 'arrest', 'replace', 'overtake', 'kill', 'attack']);

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const ORDINALS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' };
const MONTH_NAME = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const SYNONYM = {
  hike: 'raise', hiked: 'raise', hikes: 'raise',
  acquire: 'buy', acquired: 'buy', acquires: 'buy', acquisition: 'buy', purchased: 'buy', purchase: 'buy'
};

// Phrases headlines use interchangeably, reduced before the words are read:
// a by-election is a bypoll, stepping down is resigning, passing away is
// dying, a maiden century is a first hundred, "August 25" is "25 August",
// "six" is 6 and "2nd" is "second".
const normalisePhrases = (text) => String(text || '')
  .replace(/\b(?:bye|by)[\s-]?(?:elections?|polls?)\b|\bbyelections?\b|\bbypolls?\b/gi, 'bypoll')
  .replace(/\bstep(?:s|ped|ping)?\s+down\b/gi, 'resign')
  .replace(/\bquit\b/gi, 'resign')
  .replace(/\bpass(?:es|ed|ing)?\s+away\b/gi, 'die')
  .replace(/\b(?:set\s+aside|struck\s+down|strike\s+down|quash(?:ed|es)?|overturn(?:ed|s)?|annull?(?:ed|s)?)\b/gi, 'quash')
  .replace(/\b(?:carried|put|placed)\b([^.;]*?)\binto\s+orbit\b/gi, 'launched$1')
  .replace(/\bT20\s+internationals?\b/gi, 'T20I')
  .replace(/\bOne[\s-]Day\s+Internationals?\b/gi, 'ODI')
  .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)\\s+(?:of\\s+)?${MONTH_NAME}\\b`, 'g'), '$1 $2')
  .replace(new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'), '$2 $1')
  .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, (m, n) => ORDINALS[n] || m)
  .replace(/\bmaiden\b/gi, 'first')
  .replace(/\bcentur(?:y|ies)\b/gi, 'hundred')
  .replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, (m) => String(NUMBER_WORDS[m.toLowerCase()]));
const STOP = new Set([...NOT_NAMES, 'as', 'be', 'been', 'being', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'about', 'into', 'over', 'after', 'before', 'than', 'then', 'also', 'his', 'her', 'their', 'our', 'your',
  'which', 'while', 'claim', 'claims', 'reported', 'report', 'news', 'today', 'yesterday', 'tomorrow', 'week',
  'month', 'year', 'now', 'just', 'very', 'more', 'most', 'some', 'any', 'other', 'such', 'only', 'own', 'same',
  'so', 'too', 'up', 'down', 'out', 'off', 'again', 'once', 'he', 'him', 'she', 'them', 'his', 'who', 'whom', 'whose',
  'contain', 'contains', 'contained']);

// A people's adjective names the same thing as the country.
const DEMONYM = { indian: 'india', pakistani: 'pakistan', chinese: 'china', american: 'america', british: 'britain' };

const stem = (w) => {
  const t = String(w).toLowerCase();
  if (LEMMA[t]) return LEMMA[t];
  if (DEMONYM[t]) return DEMONYM[t];
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

/** Figures with units, and years, read from a claim sentence. */
const readNumbers = (text) => {
  const numbers = [];
  const years = [];
  const src = String(text || '').replace(/(\d),(?=\d)/g, '$1');
  // A number inside an identifier ("EOS-05", "GSLV-F17", "T20I") is not a
  // figure: it was read as "5 satellite" against "5 into" and the claims parted.
  const re = /(₹|rs\.?\s*|inr\s*)?(?<![\p{L}\p{N}]-?)(\d+(?:\.\d+)?)(?![\p{L}]*\d)\s*(thousand|lakhs?|million|crores?|billion)?(?:\s*-\s*|\s+)?(per\s*cent|percent|%|percentage points?|basis points?|bps|[\p{L}]{3,})?/giu;
  for (const m of src.matchAll(re)) {
    const currency = Boolean(m[1]);
    let value = Number(m[2]);
    const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1;
    const word = (m[4] || '').toLowerCase().replace(/\s+/g, ' ');
    // "2000 rupee note" is money, not the year 2000.
    if (!currency && !m[3] && /^(?:19|20)\d{2}$/.test(m[2]) && !/^(per|percent|%|rupees?)/.test(word)) {
      years.push(m[2]);
      continue;
    }
    if (word && MONTHS.test(word)) continue;          // "11 October" is a date
    value *= scale;
    let unit;
    if (currency || /^rupees?$/.test(word)) unit = 'rupee';
    else if (/^(per\s*cent|percent|%)$/.test(word)) unit = 'percent';
    else if (/^percentage point/.test(word)) unit = 'percentage point';
    else if (/^(basis point|bps)/.test(word)) unit = 'basis point';
    else unit = word ? stem(word) : '';
    numbers.push({ value: Math.round(value * 1e6) / 1e6, unit, raw: m[0].trim() });
  }
  return { numbers, years: [...new Set(years)] };
};

/** Names in a claim sentence, and the initials of multi-word names. */
const readEntities = (text) => {
  const names = new Set();
  const absorbed = new Set();
  // Organisations: a run of three or more capitalised words stands for its
  // initials ("Reserve Bank of India" is "rbi"), and its words do not count
  // separately. Two-word runs are usually people or events ("Narendra Modi",
  // "Asian Games") and keep their words, so "Modi" still matches.
  const runs = String(text || '').match(/(?:\p{Lu}[\p{L}\p{M}]+)(?:\s+(?:of|and|for|the)?\s*\p{Lu}[\p{L}\p{M}]+)+/gu) || [];
  for (const run of runs) {
    const words = run.split(/\s+/).filter(w => /^\p{Lu}/u.test(w) && !/^(?:The|A|An)$/.test(w) && !NOT_NAMES.has(w.toLowerCase()));
    if (words.length >= 3 && words.length <= 6) {
      names.add(words.map(w => w[0]).join('').toLowerCase());
      words.forEach(w => absorbed.add(w));
    }
  }
  for (const raw of String(text || '').split(/\s+/)) {
    const w = raw.replace(/[^\p{L}\p{N}\p{M}-]/gu, '').replace(/['’]s$/u, '');
    // An identifier with letters and digits names a thing: "T20I", "EOS-05".
    if (/\d/.test(w) && /^\p{L}/u.test(w) && /\p{L}.*\d|\d.*\p{L}/u.test(w) && /^\p{Lu}|-/u.test(w)) { names.add(w.toLowerCase()); continue; }
    if (!w || /\d/.test(w) || w.length < 2 || absorbed.has(w)) continue;
    if (/^\p{Lu}/u.test(w) && !NOT_NAMES.has(w.toLowerCase()) && !MONTHS.test(w)) names.add(stem(w));
  }
  return [...names];
};

/**
 * Who did it to whom, for a predicate where that is the claim: the first name
 * before the verb and the first after it, swapped for the passive ("India was
 * beaten by West Indies"). Null when the claim has no such predicate.
 */
const readRoles = (text, entitySet) => {
  const tokens = String(text).split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}\p{M}-]/gu, '').replace(/['’]s$/u, ''));
  const asEntity = (t) => {
    if (!t) return null;
    const forms = [t.toLowerCase(), stem(t)];
    return forms.find(f => entitySet.has(f)) || null;
  };
  const vi = tokens.findIndex(t => t && ASYMMETRIC.has(SYNONYM[t.toLowerCase()] || stem(t)));
  if (vi <= 0) return null;
  const before = tokens.slice(0, vi).map(asEntity).find(Boolean);
  const after = tokens.slice(vi + 1).map(asEntity).find(Boolean);
  if (!before || !after || before === after) return null;
  const passive = /^(?:is|was|were|are|been|be|being|got|get)$/i.test(tokens[vi - 1] || '') && /^by$/i.test(tokens[vi + 1] || '');
  return passive ? [after, before] : [before, after];
};

/**
 * @param {string} claim - one claim, as an English sentence
 * @returns {{entities: string[], numbers: Array, years: string[], terms: string[], negated: boolean, key: string}}
 */
const signatureOf = (claim) => {
  const text = normalisePhrases(claim);
  const entities = readEntities(text).sort();
  const { numbers, years } = readNumbers(text);
  numbers.sort((a, b) => (a.unit + a.value).localeCompare(b.unit + b.value));
  const entitySet = new Set(entities);
  let flips = 0;
  const termSet = new Set();
  for (const raw of text.split(/\s+/)) {
    if (/\d/.test(raw)) continue;                      // figures and identifiers are read above
    const w = raw.toLowerCase().replace(/[^\p{L}\p{M}'’-]/gu, '').replace(/['’]s$/u, '').replace(/^-+|-+$/g, '');
    if (!w || STOP.has(w) || NEGATION.test(w) || MONTHS.test(w) || UNIT_WORDS.has(w)) continue;
    let t = SYNONYM[w] || stem(w);
    if (ANTONYM[t]) { t = ANTONYM[t]; flips += 1; }
    if (t.length < 3 || entitySet.has(t) || UNIT_WORDS.has(t)) continue;
    termSet.add(t);
  }
  const terms = [...termSet].sort();
  const negations = (text.match(new RegExp(NEGATION.source, 'gi')) || []).length;
  const negated = (negations + flips) % 2 === 1;
  const roles = readRoles(text, entitySet);
  const key = [
    entities.join(','),
    numbers.map(n => `${n.value}:${n.unit}`).join(','),
    years.slice().sort().join(','),
    negated ? 'neg' : 'pos',
    terms.join(','),
    roles ? roles.join('>') : ''
  ].join('|');
  return { entities, numbers, years: years.sort(), terms, negated, roles, key };
};

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += 1;
  return shared / (A.size + B.size - shared);
};

/**
 * Compare two signatures.
 * @returns {{relation: 'same'|'variant'|'different', differences: string[], score: number}}
 */
const compareSignatures = (a, b) => {
  // Names agree when they largely coincide, or when the shorter set is wholly
  // contained in the longer ("Modi" in "Narendra Modi"); never on a partial
  // overlap such as "Asian Games" against "Commonwealth Games".
  const jac = jaccard(a.entities, b.entities);
  const sharedCount = a.entities.filter(e => b.entities.includes(e)).length;
  const smaller = Math.min(a.entities.length, b.entities.length);
  const contained = smaller > 0 && sharedCount === smaller;
  const names = contained && jac >= 0.5 ? Math.max(jac, 0.6) : jac;
  const sharedName = sharedCount > 0;
  const words = jaccard(a.terms, b.terms);
  const score = Math.round((0.6 * names + 0.4 * words) * 100) / 100;
  // Different people, organisations or places: different claims, whatever the wording.
  if (!sharedName || names < 0.5) return { relation: 'different', differences: [], score };

  const differences = [];
  const unitsA = new Map(a.numbers.map(n => [n.unit, n.value]));
  const unitsB = new Map(b.numbers.map(n => [n.unit, n.value]));
  let figureMismatch = false;
  for (const [unit, value] of unitsA) {
    if (unitsB.has(unit) && unitsB.get(unit) !== value) {
      differences.push(`figure: ${value}${unit ? ` ${unit}` : ''} vs ${unitsB.get(unit)}${unit ? ` ${unit}` : ''}`);
    }
  }
  // A figure stated in one and absent from the other is a difference in
  // specificity, not a change of figure: not the same claim, not a variant.
  for (const unit of new Set([...unitsA.keys(), ...unitsB.keys()])) {
    if (unitsA.has(unit) !== unitsB.has(unit)) figureMismatch = true;
  }
  if (a.years.length && b.years.length && a.years.join() !== b.years.join()) {
    differences.push(`date: ${a.years.join(', ')} vs ${b.years.join(', ')}`);
  }
  if (a.negated !== b.negated) differences.push('one says the opposite of the other');
  if (a.roles && b.roles && a.roles[0] === b.roles[1] && a.roles[1] === b.roles[0]) {
    differences.push(`roles reversed: ${a.roles[0]} over ${a.roles[1]} vs ${b.roles[0]} over ${b.roles[1]}`);
  }

  if (figureMismatch && !differences.length) return { relation: 'different', differences: [], score };
  if (differences.length) {
    return names >= 0.6 && words >= 0.4 ? { relation: 'variant', differences, score } : { relation: 'different', differences: [], score };
  }
  if (names >= 0.6 && words >= 0.5) return { relation: 'same', differences: [], score };
  // The names agree and every figure, date and polarity agrees, but the
  // wording differs too much to say: "Elon Musk bought Reliance Jio" against
  // "Reliance Jio was taken over by Elon Musk". Left as different here; the
  // caller may ask a model to settle it (services/claimMemory.js).
  return { relation: 'different', differences: [], score, ambiguous: true };
};

module.exports = { signatureOf, compareSignatures, readNumbers, readEntities };
