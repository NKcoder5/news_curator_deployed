// backend/eval/buildRulingSuite.js
//
// A labelled suite at scale whose ground truth is professional fact-checkers' published rulings, not any
// model: claims reviewed by IFCN-signatory desks and indexed in Google's fact-check index (ClaimReview),
// each with the ruling's link and date.
//
//   node eval/buildRulingSuite.js [--since 2024-10-01] [--per-query 50] [--max 320]
//   node eval/buildRulingSuite.js --queries world --out rulings_pool2 --prefix rp2 --caps true=80,misleading=0,false=same
//
// Writes eval/suites/rulings.json, or eval/suites/<out>.json: a further pool for development once the
// rulings' sealed part has been used, drawn from other subjects and kept clear of every case in every
// suite (the same ruling, the same message, or most of its words). A claim rated false is expected FAKE (PARTLY FALSE and MISLEADING
// are accepted: the desk's "false" often covers a distorted true event); rated misleading, MISLEADING
// (PARTLY FALSE or FAKE accepted); rated true, REAL. Run it with the fact-check channel on (what a reader
// gets) and off (FACT_CHECK_CHANNEL=off: whether the other evidence reaches the ruling on its own; with
// the channel on, the channel finds the very ruling the case is labelled from).

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseExplorer, ratingClass } = require('../agents/factCheckSearch');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT_NAME = `${arg('out', 'rulings')}.json`;
const OUT = path.join(__dirname, 'suites', OUT_NAME);
const PREFIX = arg('prefix', 'rul');
const EXPLORER_URL = 'https://toolbox.google.com/factcheck/api/search';
// What people in India forward, across topics; one query per subject keeps any one story from
// dominating. English queries match Hindi and Tamil reviews too when the desk indexed an English title.
const QUERIES = [
  'India', 'Modi', 'Rahul Gandhi', 'Tamil Nadu', 'Kerala', 'Karnataka', 'Bihar election', 'Maharashtra', 'West Bengal',
  'Uttar Pradesh', 'Delhi', 'Pakistan India', 'China India', 'Bangladesh', 'RBI', 'rupee note', 'bank holiday',
  'income tax', 'GST', 'petrol price', 'Aadhaar', 'UPI', 'scheme', 'pension', 'ration card', 'Indian Army',
  'ISRO', 'train accident', 'flood', 'earthquake', 'cyclone', 'cricket', 'Virat Kohli', 'Bollywood actor',
  'Supreme Court', 'election commission', 'EVM', 'temple', 'mosque', 'communal', 'viral video', 'WhatsApp message',
  'cancer cure', 'vaccine', 'Covid', 'dengue', 'heart attack', 'school holiday', 'exam', 'job', 'TVK Vijay', 'DMK',
  'Hindi', 'Tamil', 'Telugu', 'Mumbai', 'Chennai', 'Bengaluru', 'Hyderabad', 'Kolkata', 'Assam', 'Manipur', 'Kashmir'
];
// Subjects the queries above leave out: desks outside India, where a claim rated true is less rare
// (a politician's figure checked and found right).
const WORLD_QUERIES = [
  'unemployment', 'inflation', 'minimum wage', 'wages', 'tax cut', 'budget deficit', 'national debt', 'GDP',
  'immigration', 'border', 'crime rate', 'police', 'prison', 'gun', 'abortion', 'health insurance', 'Medicare',
  'Medicaid', 'Social Security', 'NHS', 'hospital', 'doctors', 'housing', 'rent', 'electricity prices', 'gas prices',
  'energy', 'renewable', 'climate change', 'emissions', 'tariffs', 'trade', 'manufacturing', 'farmers', 'school',
  'university', 'student loans', 'childcare', 'veterans', 'military', 'Ukraine', 'Russia', 'Israel', 'Gaza', 'Iran',
  'NATO', 'European Union', 'Brexit', 'Starmer', 'Albanese', 'Dutton', 'Trudeau', 'Carney', 'Trump', 'Biden',
  'Harris', 'Vance', 'Congress', 'Senate', 'governor', 'mayor', 'Philippines', 'Nigeria', 'Kenya', 'South Africa',
  'Ghana', 'Malta', 'Ireland', 'New Zealand', 'Australia', 'Canada', 'Brazil', 'Mexico', 'poll', 'statistics'
];
const QUERY_SETS = { india: QUERIES, world: WORLD_QUERIES };
const queries = QUERY_SETS[arg('queries', 'india')];
if (!queries) throw new Error(`--queries: one of ${Object.keys(QUERY_SETS).join(', ')}`);
const SINCE = arg('since', '2024-10-01');
const PER_QUERY = Number(arg('per-query', 50));
const MAX = Number(arg('max', 320));
const PER_DESK = 45;

const EXPECTED = {
  false: { expected: 'FAKE', alsoAcceptable: ['PARTLY FALSE', 'MISLEADING'], category: 'rated false' },
  misleading: { expected: 'MISLEADING', alsoAcceptable: ['PARTLY FALSE', 'FAKE'], category: 'rated misleading' },
  true: { expected: 'REAL', alsoAcceptable: [], category: 'rated true' }
};
const scriptOf = (t) => (/[஀-௿]/.test(t) ? 'ta' : /[ऀ-ॿ]/.test(t) ? 'hi' : /[ঀ-৿]/.test(t) ? 'bn'
  : /[ఀ-౿]/.test(t) ? 'te' : /[ഀ-ൿ]/.test(t) ? 'ml' : /[ಀ-೿]/.test(t) ? 'kn' : 'en');
const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Every message and ruling already in another suite: a case here must not repeat one (test/evalSuites.test.js). */
const knownCases = () => {
  const messages = new Set();
  const urls = new Set();
  const wordSets = [];
  for (const f of fs.readdirSync(path.join(__dirname, 'suites')).filter((x) => x.endsWith('.json') && x !== OUT_NAME)) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', f), 'utf8'));
    for (const c of [...(s.cases || []), ...(s.claims || [])]) {
      if (typeof c.input === 'string') { messages.add(norm(c.input)); wordSets.push(wordsOf(c.input)); }
      for (const u of c.sources || []) urls.add(String(u).replace(/[?#].*$/, '').replace(/\/+$/, ''));
    }
  }
  return { messages, urls, wordSets };
};
// Another desk's review of a claim already in a suite words it differently; most of its words in common
// still makes it the same case (a near-copy of a sealed case would let its answer leak into development).
const wordsOf = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 3));
const NEAR_COPY = 0.5;
const nearCopy = (words, wordSets) => wordSets.some((other) => {
  let shared = 0;
  for (const w of words) if (other.has(w)) shared += 1;
  return shared / Math.max(1, Math.min(words.size, other.size)) >= NEAR_COPY;
});

const search = async (query) => {
  const response = await axios.get(EXPLORER_URL, {
    params: { hl: 'en', num_results: PER_QUERY, force: 'false', offset: 0, query },
    responseType: 'text', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  return parseExplorer(String(response.data || ''));
};

// --relabel: read every case's published rating again with today's ratingClass and correct the labels
// in place. The cases stay the same and in order, since a suite's sealed part starts at a fixed place
// (robustnessSuite.js SEALED_FROM): a rating no longer read as any class keeps its old label and is
// counted. It prints counts only, so it can be run on a suite's sealed part without showing any case.
const relabel = () => {
  const suite = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const changed = {};
  const cases = [];
  for (const c of suite.cases) {
    const cls = ratingClass(c.ruling?.rating);
    const was = Object.keys(EXPECTED).find((k) => EXPECTED[k].category === c.category);
    if (cls === was) { cases.push(c); continue; }
    changed[`${was}->${cls}`] = (changed[`${was}->${cls}`] || 0) + 1;
    if (!EXPECTED[cls]) { cases.push(c); continue; }
    const { alsoAcceptable, ...rest } = c;
    cases.push({ ...rest, category: EXPECTED[cls].category, expected: EXPECTED[cls].expected,
      ...(EXPECTED[cls].alsoAcceptable.length ? { alsoAcceptable: EXPECTED[cls].alsoAcceptable } : {}) });
  }
  const today = new Date().toLocaleDateString('en-CA');
  const note = ` Relabelled ${today} (eval/buildRulingSuite.js --relabel): ${JSON.stringify(changed)}.`;
  if (Object.keys(changed).length) fs.writeFileSync(OUT, `${JSON.stringify({ ...suite, about: suite.about + note, cases }, null, 1)}\n`);
  console.log(`${OUT_NAME}: ${suite.cases.length} cases, labels changed ${JSON.stringify(changed)}, ${cases.length} kept`);
  process.exit(0);
};

const main = async () => {
  if (process.argv.includes('--relabel')) return relabel();
  const known = knownCases();
  const byClaim = new Map();
  let nearCopies = 0;
  for (const query of queries) {
    let reviews = [];
    try { reviews = await search(query); } catch (err) { console.log(`${query}: search failed (${err.message})`); continue; }
    let kept = 0;
    for (const r of reviews) {
      const cls = ratingClass(r.rating);
      const text = String(r.claimReviewed || '').replace(/\s+/g, ' ').trim();
      const key = norm(text);
      if (!EXPECTED[cls] || !r.url || !r.reviewedAt || r.reviewedAt < SINCE) continue;
      // A caption fragment ("Women protesters stopping buses") asserts nothing a check could be scored on.
      if (text.split(/\s+/).length < 6 || text.length > 280 || /^https?:/i.test(text) || known.messages.has(key) || byClaim.has(key)) continue;
      if (known.urls.has(String(r.url).replace(/[?#].*$/, '').replace(/\/+$/, ''))) continue;
      if (nearCopy(wordsOf(text), known.wordSets)) { nearCopies += 1; continue; }
      byClaim.set(key, { text, cls, url: r.url, reviewedAt: r.reviewedAt, publisher: r.publisher || r.site || 'unknown', rating: r.rating, query });
      kept += 1;
    }
    console.log(`${query}: ${reviews.length} reviews, ${kept} kept`);
    await new Promise((res) => setTimeout(res, 600));
  }

  // Balance: every true and misleading ruling (they are scarce), false ones up to the cap, no desk
  // more than PER_DESK, newest first within each class.
  const all = [...byClaim.values()].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  const perDesk = new Map();
  const take = (r) => {
    const n = perDesk.get(r.publisher) || 0;
    if (n >= PER_DESK) return false;
    perDesk.set(r.publisher, n + 1);
    return true;
  };
  const chosen = [];
  // Misleading rulings (an old video shared as new, a quote without its context) are the commonest
  // kind at Indian desks; capped so that outright false claims, the core case, stay the majority.
  // --caps true=80,misleading=0,false=same: "same" takes as many as the classes before it gave, so a pool
  // built for true claims carries as many false ones, and a fix that only softens verdicts shows.
  const CAP = { true: 80, misleading: 90, false: MAX };
  for (const part of String(arg('caps', '')).split(',').filter(Boolean)) {
    const [cls, n] = part.split('=');
    CAP[cls] = n;
  }
  const taken = {};
  for (const cls of ['true', 'misleading', 'false']) {
    const cap = CAP[cls] === 'same' ? Object.values(taken).reduce((a, b) => a + b, 0) : Number(CAP[cls]);
    let n = 0;
    for (const r of all.filter((x) => x.cls === cls)) {
      if (chosen.length >= MAX || n >= cap) break;
      if (take(r)) { chosen.push(r); n += 1; }
    }
    taken[cls] = n;
  }
  // A seeded shuffle, so any first N cases are a fair mix of the three rulings (--limit runs a sample).
  let seed = 20261022;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  const cases = chosen.map((r, i) => ({
    id: `${PREFIX}-${String(i + 1).padStart(3, '0')}`,
    category: EXPECTED[r.cls].category,
    language: scriptOf(r.text),
    input: r.text,
    expected: EXPECTED[r.cls].expected,
    ...(EXPECTED[r.cls].alsoAcceptable.length ? { alsoAcceptable: EXPECTED[r.cls].alsoAcceptable } : {}),
    sources: [r.url],
    labelledOn: r.reviewedAt,
    ruling: { publisher: r.publisher, rating: r.rating }
  }));
  const counts = cases.reduce((m, c) => ({ ...m, [c.category]: (m[c.category] || 0) + 1 }), {});
  const desks = new Set(cases.map((c) => c.ruling.publisher)).size;
  const command = `eval/buildRulingSuite.js ${process.argv.slice(2).join(' ')}`.trim();
  fs.writeFileSync(OUT, `${JSON.stringify({
    about: `Claims ruled on by professional fact-checking desks (Google fact-check index, ClaimReview), reviewed since ${SINCE}; the label is the desk's published rating, with the ruling's link and date. Built by ${command} on ${new Date().toLocaleDateString('en-CA')}. Run with FACT_CHECK_CHANNEL=off as well: with the channel on it finds the very ruling a case is labelled from.`,
    cases
  }, null, 1)}\n`);
  console.log(`\n${cases.length} cases from ${desks} desks: ${JSON.stringify(counts)}; languages ${JSON.stringify(cases.reduce((m, c) => ({ ...m, [c.language]: (m[c.language] || 0) + 1 }), {}))}; ${nearCopies} near-copies of other suites' cases left out`);
  process.exit(0);
};

main().catch((err) => { console.error(err); process.exit(1); });
