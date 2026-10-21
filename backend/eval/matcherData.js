// backend/eval/matcherData.js
//
// Training data for our own fact-check matcher: for each user text and each published review the
// fact-check search found for it, whether the review examined the same claim and what its finding makes
// of the text, as Gemini judges them in the matcher (agents/factCheckSearch.js), with who answered.
//
//   node eval/matcherData.js [--max-calls 200] [--sources rulings,stance,suites]
//
// The fact-checkers' own ruled claims (eval/suites/rulings.json) are the richest source: searching one
// finds other desks' reviews of the same rumour in other words, the paraphrases our pair model read as
// unrelated. Today's headlines (stance_claims) give the many reviews that share a topic and not a claim.
// The benchmark, held-out v2 and the reviewer probe stay out.
//
// Writes eval/results/matcher_pairs.jsonl, one line per (text, review), resumable by text.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const gateway = require('../utils/nvidiaNimApi');
const realCall = gateway.callNimApiJson;
let last = null;
gateway.callNimApiJson = async (prompt, options = {}) => {
  const meta = {};
  const value = await realCall(prompt, { ...options, meta });
  if (options.label === 'fact-check match') last = { prompt, value, provider: meta.provider || null, cached: Boolean(meta.cached) };
  return value;
};
const { checkFactCheckers } = require('../agents/factCheckSearch');

const OUT = path.join(__dirname, 'results', 'matcher_pairs.jsonl');
const SUITES = path.join(__dirname, 'suites');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const idOf = (text) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
const load = (name) => JSON.parse(fs.readFileSync(path.join(SUITES, `${name}.json`), 'utf8'));

/** The reviews the matcher was shown, recovered from its prompt: "n. Fact-checker: ...", then its lines. */
const shownReviews = (prompt) => {
  const reviews = [];
  let current = null;
  for (const line of String(prompt).split('\n')) {
    const head = line.match(/^(\d+)\. Fact-checker: (.*?)(?: \((\d{4}-\d{2}-\d{2})\))?$/);
    if (head) { current = { n: Number(head[1]), publisher: head[2], reviewedAt: head[3] || null }; reviews.push(current); continue; }
    if (!current) continue;
    const field = line.match(/^\s+(Claim it checked|Its rating|Its headline): "(.*)"$/);
    if (field) current[{ 'Claim it checked': 'claimReviewed', 'Its rating': 'rating', 'Its headline': 'title' }[field[1]]] = field[2];
  }
  return reviews;
};

const textsFrom = (sources) => {
  const out = [];
  if (sources.includes('rulings')) for (const c of load('rulings').cases) out.push({ source: 'rulings', text: c.input });
  if (sources.includes('stance')) for (const c of load('stance_claims').cases) out.push({ source: 'stance_claims', text: c.input });
  if (sources.includes('suites')) {
    for (const c of load('consistency').claims) for (const p of c.phrasings || []) out.push({ source: `consistency:${p.style}`, text: p.text });
    for (const name of ['robustness_suite', 'heldout_suite']) for (const c of load(name).cases) if (!/^https?:/i.test(c.input)) out.push({ source: name, text: c.input });
  }
  return out;
};

const main = async () => {
  const maxCalls = Number(arg('max-calls', 200));
  const sources = (arg('sources', 'rulings,stance,suites') || '').split(',');
  const done = new Set(fs.existsSync(OUT)
    ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).textId; } catch (_) { return null; } })
    : []);
  const seen = new Set();
  const texts = textsFrom(sources).filter((t) => { const id = idOf(t.text); if (seen.has(id) || done.has(id)) return false; seen.add(id); t.id = id; return true; });
  console.log(`${texts.length} texts to match (${done.size} already recorded); at most ${maxCalls} matcher calls`);

  let calls = 0; let pairs = 0; let streak = 0;
  for (const t of texts) {
    if (calls >= maxCalls) break;
    last = null;
    try {
      await checkFactCheckers([{ claim: t.text, keywords: '' }], { title: t.text, text: t.text });
    } catch (_) { /* no reviews found or the search failed: nothing to record */ }
    if (!last) {
      // No candidate reviews, so no matcher call: recorded once so a resumed run skips it.
      fs.appendFileSync(OUT, `${JSON.stringify({ textId: t.id, source: t.source, text: t.text, noReviews: true })}\n`);
      continue;
    }
    calls += 1;
    streak = last.provider === 'gemini' ? 0 : streak + 1;
    const items = new Map((Array.isArray(last.value?.items) ? last.value.items : []).map((it) => [Number(it.n), it]));
    for (const r of shownReviews(last.prompt)) {
      const it = items.get(r.n) || {};
      fs.appendFileSync(OUT, `${JSON.stringify({ textId: t.id, source: t.source, text: t.text, review: r, sameClaim: it.same_claim ?? null, userTextIs: it.user_text_is ?? null, why: it.why || null, provider: last.provider })}\n`);
      pairs += 1;
    }
    if (streak >= 5) { console.log('Stopped: five matcher calls in a row did not come from Gemini (quota or outage). Resume later.'); break; }
    if (calls % 20 === 0) console.log(`${calls} matcher calls, ${pairs} pairs`);
  }
  console.log(`done: ${calls} matcher calls, ${pairs} pairs recorded`);
  process.exit(0);
};

if (require.main === module) main();

module.exports = { shownReviews };
