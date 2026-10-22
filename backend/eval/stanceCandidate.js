// backend/eval/stanceCandidate.js
//
// Should this pair model take part in the stance step, and with what thresholds? One command, one report.
//
//   node eval/stanceCandidate.js --model <export dir> --label <name> [--write-thresholds]
//
// 1. Gold probe (eval/suites/stance_probe.json): pairs labelled by hand, not by a model, covering the
//    cases models get wrong. Pairs whose pattern the synthetic training data was written from are
//    reported apart: the rest is the test of generalisation.
// 2. Held-out stance pairs (claims kept out of training, eval/results/stance_heldout_claims.json), with
//    Gemini's reading as reference. For each stance, the threshold is the lowest confidence at which the
//    lower end of the 95% Wilson interval of the model's precision reaches the target: a guarantee on
//    the measured sample, not a hand-picked number. A stance that never reaches it is switched off (its
//    readings are never "sure", so the hosted model decides, or they count as saying nothing).
// 3. Cost on a CPU: latency for one pair and a batch of 16 at the thread count the server uses, and the
//    memory the loaded model adds.
//
// Writes eval/results/stance_candidate_<label>.md, and with --write-thresholds data/stanceThresholds.json.

const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const MODEL = arg('model');
if (!MODEL) {
  console.error('usage: node eval/stanceCandidate.js --model <export dir> --label <name> [--write-thresholds]');
  process.exit(2);
}
const LABEL = arg('label', path.basename(path.resolve(MODEL)));
process.env.LOCAL_NLI_MODEL_DIR = path.resolve(MODEL);
process.env.LOCAL_NLI_THREADS = process.env.LOCAL_NLI_THREADS || '2';

const nli = require('../services/localNli');
const { wilson } = require('./metrics');

const RESULTS = path.join(__dirname, 'results');
const THRESHOLDS = path.join(__dirname, '..', 'data', 'stanceThresholds.json');
// How often a reading the model is sure of must be right, at the lower end of its 95% interval. A wrong
// "disagree" makes a true claim FAKE and a wrong "agree" makes a false one REAL; a wrong "unrelated" only
// leaves evidence uncounted.
const TARGETS = { agree: 0.93, disagree: 0.93, unrelated: 0.85 };
const MIN_SAID = 20;
const GRID = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99, 0.995, 0.998];
const FROM = { entailment: 'agree', contradiction: 'disagree', neutral: 'unrelated' };
const STANCES = ['agree', 'disagree', 'unrelated'];
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');

// The same guards the pipeline applies to our model's readings (utils/stanceGuards.js): what is
// measured here is what the checker would do.
const { asksOnly, forecastOnly, resultConflict, signatureConflict } = require('../utils/stanceGuards');
const read = async (pairs) => {
  const judged = await nli.judgePairs(pairs.map((p) => ({ premise: p.premise, hypothesis: p.hypothesis })));
  return judged.map((j, i) => {
    if (!j) return null;
    const { premise, hypothesis } = pairs[i];
    const title = String(premise).split(' — ')[0];
    let stance = FROM[j.label];
    if (stance !== 'unrelated' && asksOnly(premise)) stance = 'unrelated';
    if (stance === 'agree' && forecastOnly(premise, hypothesis)) stance = 'unrelated';
    const result = resultConflict(title, hypothesis);
    if (result === 'opposite') return { stance: 'disagree', p: 1 };
    // Ruled out: not a reading the checker would count, at any threshold.
    if (stance === 'agree' && (result || signatureConflict(premise, hypothesis))) return { stance, p: 0 };
    return { stance, p: j.scores[j.label] };
  });
};

// --adjudication <file>: pairs judged by hand where the candidate and Gemini differed; the hand
// judgement is the reference for those pairs (eval/results/stance_adjudication_*.json).
const ADJUDICATION = arg('adjudication', null);
const adjudicated = new Map();
// Matched on letters and digits only: a hand-copied headline differs in quotes and dashes.
const keyOf = (claim, headline) => `${String(claim).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}\u0000${String(headline).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`;
if (ADJUDICATION) {
  for (const p of JSON.parse(fs.readFileSync(path.resolve(ADJUDICATION), 'utf8')).pairs) adjudicated.set(keyOf(p.claim, p.headline), p.label);
}
const referenceFor = (r) => {
  const headline = String(r.premise).split(' — ')[0].trim();
  return adjudicated.get(keyOf(r.claim, headline)) || r.hosted;
};

const main = async () => {
  if (!nli.isAvailable()) throw new Error(`no model files in ${MODEL}`);
  const rssBefore = process.memoryUsage().rss;
  const lines = [`# Stance candidate: ${LABEL}`, '', `Measured ${new Date().toLocaleDateString('en-CA')} by eval/stanceCandidate.js on \`${path.relative(path.join(__dirname, '..', '..'), path.resolve(MODEL))}\`.`, ''];

  // ---- 1. gold probe
  const probe = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', 'stance_probe.json'), 'utf8')).pairs;
  const probeReads = await read(probe.map((x) => ({ premise: x.headline, hypothesis: x.claim })));
  const rssLoaded = process.memoryUsage().rss;
  const scored = probe.map((x, i) => ({ ...x, ours: probeReads[i]?.stance, p: probeReads[i]?.p || 0 }));
  const right = (list) => list.filter((x) => x.ours === x.gold).length;
  const untrained = scored.filter((x) => !x.trainedPattern);
  const trained = scored.filter((x) => x.trainedPattern);
  lines.push('## 1. Gold probe (labelled by hand)', '',
    `| pairs | right |`, '|---|---:|',
    `| all ${scored.length} | ${right(scored)} (${pct(right(scored), scored.length)}) |`,
    `| patterns not in training: ${untrained.length} | ${right(untrained)} (${pct(right(untrained), untrained.length)}) |`,
    `| patterns synthesised for training: ${trained.length} | ${right(trained)} (${pct(right(trained), trained.length)}) |`,
    `| Tamil and Hindi claims: ${scored.filter((x) => x.lang !== 'en').length} | ${right(scored.filter((x) => x.lang !== 'en'))} |`, '');
  const wrong = scored.filter((x) => x.ours !== x.gold);

  // ---- 2. held-out stance pairs, thresholds with a guarantee
  const held = new Set(JSON.parse(fs.readFileSync(path.join(RESULTS, 'stance_heldout_claims.json'), 'utf8')).claims);
  const rows = fs.readFileSync(path.join(RESULTS, 'stance_pairs.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter((r) => r && !r.noCoverage && r.provider === 'gemini' && held.has(r.id));
  const reads = await read(rows.map((r) => ({ premise: r.premise.slice(0, 220), hypothesis: r.claim })));
  const agreeingGemini = rows.filter((r, i) => reads[i]?.stance === r.hosted).length;
  // The reference from here on: Gemini's reading, or the hand judgement where one was made.
  const out = rows.map((r, i) => ({ ...r, gemini: r.hosted, hosted: referenceFor(r), ours: reads[i]?.stance, p: reads[i]?.p || 0 }));
  const overridden = out.filter((r) => r.hosted !== r.gemini).length;
  const agreeing = out.filter((r) => r.ours === r.hosted).length;
  lines.push(`## 2. Held-out stance pairs (${ADJUDICATION ? 'Gemini, corrected by hand where disputed' : 'Gemini'} as reference)`, '',
    `${out.length} pairs from ${held.size} claims never trained on; agreement with Gemini ${pct(agreeingGemini, out.length)}` +
    (ADJUDICATION ? `; with the reference corrected on ${overridden} pairs judged by hand (${path.basename(ADJUDICATION)}), ${pct(agreeing, out.length)}.` : '.'), '',
    '| stance | threshold | sure readings | precision | 95% lower bound | of Gemini\'s caught |', '|---|---:|---:|---:|---:|---:|');
  const chosen = {};
  for (const s of STANCES) {
    const total = out.filter((r) => r.hosted === s).length;
    let pick = null;
    for (const t of GRID) {
      const said = out.filter((r) => r.ours === s && r.p >= t);
      const ok = said.filter((r) => r.hosted === s).length;
      if (said.length < MIN_SAID) break;
      const { low } = wilson(ok, said.length);
      if (low >= TARGETS[s]) { pick = { t, said: said.length, ok, low, total }; break; }
    }
    chosen[s] = pick ? pick.t : 1.01;
    lines.push(pick
      ? `| ${s} | ${pick.t} | ${pick.said} | ${pct(pick.ok, pick.said)} | ${(100 * pick.low).toFixed(1)}% | ${pct(pick.ok, total)} |`
      : `| ${s} | off | – | – | below ${(100 * TARGETS[s]).toFixed(0)}% at every threshold | – |`);
  }
  const sure = (x) => x.p >= chosen[x.ours];
  const byClaim = new Map();
  for (const r of out) byClaim.set(r.id, [...(byClaim.get(r.id) || []), r]);
  const allSure = [...byClaim.values()].filter((l) => l.every(sure)).length;
  const sureRows = out.filter(sure);
  lines.push('', `Targets (lower bound): ${Object.entries(TARGETS).map(([k, v]) => `${k} ${v}`).join(', ')}; at least ${MIN_SAID} readings.`,
    `With these thresholds the model is sure of ${pct(sureRows.length, out.length)} of headlines; every headline of ${allSure} of ${byClaim.size} claims (no hosted call).`, '');

  // The probe read with the chosen thresholds: a sure mistake is the one that changes a verdict.
  const sureWrong = scored.filter((x) => sure(x) && x.ours !== x.gold);
  lines.push('## 3. Probe with these thresholds', '',
    `Sure readings: ${scored.filter(sure).length} of ${scored.length}; sure and wrong: **${sureWrong.length}**.`, '');
  if (wrong.length) {
    lines.push('| id | kind | gold | ours (p) | sure | claim / headline |', '|---|---|---|---|---|---|');
    for (const x of wrong) lines.push(`| ${x.id}${x.trainedPattern ? '*' : ''} | ${x.kind} | ${x.gold} | ${x.ours} (${x.p.toFixed(2)}) | ${sure(x) ? '**yes**' : 'no'} | ${x.claim.slice(0, 70)} / ${x.headline.slice(0, 70)} |`);
    lines.push('', '\\* a pattern synthesised for training.', '');
  }

  // ---- 4. cost
  const one = probe[0];
  const batch = probe.slice(0, 16).map((x) => ({ premise: x.headline, hypothesis: x.claim }));
  const time = async (fn, runs = 5) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < runs; i++) await fn(); return Number(process.hrtime.bigint() - t0) / 1e6 / runs; };
  const msOne = await time(() => nli.judgePair(one.headline, one.claim));
  const msBatch = await time(() => nli.judgePairs(batch));
  const fileMb = fs.statSync(path.join(path.resolve(MODEL), 'onnx', 'model_quantized.onnx')).size / 2 ** 20;
  lines.push('## 4. Cost on this CPU', '',
    `Model file ${fileMb.toFixed(1)} MB (GitHub refuses files over 100 MB). Memory added once loaded: about ${Math.round((rssLoaded - rssBefore) / 2 ** 20)} MB.`,
    `Latency with ${process.env.LOCAL_NLI_THREADS} threads: one pair ${msOne.toFixed(0)} ms, a batch of 16 ${msBatch.toFixed(0)} ms.`, '');

  const report = lines.join('\n');
  const file = path.join(RESULTS, `stance_candidate_${LABEL}.md`);
  fs.writeFileSync(file, report);
  console.log(report);
  console.log(`\nwrote ${file}`);
  if (process.argv.includes('--write-thresholds')) {
    const prev = JSON.parse(fs.readFileSync(THRESHOLDS, 'utf8'));
    fs.writeFileSync(THRESHOLDS, `${JSON.stringify({ about: prev.about.replace(/ Placeholder.*$/, '') + ` Set by eval/stanceCandidate.js for ${LABEL} on ${new Date().toLocaleDateString('en-CA')}; 1.01 means the stance is off.`, ...chosen }, null, 2)}\n`);
    console.log(`wrote ${THRESHOLDS}: ${JSON.stringify(chosen)}`);
  }
  process.exit(0);
};

main().catch((err) => { console.error(err.message); process.exit(1); });
