// backend/eval/benchmarkCheckAnything.js
//
// Check Anything against a plain language model, on claims about this month.
//
// The question a review panel asks is fair: could a chatbot do this in five
// minutes? This answers it with a measurement rather than an argument. Every
// claim below is labelled from published reporting, and each is put to:
//
//   plain LLM  — the same hosted model our pipeline uses (Gemini flash-lite),
//                asked zero-shot whether the claim is true, with today's date.
//                No search, no fact-check index, no evidence.
//   ours       — the full Check Anything path: ingest, input gate, the four
//                evidence channels and the verdict rules.
//
// Most of these claims concern October 2026, after any model's training data
// ends. That is the point, and it is the normal case: what people forward is
// this week's news. A model answering from memory can only guess at it or
// decline; a system that retrieves and weighs evidence can settle it.
//
// The claims fall into kinds that fail differently:
//   figure     — the right event with a wrong number (84 medals for 85)
//   outcome    — the right event with the result reversed
//   rumour     — a viral claim professional fact-checkers have ruled on
//   invented   — an event that never happened, about a heavily covered subject
//   premise    — a false stable fact
//   true       — genuine reporting from this week, national and local
//
// Usage:
//   node eval/benchmarkCheckAnything.js            all claims, both systems
//   node eval/benchmarkCheckAnything.js --only 5   the first five
//   node eval/benchmarkCheckAnything.js --baseline-only
//   node eval/benchmarkCheckAnything.js --gap 10   seconds between claims (default 6)
//
// Writes eval/results/checkAnything_benchmark.{json,md}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { PROVIDERS } = require('../utils/llmProviders');
const { askPlainModel } = require('../agents/plainModelBaseline');
const { ingestSocialContent } = require('../utils/socialIngest');
const { assessCheckability } = require('../agents/checkability');
const { analyzeTrust } = require('../agents/trustAnalysisAgent');

// Labels come from the reporting cited beside each claim, checked by hand on
// 2026-10-11.
const CLAIMS = [
  // figure
  { text: 'India’s 84-Medal Campaign at Asian Games 2026', truth: false, kind: 'figure', basis: 'DD India, News On AIR, The Indian Express: 85 medals' },
  { text: 'India won 90 medals at the Asian Games 2026', truth: false, kind: 'figure', basis: '85 medals' },
  { text: 'India’s 85-Medal Campaign at Asian Games 2026', truth: true, kind: 'true', basis: 'DD India fact sheet' },
  // outcome
  { text: 'TVK lost the 2026 bye elections', truth: false, kind: 'outcome', basis: 'TVK won both seats' },
  { text: 'TVK won the 2026 bye elections', truth: true, kind: 'true', basis: 'TVK sweeps both seats' },
  { text: 'RBI cut the repo rate by 50 basis points this week', truth: false, kind: 'outcome', basis: 'RBI raised the rate by 25 bps' },
  { text: 'RBI raised the repo rate by 25 basis points to 5.50%', truth: true, kind: 'true', basis: 'The Hindu, Reuters' },
  // rumour
  { text: 'All Saturdays have been declared bank holidays for public sector banks from November 2026, says government gazette', truth: false, kind: 'rumour', basis: 'The Quint, Newschecker, PIB Fact Check' },
  { text: 'Video shows Army chief General Dhiraj Seth dancing with an Army major’s wife', truth: false, kind: 'rumour', basis: 'AFP, PTI, India Today, Factly: AI-generated' },
  { text: 'RBI bans 500 rupee notes from November 2026', truth: false, kind: 'rumour', basis: 'The Quint, BOOM, Alt News' },
  // invented
  { text: 'PM Modi resigned as Prime Minister today', truth: false, kind: 'invented', basis: 'PM Modi launched projects in Chennai today' },
  { text: 'Income tax has been abolished in India from 2026', truth: false, kind: 'invented', basis: 'Income Tax Dept launched Kar Saathi this week' },
  { text: 'Reliance Jio has been bought by Elon Musk this week', truth: false, kind: 'invented', basis: 'Jio Platforms plans its own IPO' },
  { text: 'Sundar Pichai resigned as Google CEO this week', truth: false, kind: 'invented', basis: 'Pichai announced EmbeddingGemma 2 as CEO' },
  // premise
  { text: 'Rahul Gandhi is the Prime Minister of India', truth: false, kind: 'premise', basis: 'Narendra Modi is Prime Minister' },
  { text: 'Chennai is the capital of Karnataka', truth: false, kind: 'premise', basis: 'Bengaluru is the capital' },
  // true, this week
  { text: 'PM Modi launched projects worth Rs 13,000 crore in Chennai', truth: true, kind: 'true', basis: 'DD News, News On AIR, NDTV' },
  { text: 'Income Tax Department launched the Kar Saathi website to simplify tax filing', truth: true, kind: 'true', basis: 'DD News' },
  { text: 'Virat Kohli denied claims that he took Rs 5 crore to visit Premanand Maharaj’s ashram', truth: true, kind: 'true', basis: 'ThePrint, Hindustan Times, The Indian Express' },
  { text: 'Vijay urged the Centre to release Rs 5,110 crore pending Samagra Shiksha funds', truth: true, kind: 'true', basis: 'ANI' },
  { text: 'Madurai Corporation launches complete street policy', truth: true, kind: 'true', basis: 'The Hindu' },
  { text: 'Couple booked for cheating a pawnbroker of Rs 76 lakh in Coimbatore', truth: true, kind: 'true', basis: 'The Times of India' }
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : CLAIMS.length;
const baselineOnly = args.includes('--baseline-only');
// Seconds to wait between claims. The hosted model's free tier is rate
// limited, and a 429 sends judgements to a weaker fallback model — which would
// measure the quota, not the system.
const gapSeconds = args.includes('--gap') ? Number(args[args.indexOf('--gap') + 1]) : 6;

/** The full Check Anything path, in process. */
const askOurs = async (claim) => {
  const started = Date.now();
  try {
    const ingested = await ingestSocialContent({ text: claim });
    const gate = assessCheckability(ingested.content, ingested.title);
    if (!gate.checkable) return { call: 'REFUSED', reason: gate.reason, ms: Date.now() - started };
    const report = await analyzeTrust({
      title: ingested.title, content: ingested.content, source: ingested.source, url: ingested.url,
      provenance: ingested.provenance, modality: ingested.modality, publishedAt: null, textCoverage: 'full'
    });
    return { call: report.call, reason: report.oneLine, rule: report.decision?.rule, confidence: report.decision?.confidence, ms: Date.now() - started };
  } catch (err) {
    return { call: 'ERROR', reason: err.message, ms: Date.now() - started };
  }
};

const score = (rows, key) => {
  const right = rows.filter(r => r[key].call === (r.truth ? 'REAL' : 'FAKE')).length;
  const abstained = rows.filter(r => ['CANNOT VERIFY', 'REFUSED', 'ERROR'].includes(r[key].call)).length;
  const wrong = rows.length - right - abstained;
  return { right, abstained, wrong, accuracy: rows.length ? right / rows.length : 0 };
};

(async () => {
  const rows = [];
  for (const claim of CLAIMS.slice(0, only)) {
    const plain = await askPlainModel(claim.text);
    const ours = baselineOnly ? { call: 'SKIPPED', reason: '', ms: 0 } : await askOurs(claim.text);
    rows.push({ ...claim, plain, ours });
    await new Promise(resolve => setTimeout(resolve, gapSeconds * 1000));
    const expected = claim.truth ? 'REAL' : 'FAKE';
    console.log(`${claim.kind.padEnd(9)} ${expected.padEnd(5)} | plain ${plain.call.padEnd(13)} | ours ${ours.call.padEnd(13)} | ${claim.text}`);
  }

  const kinds = [...new Set(rows.map(r => r.kind))];
  const summary = {
    ranAt: new Date().toISOString(),
    plainModel: `${PROVIDERS.gemini.models[0]}, zero-shot, temperature 0`,
    claims: rows.length,
    plain: score(rows, 'plain'),
    ours: baselineOnly ? null : score(rows, 'ours'),
    byKind: Object.fromEntries(kinds.map(k => {
      const subset = rows.filter(r => r.kind === k);
      return [k, { n: subset.length, plain: score(subset, 'plain').right, ours: baselineOnly ? null : score(subset, 'ours').right }];
    })),
    medianSecondsOurs: baselineOnly ? null
      : Math.round([...rows.map(r => r.ours.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] / 100) / 10
  };

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'checkAnything_benchmark.json'), JSON.stringify({ summary, rows }, null, 2));

  const pct = (s) => `${s.right}/${rows.length} right, ${s.abstained} abstained, ${s.wrong} wrong`;
  const md = [
    '# Check Anything vs a plain language model',
    '',
    `Run ${summary.ranAt.slice(0, 16).replace('T', ' ')} UTC on ${rows.length} claims labelled from published reporting.`,
    `Plain model: ${summary.plainModel}, asked with today's date and nothing to read.`,
    '',
    `- Plain model: ${pct(summary.plain)}`,
    summary.ours ? `- Check Anything: ${pct(summary.ours)} (median ${summary.medianSecondsOurs} s per claim)` : '',
    '',
    '| Kind | Claim | Truth | Plain model | Check Anything | Decided by |',
    '|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.kind} | ${r.text.replace(/\|/g, '/')} | ${r.truth ? 'REAL' : 'FAKE'} | ${r.plain.call} | ${r.ours.call} | ${r.ours.rule || ''} |`),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'checkAnything_benchmark.md'), md);

  console.log('\nplain model:', pct(summary.plain));
  if (summary.ours) console.log('ours       :', pct(summary.ours));
  process.exit(0);
})();
