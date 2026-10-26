// backend/eval/robustnessSuite.js
//
// Does Check Anything cope with the way people actually phrase things?
//
// A benchmark of tidy one-line claims measures the easy case. What people
// paste is a question ("is it true that…"), a hedge ("I heard…"), a forward
// in capitals with emoji, a sarcastic aside, a negation, an opinion wrapped
// round a fact, two claims in one breath, Tamil, Tanglish, Hindi, a typo, old
// news passed off as new. eval/suites/robustness_suite.json holds labelled
// cases of each kind; this runs every one through the same service the page
// uses and scores the answers four ways (eval/liveCheck.js): right, safe (an
// abstention listed as acceptable), missed (no verdict where one was due) and
// wrong (a verdict the wrong way).
//
// Usage:
//   node eval/robustnessSuite.js                     every case
//   node eval/robustnessSuite.js --category Tamil    one category
//   node eval/robustnessSuite.js --id q-1,ta-3       chosen cases
//   node eval/robustnessSuite.js --limit 5           the first five cases
//   node eval/robustnessSuite.js --gap 8             seconds between cases
//   node eval/robustnessSuite.js --out before        results file suffix
//   node eval/robustnessSuite.js --suite heldout     the held-out cases
//   node eval/robustnessSuite.js --suite heldout_v2 --out heldout_v2 --resume
//                                                    keep what an interrupted run finished
//   node eval/robustnessSuite.js --max-checks 10     stop after ten live checks
//
// Results are written after every case. When the model quota runs out (two
// cases in a row answered by fallback providers or failing), the run stops
// with exit code 75 and --resume carries on from there after the reset.
//
// Writes eval/results/robustness_<out>.{json,md}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { checkMessage, outcomeOf, quotaGuard, EXIT_RESUMABLE, resultsFile, keptRows, writeJson, median, pause } = require('./liveCheck');
const { deskOf, domainOf } = require('../agents/factCheckSearch');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const gapSeconds = Number(flag('--gap', 5));
const outName = flag('--out', 'latest');
const onlyCategory = flag('--category');
const onlyIds = flag('--id') ? new Set(flag('--id').split(',')) : null;
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity;
const maxChecks = flag('--max-checks') ? Number(flag('--max-checks')) : Infinity;
const resume = args.includes('--resume');

// --suite heldout runs eval/suites/heldout_suite.json: cases written after the
// system was tuned on the main suite, so its score is the honest one. Newer
// suites are named for themselves (eval/suites/heldout_v2.json).
const suiteName = flag('--suite', 'robustness');
const suiteFile = [`${suiteName}_suite.json`, `${suiteName}.json`]
  .map(f => path.join(__dirname, 'suites', f)).find(f => fs.existsSync(f));
if (!suiteFile) throw new Error(`--suite ${suiteName}: no eval/suites/${suiteName}_suite.json or ${suiteName}.json`);
const suite = JSON.parse(fs.readFileSync(suiteFile, 'utf8'));
// --part dev | sealed, against overfitting. A suite whose failures are read and fixed becomes a
// development set, and its score stops being a test of anything new. The sealed part of a suite is for
// the final measure of a release candidate only: it reports totals and nothing per case, so no one can
// read which cases failed and tune to them, and every run of it is logged (eval/results/sealed_runs.jsonl)
// with its commit, so repeated use shows. Rulings 1-120 are the development part; 121-320 were never run
// or read before the seal (2026-10-22).
const SEALED_FROM = { rulings: 120 };
const part = flag('--part');
if (part && !(suiteName in SEALED_FROM)) throw new Error(`--part: suite ${suiteName} has no sealed part`);
const sealed = part === 'sealed';
if (sealed && (resume || onlyIds || onlyCategory)) throw new Error('--part sealed runs whole, with no --resume, --id or --category');
const cases = suite.cases
  .slice(part === 'dev' ? 0 : sealed ? SEALED_FROM[suiteName] : 0, part === 'dev' ? SEALED_FROM[suiteName] : undefined)
  .filter(c => !onlyCategory || c.category === onlyCategory)
  .filter(c => !onlyIds || onlyIds.has(c.id))
  .slice(0, limit);

const jsonFile = resultsFile(`robustness_${outName}.json`);
let checks = 0;   // live checks made by this run, for eval/runDay5.js's budget

const tally = (list) => ({
  n: list.length,
  right: list.filter(r => r.outcome === 'right').length,
  safe: list.filter(r => r.outcome === 'safe').length,
  missed: list.filter(r => r.outcome === 'missed').length,
  wrong: list.filter(r => r.outcome === 'wrong').length
});

const save = (rows, stoppedBecause) => {
  const categories = [...new Set(rows.map(r => r.category))];
  const summary = {
    ranAt: new Date().toISOString(),
    suite: suiteName,
    complete: !stoppedBecause && rows.length === cases.length,
    stoppedBecause: stoppedBecause || null,
    checksThisRun: checks,
    cases: cases.length,
    overall: tally(rows),
    byCategory: Object.fromEntries(categories.map(cat => [cat, tally(rows.filter(r => r.category === cat))])),
    medianSeconds: median(rows.map(r => r.seconds))
  };
  writeJson(jsonFile, sealed ? { summary } : { summary, rows });
  const o = summary.overall;
  if (sealed) {
    fs.writeFileSync(resultsFile(`robustness_${outName}.md`), [`# Sealed test (${outName})`, '',
      `Suite ${suiteName}, cases ${SEALED_FROM[suiteName] + 1}-${suite.cases.length}. Run ${summary.ranAt.slice(0, 16).replace('T', ' ')} UTC. ${o.right}/${o.n} right, ${o.safe} acceptable, ${o.missed} missed, ${o.wrong} wrong. Totals only, by design.`, ''].join('\n'));
    return summary;
  }
  const md = [
    `# Robustness suite (${outName})`,
    '',
    `Suite ${suiteName}. Run ${summary.ranAt.slice(0, 16).replace('T', ' ')} UTC. ${o.right}/${o.n} right, ${o.safe} acceptable, ${o.missed} missed (no verdict where one was due), ${o.wrong} wrong (a verdict the wrong way).`
      + (summary.complete ? '' : ` Incomplete: ${rows.length} of ${cases.length} cases${stoppedBecause ? ` (stopped: ${stoppedBecause})` : ''}.`),
    '',
    '| Category | Cases | Right | Acceptable | Missed | Wrong |',
    '|---|---|---|---|---|---|',
    ...categories.map(cat => {
      const t = summary.byCategory[cat];
      return `| ${cat} | ${t.n} | ${t.right} | ${t.safe} | ${t.missed} | ${t.wrong} |`;
    }),
    '',
    '| Id | Input | Expected | Got | Decided by |',
    '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.id} | ${r.input.replace(/\|/g, '/').slice(0, 90)} | ${r.expected} | ${r.call} | ${r.rule || ''} |`),
    ''
  ].join('\n');
  fs.writeFileSync(resultsFile(`robustness_${outName}.md`), md);
  return summary;
};

(async () => {
  const kept = resume ? keptRows(jsonFile).filter(r => cases.some(c => c.id === r.id)) : [];
  const done = new Set(kept.map(r => r.id));
  const rows = [...kept];
  if (kept.length) console.log(`Resuming: ${kept.length} cases kept from the earlier run.`);
  const guard = quotaGuard();
  let stoppedBecause = null;

  for (const c of cases) {
    if (done.has(c.id)) continue;
    if (checks >= maxChecks) { stoppedBecause = `check budget of ${maxChecks} spent`; break; }
    // FACT_CHECK_CHANNEL=others: the channel is on, but the ruling a case is labelled from is hidden from
    // it and from the news search, so what counts is other desks' reviews of the same rumour.
    // The labelling desk is hidden whole, every review of it, not only the ruling's own address
    // (agents/factCheckSearch.js, excludedReview).
    if (process.env.FACT_CHECK_CHANNEL === 'others') {
      process.env.FACT_CHECK_EXCLUDE = (c.sources || [])
        .map((u) => String(u).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')).join('\n');
      process.env.FACT_CHECK_EXCLUDE_DESKS = [deskOf(c.ruling?.publisher), ...(c.sources || []).map(domainOf)]
        .filter(Boolean).join('\n');
    }
    // A case whose input is a link is checked as one, flagged or not (rp-41 and rp-43 were refused as text).
    const result = await checkMessage(c.input, { isUrl: Boolean(c.isUrl) || /^https?:\/\/\S+$/i.test(String(c.input).trim()) });
    checks += 1;
    const row = { ...c, ...result, outcome: outcomeOf(c, result.call) };
    rows.push(row);
    const mark = { right: '✓', safe: '~', missed: '○', wrong: '✗' }[row.outcome];
    if (sealed) process.stdout.write('.');
    else console.log(`${mark} ${c.id.padEnd(10)} ${c.category.padEnd(22)} expected ${c.expected.padEnd(19)} got ${row.call.padEnd(19)} ${row.seconds.toFixed(1)}s  ${row.detail.slice(0, 80)}${row.degraded.length ? `  [fallback: ${row.degraded.join(', ')}]` : ''}`);
    save(rows);
    if (guard.note(row)) { stoppedBecause = 'model quota: two cases in a row failed or fell back from Gemini'; break; }
    await pause(gapSeconds);
  }

  // Cases in suite order, whatever order they were run in.
  rows.sort((a, b) => cases.findIndex(c => c.id === a.id) - cases.findIndex(c => c.id === b.id));
  const summary = save(rows, stoppedBecause);
  const o = summary.overall;
  console.log(`\n${o.right}/${o.n} right, ${o.safe} safe, ${o.missed} missed, ${o.wrong} wrong${summary.complete ? '' : ` — incomplete (${rows.length}/${cases.length})`}`);
  for (const [cat, t] of Object.entries(summary.byCategory)) {
    console.log(`  ${cat.padEnd(28)} ${t.right}/${t.n}${t.missed ? `  (${t.missed} missed)` : ''}${t.wrong ? `  (${t.wrong} wrong)` : ''}`);
  }
  if (stoppedBecause) console.log(`Stopped: ${stoppedBecause}. Run again with --resume to continue.`);
  if (sealed) {
    const commit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
    const dirty = require('child_process').execSync('git status --porcelain -- ../agents ../services ../utils', { cwd: __dirname }).toString().trim() !== '';
    fs.appendFileSync(resultsFile('sealed_runs.jsonl'), `${JSON.stringify({ suite: suiteName, release: outName, commit, uncommittedChanges: dirty,
      env: { STANCE_MODEL: process.env.STANCE_MODEL || null, EVAL_HOSTED: process.env.EVAL_HOSTED || null, FACT_CHECK_CHANNEL: process.env.FACT_CHECK_CHANNEL || null, LOCAL_NLI_MODEL_DIR: process.env.LOCAL_NLI_MODEL_DIR ? path.basename(process.env.LOCAL_NLI_MODEL_DIR) : null },
      ...summary })}\n`);
    console.log(`Sealed run logged in eval/results/sealed_runs.jsonl (commit ${commit}${dirty ? ', with uncommitted changes' : ''}).`);
  }
  await require('../services/contentCheck').recordsSettled();
  process.exit(stoppedBecause ? EXIT_RESUMABLE : 0);
})();
