// backend/eval/runEval.js
// Runs the trust-analysis pipeline over a labeled dataset and records one
// JSON line per article, so results survive interruptions and can be
// aggregated later by report.js.
//
// Usage:
//   node eval/runEval.js --data eval/data/dataset.csv --config full --sample 100
//
// Dataset CSV columns (header required): title,text,label
//   label: 1 = real, 0 = fake
//
// Configs (for the ablation study):
//   full            source + clickbait + bias (verification off: dataset
//                   articles are historical, so live news search cannot
//                   corroborate them — stated explicitly in the paper)
//   full+verify     all four factors, including live cross-source search
//   no-bias         drop the bias factor
//   no-clickbait    drop the clickbait factor
//   no-source       drop source reputation (recommended for ISOT: avoids
//                   the Reuters source-leak problem)
//   content-only    clickbait + bias only (fully source-blind)
//   baseline        the original single-prompt credibility agent
//
// Notes:
// - Requires NIM_API_KEY in backend/.env.
// - Rate-limited to stay under free-tier request limits (RPM below).
// - Safe to re-run: articles already in the output file are skipped.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const { getSourceReputation } = require('../agents/sourceReputationAgent');
const { analyzeClickbait } = require('../agents/clickbaitAgent');
const { analyzeBias } = require('../agents/biasAgent');
const { verifyClaims } = require('../agents/claimVerificationAgent');
const { detectManipulation } = require('../agents/manipulationAgent');
const { assessTransparency } = require('../agents/transparencyAgent');
const { analyzeWriting } = require('../agents/writingChecks');
const checkCredibility = require('../agents/credibilityAgent');
const { WEIGHTS } = require('../agents/trustAnalysisAgent');
const { limitText, TEXT_BUDGET } = require('../utils/articleText');

// Requests per minute. 30 was chosen for the original provider, which throttled
// under load; the current one sustained six concurrent calls comfortably in
// measurement, so the pacing is configurable rather than fixed. The gateway
// still backs off on HTTP 429, so an over-optimistic value self-corrects.
const RPM = Number(process.env.EVAL_RPM) || 30;
const MIN_GAP_MS = Math.ceil(60000 / RPM);

// Note: the fact-check factor cannot be evaluated on ISOT — those 2016-17
// claims predate most fact-check databases and the factor needs live lookups.
// It is measured separately in the live-news study.
const CONFIGS = {
  'full':           { source: true,  clickbait: true,  bias: true,  manipulation: true,  transparency: true,  verification: false },
  'full+verify':    { source: true,  clickbait: true,  bias: true,  manipulation: true,  transparency: true,  verification: true },
  'no-bias':        { source: true,  clickbait: true,  bias: false, manipulation: true,  transparency: true,  verification: false },
  'no-clickbait':   { source: true,  clickbait: false, bias: true,  manipulation: true,  transparency: true,  verification: false },
  'no-manipulation':{ source: true,  clickbait: true,  bias: true,  manipulation: false, transparency: true,  verification: false },
  'no-transparency':{ source: true,  clickbait: true,  bias: true,  manipulation: true,  transparency: false, verification: false },
  'no-source':      { source: false, clickbait: true,  bias: true,  manipulation: true,  transparency: true,  verification: false },
  // Source-blind content analysis — the headline configuration, leak-free.
  'content-only':   { source: false, clickbait: true,  bias: true,  manipulation: true,  transparency: true,  verification: false },
  // The same four factors read by one model call (agents/writingChecks.js, WRITING_CHECKS=merged), on the
  // same articles, so the likelihood ratios can be measured again for the prompt that will produce them.
  'content-merged': { source: false, clickbait: true,  bias: true,  manipulation: true,  transparency: true,  verification: false, merged: true },
  // The Phase I content pipeline (clickbait + bias only), so the two factors
  // added in Phase II can be credited separately.
  'content-v1':     { source: false, clickbait: true,  bias: true,  manipulation: false, transparency: false, verification: false },
  'baseline':       { baseline: true }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { config: 'full', sample: 100, seed: 42, hideSource: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data') out.data = args[++i];
    else if (args[i] === '--config') out.config = args[++i];
    else if (args[i] === '--sample') out.sample = parseInt(args[++i]);
    else if (args[i] === '--seed') out.seed = parseInt(args[++i]);
    else if (args[i] === '--show-source') out.hideSource = false;
    else if (args[i] === '--out') out.out = args[++i];
    // Only the articles another run's results file holds: the same articles, read another way.
    else if (args[i] === '--ids-from') out.idsFrom = args[++i];
  }
  if (!out.data) { console.error('Missing --data <csv>'); process.exit(1); }
  if (!CONFIGS[out.config]) {
    console.error(`Unknown config "${out.config}". Options: ${Object.keys(CONFIGS).join(', ')}`);
    process.exit(1);
  }
  return out;
}

const { parseCsv } = require('./csv');

// Deterministic PRNG so the same --seed always evaluates the same sample.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ISOT hygiene: real articles start with "CITY (Reuters) -" which leaks the
// label. Strip agency prefixes from the text the models see.
function stripAgencyPrefix(text) {
  return (text || '')
    .replace(/^[A-Z][A-Za-z .,/-]{0,40}\((Reuters|AP|AFP|Xinhua|ANI|PTI|IANS)\)\s*[--—:]*\s*/i, '')
    .replace(/\b(Reuters|Associated Press)\b/g, 'the news agency');
}

function loadDataset(file, sample, seed) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map(h => h.trim().toLowerCase());
  const ti = header.indexOf('title'), xi = header.indexOf('text'), li = header.indexOf('label');
  if (ti === -1 || xi === -1 || li === -1) {
    console.error(`CSV must have title,text,label columns. Found: ${header.join(', ')}`);
    process.exit(1);
  }
  const items = rows.slice(1)
    .map((r, i) => ({ id: i, title: r[ti], text: r[xi], label: parseInt(r[li]) }))
    .filter(it => it.title && it.text && (it.label === 0 || it.label === 1));

  // Stratified sample: equal halves of real and fake, deterministic order.
  const rng = mulberry32(seed);
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const real = shuffle(items.filter(i => i.label === 1)).slice(0, Math.ceil(sample / 2));
  const fake = shuffle(items.filter(i => i.label === 0)).slice(0, Math.floor(sample / 2));
  return shuffle([...real, ...fake]);
}

// Same aggregation logic as the production orchestrator, generalized to any
// subset of factors (weights of disabled factors are redistributed).
function aggregate(scores, enabled) {
  let weights = { ...WEIGHTS };
  let totalDisabled = 0;
  for (const k of Object.keys(weights)) {
    if (!enabled[k]) { totalDisabled += weights[k]; weights[k] = 0; }
  }
  const remaining = 1 - totalDisabled;
  let overall = 0;
  for (const k of Object.keys(weights)) {
    if (weights[k] > 0) overall += scores[k] * (weights[k] / remaining);
  }
  return Math.round(overall * 10) / 10;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evalOne(item, cfg, hideSource) {
  const title = item.title;
  // Bound the text exactly as the deployed pipeline does. Evaluating on a
  // longer excerpt than production uses would not describe the shipped system,
  // and the current model degrades on long inputs (see paper §7.3).
  const text = limitText(stripAgencyPrefix(item.text), TEXT_BUDGET.factors);
  const source = hideSource ? 'Unknown' : (item.source || 'Unknown');

  if (cfg.baseline) {
    const { score, reasoning } = await checkCredibility(title, text, source);
    return { score, factors: { baseline: score }, note: reasoning?.slice(0, 200) };
  }

  // A factor that failed (network / parse error) must abort the article so it
  // is retried on resume — recording its fallback would pollute results.
  //
  // This checked `result.failed`, which none of the four content agents ever
  // sets: on a model error they return the pattern-matcher's score tagged
  // `degraded: true`. So the guard never fired, and every rules-path
  // observation went into the corpus the likelihood ratios are estimated from,
  // labelled as though the model had produced it. The ratios in
  // data/evidenceWeights.json were measured on that mixture and the proportion
  // is unknown, because nothing recorded which channel each record came from.
  // Both are fixed here: the guard tests the flag that exists, and the channel
  // is written to the record either way so the question is answerable next time.
  const requireOk = (result, factor) => {
    if (result.failed || result.degraded) {
      throw new Error(`${factor} factor fell back to the pattern check — will retry on resume`);
    }
    return result;
  };

  const scores = {};
  // The dataset's source label is curated, not taken from the page, so it may
  // be matched by name; the live pipeline only ever matches on the address.
  if (cfg.source) scores.sourceReputation = getSourceReputation(source, null, { trustedName: true }).score;

  // The content factors are independent of one another and the deployed
  // pipeline runs them concurrently, so the evaluation does too. Results are
  // unchanged — only the wall time is — and the model gateway still caps how
  // many calls are actually in flight. A factor that fails still rejects,
  // aborting the article so it is retried on resume.
  const jobs = [];
  const merged = cfg.merged ? analyzeWriting(title, text) : null;
  if (cfg.clickbait) jobs.push(['clickbait', merged ? merged.then(w => w.clickbait) : analyzeClickbait(title)]);
  if (cfg.bias) jobs.push(['bias', merged ? merged.then(w => w.bias) : analyzeBias(title, text)]);
  if (cfg.manipulation) jobs.push(['manipulation', merged ? merged.then(w => w.manipulation) : detectManipulation(title, text)]);
  if (cfg.transparency) jobs.push(['transparency', merged ? merged.then(w => w.transparency) : assessTransparency(title, text)]);

  const settled = await Promise.all(jobs.map(([, p]) => p));
  const degraded = [];
  settled.forEach((result, i) => {
    const name = jobs[i][0];
    if (result.degraded || result.failed) degraded.push(name);
  });
  settled.forEach((result, i) => {
    const name = jobs[i][0];
    scores[name] = requireOk(result, name).score;
  });

  if (cfg.verification) {
    const v = await verifyClaims(title, text, source);
    // Match production behavior: only count verification when it found evidence.
    if (['corroborated', 'contradicted'].includes(v.status)) scores.verification = v.score;
  }

  // One pacing gap per article rather than per call, since the calls above now
  // overlap.
  await sleep(MIN_GAP_MS);

  const enabled = {
    sourceReputation: 'sourceReputation' in scores,
    clickbait: 'clickbait' in scores,
    bias: 'bias' in scores,
    manipulation: 'manipulation' in scores,
    transparency: 'transparency' in scores,
    verification: 'verification' in scores
  };
  return { score: aggregate(scores, enabled), factors: scores, degraded };
}

async function main() {
  const opts = parseArgs();
  let items = loadDataset(opts.data, opts.sample, opts.seed);
  if (opts.idsFrom) {
    const wanted = new Set(fs.readFileSync(opts.idsFrom, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l).id));
    items = items.filter(it => wanted.has(it.id));
  }
  const outFile = opts.out || path.join(__dirname, 'results',
    `${path.basename(opts.data).replace(/\.csv$/, '')}_${opts.config}_seed${opts.seed}.jsonl`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  // Resume support: skip ids already evaluated.
  const done = new Set();
  if (fs.existsSync(outFile)) {
    for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
      if (line.trim()) done.add(JSON.parse(line).id);
    }
  }

  console.log(`Config: ${opts.config} | items: ${items.length} | already done: ${done.size}`);
  console.log(`Output: ${outFile}`);

  let processed = 0, errors = 0;
  for (const item of items) {
    if (done.has(item.id)) continue;
    try {
      const started = Date.now();
      const result = await evalOne(item, CONFIGS[opts.config], opts.hideSource);
      fs.appendFileSync(outFile, JSON.stringify({
        id: item.id, label: item.label, score: result.score,
        factors: result.factors, degraded: result.degraded || [],
        ms: Date.now() - started,
        title: item.title.slice(0, 120)
      }) + '\n');
      processed++;
      if (processed % 10 === 0) console.log(`  ${processed} evaluated (${errors} errors)...`);
    } catch (err) {
      errors++;
      console.error(`  [id ${item.id}] ${err.message}`);
      if (errors >= 5 && errors > processed) {
        console.error('Too many consecutive failures — check NIM_API_KEY / rate limits. Stopping.');
        process.exit(1);
      }
      await sleep(5000);
    }
  }
  console.log(`Done. ${processed} newly evaluated, ${errors} errors. Run report.js for metrics.`);
}

main();
