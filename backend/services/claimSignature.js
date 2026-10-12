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
  'dr', 'ji', 'shri', 'sri'
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
  detained: 'detain', detains: 'detain', urged: 'urge', urges: 'urge', cut: 'cut', cuts: 'cut'
};
const MONTHS = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
const SCALE = { thousand: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, crore: 1e7, crores: 1e7, billion: 1e9 };
const NEGATION = /\b(?:not|no|never|didn't|did not|doesn't|does not|hasn't|has not|haven't|have not|isn't|is not|wasn't|was not|won't|will not|cannot|can't|denied|denies|refused|neither|nor)\b/i;

// Opposites are one predicate and a flip of polarity: "TVK lost" is "TVK did
// not win", so it is a variant of "TVK won" (the opposite claim about the same
// thing), and "TVK did not lose" is the same claim as "TVK won".
const ANTONYM = { lose: 'win', fall: 'rise', cut: 'raise', lower: 'raise', reduce: 'raise', decrease: 'increase', reject: 'accept' };
const SYNONYM = { hike: 'raise', hiked: 'raise', hikes: 'raise' };
const STOP = new Set([...NOT_NAMES, 'as', 'be', 'been', 'being', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'about', 'into', 'over', 'after', 'before', 'than', 'then', 'also', 'his', 'her', 'their', 'our', 'your',
  'which', 'while', 'claim', 'claims', 'reported', 'report', 'news', 'today', 'yesterday', 'tomorrow', 'week',
  'month', 'year', 'now', 'just', 'very', 'more', 'most', 'some', 'any', 'other', 'such', 'only', 'own', 'same',
  'so', 'too', 'up', 'down', 'out', 'off', 'again', 'once', 'he', 'him', 'she', 'them', 'his', 'who', 'whom', 'whose']);

const stem = (w) => {
  const t = String(w).toLowerCase();
  if (LEMMA[t]) return LEMMA[t];
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

/** Figures with units, and years, read from a claim sentence. */
const readNumbers = (text) => {
  const numbers = [];
  const years = [];
  const src = String(text || '').replace(/(\d),(?=\d)/g, '$1');
  const re = /(₹|rs\.?\s*|inr\s*)?(\d+(?:\.\d+)?)\s*(thousand|lakhs?|million|crores?|billion)?(?:\s*-\s*|\s+)?(per\s*cent|percent|%|percentage points?|basis points?|bps|[\p{L}]{3,})?/giu;
  for (const m of src.matchAll(re)) {
    const currency = Boolean(m[1]);
    let value = Number(m[2]);
    const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1;
    const word = (m[4] || '').toLowerCase().replace(/\s+/g, ' ');
    if (!currency && !m[3] && /^(?:19|20)\d{2}$/.test(m[2]) && !/^(per|percent|%)/.test(word)) {
      years.push(m[2]);
      continue;
    }
    if (word && MONTHS.test(word)) continue;          // "11 October" is a date
    value *= scale;
    let unit;
    if (currency) unit = 'rupee';
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
    const words = run.split(/\s+/).filter(w => /^\p{Lu}/u.test(w) && !/^(?:The|A|An)$/.test(w));
    if (words.length >= 3 && words.length <= 6) {
      names.add(words.map(w => w[0]).join('').toLowerCase());
      words.forEach(w => absorbed.add(w));
    }
  }
  for (const raw of String(text || '').split(/\s+/)) {
    const w = raw.replace(/[^\p{L}\p{N}\p{M}-]/gu, '').replace(/['’]s$/u, '');
    if (!w || /\d/.test(w) || w.length < 2 || absorbed.has(w)) continue;
    if (/^\p{Lu}/u.test(w) && !NOT_NAMES.has(w.toLowerCase()) && !MONTHS.test(w)) names.add(stem(w));
  }
  return [...names];
};

/**
 * @param {string} claim - one claim, as an English sentence
 * @returns {{entities: string[], numbers: Array, years: string[], terms: string[], negated: boolean, key: string}}
 */
const signatureOf = (claim) => {
  const text = String(claim || '');
  const entities = readEntities(text).sort();
  const { numbers, years } = readNumbers(text);
  numbers.sort((a, b) => (a.unit + a.value).localeCompare(b.unit + b.value));
  const entitySet = new Set(entities);
  let flips = 0;
  const termSet = new Set();
  for (const raw of text.split(/\s+/)) {
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
  const key = [
    entities.join(','),
    numbers.map(n => `${n.value}:${n.unit}`).join(','),
    years.slice().sort().join(','),
    negated ? 'neg' : 'pos',
    terms.join(',')
  ].join('|');
  return { entities, numbers, years: years.sort(), terms, negated, key };
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
  if (!sharedName || names < 0.5 || words < 0.34) return { relation: 'different', differences: [], score };

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

  if (figureMismatch && !differences.length) return { relation: 'different', differences: [], score };
  if (differences.length) {
    return names >= 0.6 && words >= 0.4 ? { relation: 'variant', differences, score } : { relation: 'different', differences: [], score };
  }
  return names >= 0.6 && words >= 0.5 ? { relation: 'same', differences: [], score } : { relation: 'different', differences: [], score };
};

module.exports = { signatureOf, compareSignatures, readNumbers, readEntities };
