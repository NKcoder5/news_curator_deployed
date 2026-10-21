// backend/eval/claimReviewCorpus.js
//
// A corpus of fact-checkers' published reviews (Google's fact-check index, ClaimReview) for training our
// own pair model on the two readings the hosted model makes for the fact-check channel: whether a text
// states the claim a desk reviewed, and what a debunk's headline says of that claim. No model labels
// anything here: each line is a desk's own wording of the claim, its headline and its rating.
//
//   node eval/claimReviewCorpus.js [--pages 5] [--since 2023-01-01]
//
// Every claim in an evaluation suite stays out, by its wording and by its review's address, so nothing
// trained from this corpus has seen a case it is measured on (test/evalSuites.test.js keeps the suites
// apart from each other in the same way).
//
// Writes ml/data/raw/claimreview/corpus.jsonl, one review per line.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseExplorer, ratingClass } = require('../agents/factCheckSearch');

const OUT_DIR = path.join(__dirname, '..', '..', 'ml', 'data', 'raw', 'claimreview');
const OUT = path.join(OUT_DIR, 'corpus.jsonl');
const SUITES = path.join(__dirname, 'suites');
const EXPLORER_URL = 'https://toolbox.google.com/factcheck/api/search';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PAGES = Number(arg('pages', 5));
const SINCE = arg('since', '2023-01-01');

// Broader than the ruling suite's queries (eval/buildRulingSuite.js): the same rumour reviewed by several
// desks in their own words is what the matcher must learn, so popular subjects are paged deeply.
const QUERIES = [
  'India', 'Modi', 'Rahul Gandhi', 'Amit Shah', 'Yogi Adityanath', 'Kejriwal', 'Mamata Banerjee', 'Stalin',
  'Tamil Nadu', 'Kerala', 'Karnataka', 'Bihar', 'Maharashtra', 'West Bengal', 'Uttar Pradesh', 'Delhi',
  'Punjab', 'Gujarat', 'Rajasthan', 'Telangana', 'Andhra Pradesh', 'Odisha', 'Assam', 'Manipur', 'Kashmir',
  'Pakistan', 'China', 'Bangladesh', 'Nepal', 'Sri Lanka', 'Israel', 'Gaza', 'Ukraine', 'Russia', 'Trump',
  'RBI', 'rupee note', 'bank', 'income tax', 'GST', 'petrol price', 'Aadhaar', 'UPI', 'PAN card', 'scheme',
  'pension', 'ration card', 'free laptop', 'free recharge', 'lottery', 'job', 'recruitment', 'exam', 'school',
  'Indian Army', 'Indian Navy', 'Air Force', 'Operation Sindoor', 'ISRO', 'Chandrayaan', 'train', 'airport',
  'flood', 'earthquake', 'cyclone', 'fire', 'accident', 'bridge collapse', 'cricket', 'Virat Kohli',
  'Rohit Sharma', 'Dhoni', 'Olympics', 'Bollywood', 'Shah Rukh Khan', 'Salman Khan', 'Amitabh Bachchan',
  'Rajinikanth', 'Vijay', 'Supreme Court', 'High Court', 'election', 'EVM', 'voter', 'BJP', 'Congress',
  'temple', 'mosque', 'church', 'Hindu', 'Muslim', 'communal', 'protest', 'police', 'arrest', 'viral video',
  'photo', 'WhatsApp', 'AI generated', 'deepfake', 'old video', 'edited', 'morphed', 'cancer', 'vaccine',
  'Covid', 'dengue', 'heart attack', 'medicine', 'cure', 'food', 'milk', 'water', 'death', 'died',
  'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Malayalam', 'Kannada', 'Marathi', 'Mumbai', 'Chennai', 'Bengaluru',
  'Hyderabad', 'Kolkata', 'Ayodhya', 'Kumbh', 'Ram Mandir', 'Waqf', 'CAA', 'farmers', 'Adani', 'Ambani'
];

const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const printOf = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

/** Every wording and review address in an evaluation suite. */
const heldOut = () => {
  const texts = new Set();
  const urls = new Set();
  for (const f of fs.readdirSync(SUITES).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join(SUITES, f), 'utf8'));
    for (const c of [...(s.cases || []), ...(s.claims || []), ...(s.pairs || [])]) {
      for (const t of [c.input, c.claim, c.a, c.b, c.headline, c.premise, c.hypothesis]) if (typeof t === 'string') texts.add(norm(t));
      for (const u of c.sources || []) urls.add(printOf(u));
    }
  }
  return { texts, urls };
};

const search = async (query, offset) => {
  const response = await axios.get(EXPLORER_URL, {
    params: { hl: 'en', num_results: 50, force: 'false', offset, query },
    responseType: 'text', timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  return parseExplorer(String(response.data || ''));
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { texts, urls } = heldOut();
  const seen = new Map();
  let excluded = 0;
  for (const query of QUERIES) {
    let added = 0;
    for (let page = 0; page < PAGES; page += 1) {
      let reviews = [];
      try { reviews = await search(query, page * 50); } catch (err) { console.log(`${query} p${page}: failed (${err.message})`); break; }
      if (!reviews.length) break;
      for (const r of reviews) {
        const claim = String(r.claimReviewed || '').replace(/\s+/g, ' ').trim();
        if (!claim || !r.url || (r.reviewedAt && r.reviewedAt < SINCE)) continue;
        const key = printOf(r.url);
        if (seen.has(key)) continue;
        if (texts.has(norm(claim)) || urls.has(key)) { excluded += 1; continue; }
        seen.set(key, {
          claim,
          title: r.title ? String(r.title).replace(/\s+/g, ' ').trim() : null,
          rating: r.rating || null,
          ratingClass: ratingClass(r.rating) || null,
          publisher: r.publisher || r.site || null,
          site: r.site || null,
          url: r.url,
          reviewedAt: r.reviewedAt || null,
          claimant: r.claimant || null,
          query
        });
        added += 1;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    console.log(`${query}: +${added} (total ${seen.size})`);
  }
  fs.writeFileSync(OUT, [...seen.values()].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const byClass = [...seen.values()].reduce((m, r) => ({ ...m, [r.ratingClass || 'other']: (m[r.ratingClass || 'other'] || 0) + 1 }), {});
  console.log(`\n${seen.size} reviews from ${new Set([...seen.values()].map((r) => r.publisher)).size} desks; ${excluded} left out as evaluation cases; ${JSON.stringify(byClass)}`);
  process.exit(0);
};

main().catch((err) => { console.error(err); process.exit(1); });
