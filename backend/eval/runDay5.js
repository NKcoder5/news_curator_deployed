// backend/eval/runDay5.js
//
// One command for the live evaluation of 13 October: held-out suite v2, the
// consistency suite with and without the claim memory, and the model-assisted
// claim matching, run one after another with gaps, then the rule record
// (data/ruleReliability.json) and the calibration report regenerated from what
// they produced, and a summary written.
//
// Built to be run after the Gemini quota resets (07:00 UTC) and to survive it
// running out again. Each suite runs in its own process (so the half-hour
// judgement cache is never shared between the two memory arms), writes its
// results case by case, and stops with exit code 75 when two cases in a row
// are answered by fallback models. This runner then stops too, writes the
// summary of what it has, and exits 75; running it again resumes every suite
// where it stopped. --budget caps the live checks one invocation may spend.
//
// Order: the cheap claim matching first, then held-out v2 (the headline
// number), then the two consistency arms.
//
// Usage:
//   node eval/runDay5.js                    everything
//   node eval/runDay5.js --dry-run          print the plan, run nothing
//   node eval/runDay5.js --budget 60        at most 60 live checks this time
//   node eval/runDay5.js --gap 6 --step-gap 120
//                                           seconds between checks / between suites
//   node eval/runDay5.js --steps heldout,memory
//                                           only these (matching, heldout, memory,
//                                           nomemory, reliability, calibration)
//   node eval/runDay5.js --tag smoke --limit 1
//                                           results named smoke_*, first case or
//                                           claim of each suite only; the rule
//                                           record and calibration are not touched
//
// Writes eval/results/<tag>day5_summary.{json,md}.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dryRun = args.includes('--dry-run');
const budget = flag('--budget') ? Number(flag('--budget')) : Infinity;
const gap = flag('--gap', '6');
const stepGap = Number(flag('--step-gap', 120));
const tag = flag('--tag') ? `${flag('--tag')}_` : '';
const limit = flag('--limit');
const RESULTS = path.join(__dirname, 'results');
const EXIT_RESUMABLE = 75;

const heldoutV2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', 'heldout_v2.json'), 'utf8'));
const consistency = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', 'consistency.json'), 'utf8'));
const limited = (n) => (limit ? Math.min(n, Number(limit)) : n);

const STEPS = [
  { id: 'matching', live: false, script: 'claimMatching.js', args: ['--suite', 'claim_matching_heldout', '--with-model', '--max-model-calls', '15'],
    file: 'claim_matching_heldout_with_model.json', checks: 0, skipWithTag: true },
  { id: 'heldout', live: true, script: 'robustnessSuite.js', args: ['--suite', 'heldout_v2', '--out', `${tag}heldout_v2`, '--resume', '--gap', gap, ...(limit ? ['--limit', limit] : [])],
    file: `robustness_${tag}heldout_v2.json`, checks: limited(heldoutV2.cases.length) },
  { id: 'memory', live: true, script: 'consistencySuite.js', args: ['--out', `${tag}with_memory`, '--resume', '--gap', gap, ...(limit ? ['--limit', limit] : [])],
    file: `consistency_${tag}with_memory.json`, checks: limited(consistency.claims.length) * 4 },
  { id: 'nomemory', live: true, script: 'consistencySuite.js', args: ['--no-memory', '--out', `${tag}no_memory`, '--resume', '--gap', gap, ...(limit ? ['--limit', limit] : [])],
    file: `consistency_${tag}no_memory.json`, checks: limited(consistency.claims.length) * 4 },
  { id: 'reliability', live: false, script: 'ruleReliability.js', args: [], skipWithTag: true },
  { id: 'calibration', live: false, script: 'calibrationReport.js', args: [], file: 'calibration.json', skipWithTag: true }
];
const chosen = flag('--steps') ? new Set(flag('--steps').split(',')) : null;
const plan = STEPS.filter(s => (!chosen || chosen.has(s.id)) && !(tag && s.skipWithTag));

const readResults = (file) => {
  const full = file && path.join(RESULTS, file);
  return full && fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : null;
};

const run = (step, extra) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [path.join(__dirname, step.script), ...step.args, ...extra],
    { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  child.on('close', (code) => resolve({ code, seconds: Math.round((Date.now() - started) / 1000) }));
});

const pause = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

const summarise = (log, stoppedAt) => {
  const heldout = readResults(`robustness_${tag}heldout_v2.json`)?.summary || null;
  const withMemory = readResults(`consistency_${tag}with_memory.json`)?.summary || null;
  const noMemory = readResults(`consistency_${tag}no_memory.json`)?.summary || null;
  const matching = readResults('claim_matching_heldout_with_model.json')?.summary || null;
  const calibration = tag ? null : readResults('calibration.json')?.groups?.['held-out'] || null;
  const strip = (s) => s && { complete: s.complete, identicalCalls: s.identicalCalls, allPhrasingsRight: s.allPhrasingsRight,
    filedTogether: s.filedTogether, phrasings: s.phrasings, seconds: s.seconds };
  const summary = {
    ranAt: new Date().toISOString(), tag: tag || null, stoppedAt: stoppedAt || null, steps: log,
    heldoutV2: heldout && { complete: heldout.complete, overall: heldout.overall, byCategory: heldout.byCategory, medianSeconds: heldout.medianSeconds },
    consistency: { withMemory: strip(withMemory), noMemory: strip(noMemory) },
    claimMatchingWithModel: matching,
    heldOutCalibration: calibration && { coverage: calibration.coverage, accuracyWhenAnswered: calibration.accuracyWhenAnswered, wrongDirection: calibration.wrongDirection }
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `${tag}day5_summary.json`), JSON.stringify(summary, null, 2));
  const o = heldout?.overall;
  const ci = (x) => (x?.n ? `${x.k}/${x.n} (${Math.round(100 * x.low)}–${Math.round(100 * x.high)}%)` : '–');
  const md = [
    `# Live evaluation, ${summary.ranAt.slice(0, 10)}${tag ? ` (${tag.slice(0, -1)})` : ''}`,
    '',
    stoppedAt ? `Stopped at step "${stoppedAt}". Run eval/runDay5.js again to resume.` : 'All planned steps finished.',
    '',
    '| Step | Exit | Seconds | Live checks |',
    '|---|---|---|---|',
    ...log.map(l => `| ${l.step} | ${l.code} | ${l.seconds} | ${l.checks ?? ''} |`),
    '',
    `Held-out v2: ${o ? `${o.right}/${o.n} right, ${o.safe} acceptable, ${o.missed} missed, ${o.wrong} wrong${heldout.complete ? '' : ' (incomplete)'}` : 'not run'}.`,
    '',
    '| Consistency | Same call in all phrasings | All phrasings right | Filed under one record | Median s | 90th pct s |',
    '|---|---|---|---|---|---|',
    ...[['memory on', withMemory], ['memory off', noMemory]].map(([name, s]) => (s
      ? `| ${name}${s.complete ? '' : ' (incomplete)'} | ${s.identicalCalls} | ${s.allPhrasingsRight} | ${s.filedTogether} | ${s.seconds?.median ?? '–'} | ${s.seconds?.p90 ?? '–'} |`
      : `| ${name} | not run | | | | |`)),
    '',
    `Claim matching on held-out pairs, model on ambiguous pairs: ${matching ? `${matching.exact}/${matching.pairs} exact, ${matching.falseMerges} false merges, ${matching.variantsMerged} variants merged, ${matching.modelConsulted} model calls` : 'not run'}.`,
    '',
    calibration ? `Held-out pooled: coverage ${ci(calibration.coverage)}, accuracy when answered ${ci(calibration.accuracyWhenAnswered)}, wrong direction ${ci(calibration.wrongDirection)}.` : '',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(RESULTS, `${tag}day5_summary.md`), md);
  console.log(`\n${md}`);
};

(async () => {
  const planned = plan.reduce((s, st) => s + (st.checks || 0), 0);
  console.log(`Plan: ${plan.map(s => s.id).join(' -> ')}; at most ${planned} live checks${Number.isFinite(budget) ? `, budget ${budget}` : ''}. Steps already done are skipped case by case.`);
  if (dryRun) {
    for (const s of plan) console.log(`  node eval/${s.script} ${s.args.join(' ')}`);
    process.exit(0);
  }

  const log = [];
  let used = 0;
  for (const [index, step] of plan.entries()) {
    const extra = [];
    if (step.live && Number.isFinite(budget)) {
      const remaining = budget - used;
      if (remaining <= 0) { log.push({ step: step.id, code: 'skipped', seconds: 0, checks: 0 }); summarise(log, step.id); process.exit(EXIT_RESUMABLE); }
      extra.push('--max-checks', String(remaining));
    }
    console.log(`\n=== ${step.id}: node eval/${step.script} ${[...step.args, ...extra].join(' ')}`);
    const { code, seconds } = await run(step, extra);
    const checks = step.live ? (readResults(step.file)?.summary?.checksThisRun ?? null) : null;
    used += checks || 0;
    log.push({ step: step.id, code, seconds, checks });
    if (code === EXIT_RESUMABLE || code !== 0) {
      summarise(log, step.id);
      process.exit(code === EXIT_RESUMABLE ? EXIT_RESUMABLE : 1);
    }
    if (step.live && index < plan.length - 1) await pause(stepGap);
  }
  summarise(log, null);
  process.exit(0);
})();
