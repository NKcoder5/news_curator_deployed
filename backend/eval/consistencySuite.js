// backend/eval/consistencySuite.js
//
// Does the same claim get the same answer however it is put?
//
// eval/suites/consistency.json holds twelve claims, each written four ways: a
// plain English statement, an English question, Tamil or Hindi, and a Tanglish
// forward. A reader who asks in Tamil and a reader who asks in English about
// the same claim should be told the same thing. Measured per claim:
//
//   identical   all four phrasings got the same call
//   allRight    all four got the expected (or an acceptable) answer
//   filed       with the claim memory on, all four were filed under one claim
//               record (services/claimMemory.js), so the record's history and
//               re-checks cover every way the claim travels
//
// The memory ablation runs the suite twice, in separate processes so the
// half-hour judgement cache (utils/nvidiaNimApi.js) is not shared between
// arms: with the memory, and with --no-memory, where the database is never
// connected and recordCheck stores nothing (it returns null when
// disconnected). Consistency and latency are compared between the two.
//
// The memory arm never touches the real claim memory. It connects to a
// separate evaluation database (default news_curator_eval), which starts
// empty, so "filed together" measures recognition and nothing else; at the end
// of a complete run the records it made there are deleted (--keep to inspect).
//
// Usage:
//   node eval/consistencySuite.js                 with the claim memory
//   node eval/consistencySuite.js --no-memory     without it
//   --out <name>     results file suffix (default with_memory / no_memory)
//   --db <name>      evaluation database for the memory arm
//   --keep           leave the memory arm's records in the evaluation database
//   --id k-1,k-2     chosen claims        --limit N   the first N claims
//   --gap s          seconds between messages (default 5)
//   --resume         keep what an interrupted run finished
//   --max-checks N   stop after N live checks
//
// Writes eval/results/consistency_<out>.{json,md}. Exit code 75 when stopped
// early by the quota or the check budget; --resume carries on.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ClaimRecord = require('../models/ClaimRecord');
const ClaimAssessment = require('../models/ClaimAssessment');
const { fingerprint } = require('../services/claimMemory');
const { checkMessage, outcomeOf, quotaGuard, EXIT_RESUMABLE, resultsFile, keptRows, writeJson, median, quantile, pause } = require('./liveCheck');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const withMemory = !args.includes('--no-memory');
const outName = flag('--out', withMemory ? 'with_memory' : 'no_memory');
const dbName = flag('--db', 'news_curator_eval');
const keep = args.includes('--keep');
const gapSeconds = Number(flag('--gap', 5));
const onlyIds = flag('--id') ? new Set(flag('--id').split(',')) : null;
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity;
const maxChecks = flag('--max-checks') ? Number(flag('--max-checks')) : Infinity;
const resume = args.includes('--resume');

const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', 'consistency.json'), 'utf8'));
const claims = suite.claims.filter(c => !onlyIds || onlyIds.has(c.id)).slice(0, limit);
const jsonFile = resultsFile(`consistency_${outName}.json`);
const rowKey = (r) => `${r.claimId}|${r.style}`;
let checks = 0;   // live checks made by this run, for eval/runDay5.js's budget

/** The claim records a phrasing was filed under: from the report, or found by the message's fingerprint. */
const filedUnder = async (result, input) => {
  if (result.memory?.claims?.length) {
    return { claimIds: result.memory.claims.map(c => c.claimId), assessmentId: result.memory.assessmentId || null };
  }
  if (!withMemory || mongoose.connection.readyState !== 1) return null;
  const doc = await ClaimAssessment.findOne({ messageHash: fingerprint(input) }).sort({ createdAt: -1 }).select('claimIds').lean();
  return doc ? { claimIds: doc.claimIds.map(String), assessmentId: String(doc._id) } : null;
};

const summarise = (rows, stoppedBecause) => {
  const perClaim = claims.map(c => {
    const own = rows.filter(r => r.claimId === c.id);
    const calls = own.map(r => r.call);
    const leads = own.map(r => r.filed?.claimIds?.[0] || null);
    return {
      id: c.id, claim: c.claim, expected: c.expected, phrasings: own.length,
      calls: Object.fromEntries(own.map(r => [r.style, r.call])),
      identical: own.length === c.phrasings.length && new Set(calls).size === 1,
      allRight: own.length === c.phrasings.length && own.every(r => r.outcome === 'right' || r.outcome === 'safe'),
      wrong: own.filter(r => r.outcome === 'wrong').length,
      filed: withMemory ? {
        together: own.length === c.phrasings.length && leads.every(Boolean) && new Set(leads).size === 1,
        records: new Set(leads.filter(Boolean)).size,
        unfiled: leads.filter(x => !x).length
      } : null
    };
  });
  const finished = perClaim.filter(p => p.phrasings === claims.find(c => c.id === p.id).phrasings.length);
  const styles = [...new Set(rows.map(r => r.style))];
  const seconds = rows.map(r => r.seconds);
  return {
    ranAt: new Date().toISOString(),
    memory: withMemory ? `on (database ${dbName})` : 'off',
    complete: !stoppedBecause && finished.length === claims.length,
    stoppedBecause: stoppedBecause || null,
    checksThisRun: checks,
    claims: claims.length,
    claimsFinished: finished.length,
    identicalCalls: `${finished.filter(p => p.identical).length}/${finished.length}`,
    allPhrasingsRight: `${finished.filter(p => p.allRight).length}/${finished.length}`,
    filedTogether: withMemory ? `${finished.filter(p => p.filed.together).length}/${finished.length}` : 'memory off',
    phrasings: {
      n: rows.length,
      right: rows.filter(r => r.outcome === 'right').length,
      safe: rows.filter(r => r.outcome === 'safe').length,
      missed: rows.filter(r => r.outcome === 'missed').length,
      wrong: rows.filter(r => r.outcome === 'wrong').length
    },
    byStyle: Object.fromEntries(styles.map(s => {
      const own = rows.filter(r => r.style === s);
      return [s, { n: own.length, rightOrSafe: own.filter(r => r.outcome === 'right' || r.outcome === 'safe').length, wrong: own.filter(r => r.outcome === 'wrong').length }];
    })),
    seconds: { median: median(seconds), p90: quantile(seconds, 0.9) },
    perClaim
  };
};

const save = (rows, stoppedBecause) => {
  const summary = summarise(rows, stoppedBecause);
  writeJson(jsonFile, { summary, rows });
  const md = [
    `# Consistency suite (${outName})`,
    '',
    `Run ${summary.ranAt.slice(0, 16).replace('T', ' ')} UTC, claim memory ${summary.memory}. ${summary.claimsFinished} of ${summary.claims} claims finished`
      + `${summary.stoppedBecause ? ` (stopped: ${summary.stoppedBecause})` : ''}.`,
    '',
    `- Same call in all four phrasings: ${summary.identicalCalls}`,
    `- All four phrasings right or acceptable: ${summary.allPhrasingsRight}`,
    `- All four filed under one claim record: ${summary.filedTogether}`,
    `- Phrasings: ${summary.phrasings.right} right, ${summary.phrasings.safe} acceptable, ${summary.phrasings.missed} missed, ${summary.phrasings.wrong} wrong of ${summary.phrasings.n}`,
    `- Seconds per check: median ${summary.seconds.median ?? '–'}, 90th percentile ${summary.seconds.p90 ?? '–'}`,
    '',
    '| Claim | Expected | Plain | Question | Tamil/Hindi | Forward | Same call | Filed together |',
    '|---|---|---|---|---|---|---|---|',
    ...summary.perClaim.map(p => `| ${p.id} ${p.claim.replace(/\|/g, '/')} | ${p.expected} | ${p.calls.plain || ''} | ${p.calls.question || ''} | ${p.calls.native || ''} | ${p.calls.forward || ''} | ${p.identical ? 'yes' : 'no'} | ${p.filed ? (p.filed.together ? 'yes' : `no (${p.filed.records} records${p.filed.unfiled ? `, ${p.filed.unfiled} unfiled` : ''})`) : '–'} |`),
    ''
  ].join('\n');
  fs.writeFileSync(resultsFile(`consistency_${outName}.md`), md);
  return summary;
};

/** Delete what this run stored in the evaluation database, and nothing else. */
const cleanUp = async (rows) => {
  const assessmentIds = rows.map(r => r.filed?.assessmentId).filter(Boolean);
  const recordIds = [...new Set(rows.flatMap(r => r.filed?.claimIds || []))];
  const a = await ClaimAssessment.deleteMany({ _id: { $in: assessmentIds } });
  const r = await ClaimRecord.deleteMany({ _id: { $in: recordIds }, origin: 'eval' });
  console.log(`Evaluation database ${dbName}: removed ${a.deletedCount} assessments and ${r.deletedCount} claim records made by this run.`);
};

(async () => {
  if (withMemory) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    const liveDb = (uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/) || [])[1] || 'test';
    if (dbName === liveDb) {
      console.error(`--db ${dbName} is the live claim memory. Choose a separate evaluation database.`);
      process.exit(2);
    }
    await mongoose.connect(uri, { dbName });
  }

  const wanted = new Set(claims.flatMap(c => c.phrasings.map(p => `${c.id}|${p.style}`)));
  const kept = resume ? keptRows(jsonFile).filter(r => wanted.has(rowKey(r))) : [];
  const done = new Set(kept.map(rowKey));
  const rows = [...kept];
  if (kept.length) console.log(`Resuming: ${kept.length} phrasings kept from the earlier run.`);
  const guard = quotaGuard();
  let stoppedBecause = null;

  outer:
  for (const c of claims) {
    for (const p of c.phrasings) {
      if (done.has(`${c.id}|${p.style}`)) continue;
      if (checks >= maxChecks) { stoppedBecause = `check budget of ${maxChecks} spent`; break outer; }
      const result = await checkMessage(p.input);
      checks += 1;
      const row = {
        claimId: c.id, style: p.style, language: p.language, input: p.input,
        expected: c.expected, alsoAcceptable: c.alsoAcceptable || [],
        ...result, memory: undefined,
        filed: await filedUnder(result, p.input),
        outcome: outcomeOf(c, result.call)
      };
      rows.push(row);
      console.log(`${c.id.padEnd(5)} ${p.style.padEnd(8)} expected ${c.expected.padEnd(14)} got ${row.call.padEnd(14)} ${row.seconds.toFixed(1)}s${row.filed ? `  record ${String(row.filed.claimIds[0]).slice(-6)}` : ''}${row.degraded.length ? `  [fallback: ${row.degraded.join(', ')}]` : ''}`);
      save(rows);
      if (guard.note(row)) { stoppedBecause = 'model quota: two checks in a row failed or fell back from Gemini'; break outer; }
      await pause(gapSeconds);
    }
  }

  const order = (r) => claims.findIndex(c => c.id === r.claimId) * 10 + ['plain', 'question', 'native', 'forward'].indexOf(r.style);
  rows.sort((a, b) => order(a) - order(b));
  const summary = save(rows, stoppedBecause);
  console.log(`\nSame call in all phrasings ${summary.identicalCalls}; all right ${summary.allPhrasingsRight}; filed together ${summary.filedTogether}; median ${summary.seconds.median} s`);
  if (withMemory) {
    if (summary.complete && !keep) await cleanUp(rows);
    // The last check's record is written after its answer; wait for it.
    await require('../services/contentCheck').recordsSettled();
    await mongoose.disconnect();
  }
  if (stoppedBecause) console.log(`Stopped: ${stoppedBecause}. Run again with --resume to continue.`);
  process.exit(stoppedBecause ? EXIT_RESUMABLE : 0);
})().catch(err => { console.error(err); process.exit(1); });
