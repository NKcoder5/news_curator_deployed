// backend/eval/buildRulingSuite.js
//
// A labelled suite at scale whose ground truth is professional fact-checkers' published rulings, not any
// model: claims reviewed by IFCN-signatory desks and indexed in Google's fact-check index (ClaimReview),
// each with the ruling's link and date.
//
//   node eval/buildRulingSuite.js [--since 2024-10-01] [--per-query 50] [--max 320]
//
// Writes eval/suites/rulings.json. A claim rated false is expected FAKE (PARTLY FALSE and MISLEADING
// are accepted: the desk's "false" often covers a distorted true event); rated misleading, MISLEADING
// (PARTLY FALSE or FAKE accepted); rated true, REAL. Run it with the fact-check channel on (what a reader
// gets) and off (FACT_CHECK_CHANNEL=off: whether the other evidence reaches the ruling on its own; with
// the channel on, the channel finds the very ruling the case is labelled from).

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseExplorer, ratingClass } = require('../agents/factCheckSearch');

const OUT = path.join(__dirname, 'suites', 'rulings.json');
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

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
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

/** Every message already in a suite: a case here must not repeat one (test/evalSuites.test.js). */
const knownMessages = () => {
  const seen = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, 'suites')).filter((x) => x.endsWith('.json') && x !== 'rulings.json')) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', f), 'utf8'));
    for (const c of [...(s.cases || []), ...(s.claims || [])]) if (typeof c.input === 'string') seen.add(norm(c.input));
  }
  return seen;
};

const search = async (query) => {
  const response = await axios.get(EXPLORER_URL, {
    params: { hl: 'en', num_results: PER_QUERY, force: 'false', offset: 0, query },
    responseType: 'text', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  return parseExplorer(String(response.data || ''));
};

const main = async () => {
  const seen = knownMessages();
  const byClaim = new Map();
  for (const query of QUERIES) {
    let reviews = [];
    try { reviews = await search(query); } catch (err) { console.log(`${query}: search failed (${err.message})`); continue; }
    let kept = 0;
    for (const r of reviews) {
      const cls = ratingClass(r.rating);
      const text = String(r.claimReviewed || '').replace(/\s+/g, ' ').trim();
      const key = norm(text);
      if (!EXPECTED[cls] || !r.url || !r.reviewedAt || r.reviewedAt < SINCE) continue;
      // A caption fragment ("Women protesters stopping buses") asserts nothing a check could be scored on.
      if (text.split(/\s+/).length < 6 || text.length > 280 || /^https?:/i.test(text) || seen.has(key) || byClaim.has(key)) continue;
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
  const CAP = { true: 80, misleading: 90, false: MAX };
  for (const cls of ['true', 'misleading', 'false']) {
    let n = 0;
    for (const r of all.filter((x) => x.cls === cls)) {
      if (chosen.length >= MAX || n >= CAP[cls]) break;
      if (take(r)) { chosen.push(r); n += 1; }
    }
  }
  // A seeded shuffle, so any first N cases are a fair mix of the three rulings (--limit runs a sample).
  let seed = 20261022;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  const cases = chosen.map((r, i) => ({
    id: `rul-${String(i + 1).padStart(3, '0')}`,
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
  fs.writeFileSync(OUT, `${JSON.stringify({
    about: `Claims ruled on by professional fact-checking desks (Google fact-check index, ClaimReview), reviewed since ${SINCE}; the label is the desk's published rating, with the ruling's link and date. Built by eval/buildRulingSuite.js on ${new Date().toLocaleDateString('en-CA')}. Run with FACT_CHECK_CHANNEL=off as well: with the channel on it finds the very ruling a case is labelled from.`,
    cases
  }, null, 1)}\n`);
  console.log(`\n${cases.length} cases from ${desks} desks: ${JSON.stringify(counts)}; languages ${JSON.stringify(cases.reduce((m, c) => ({ ...m, [c.language]: (m[c.language] || 0) + 1 }), {}))}`);
  process.exit(0);
};

main().catch((err) => { console.error(err); process.exit(1); });
