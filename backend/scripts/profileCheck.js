#!/usr/bin/env node
//
// Where does a Check Anything check spend its time?
//
// A check took 8-15 s on 11 Oct and 25-50 s a day later, and nobody could say
// which part had grown. This runs the real check (services/contentCheck.js) on
// the messages given and prints a timeline of everything it waited on: each
// stage, each evidence channel, every model call with its provider, model and
// time (or that the judgement cache answered), every HTTP request with its
// status — a 429 or 503 is a retry the reader waited through — and every
// gateway warning ("model busy, retrying in 2000ms").
//
// Nothing in the pipeline is changed to do this. Each module's exports are
// wrapped before the modules that use them are loaded, and axios is wrapped so
// every request is timed whichever module made it.
//
// The claim memory is real work on the critical path, so by default the check
// writes to a throwaway copy of it: the claim records and assessments are
// copied into a scratch database, the checks run against the copy, and the
// copy is dropped at the end. The shared database is only read.
//
// Usage:
//   node scripts/profileCheck.js "message one" "message two"
//   node scripts/profileCheck.js --repeat 2 --gap 20 "message"
//   node scripts/profileCheck.js --db none "message"      # no claim memory
//   node scripts/profileCheck.js --db live "message"      # the real memory, filed as 'eval'
//   node scripts/profileCheck.js --out run.json "message" # also keep the raw timings
//
// Each message is checked with trigger 'eval', so no re-check is ever booked.
// Live checks spend shared model quota: keep the list short and the gap long.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const parseArgs = (argv) => {
  const opts = { repeat: 1, gap: 20, db: 'copy', out: null, messages: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repeat') opts.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--gap') opts.gap = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--db') opts.db = String(argv[++i] || 'copy');
    else if (a === '--out') opts.out = argv[++i];
    else opts.messages.push(a);
  }
  return opts;
};

/* ---------------------------------------------------------------------------
   Instrumentation, installed before the pipeline is loaded
--------------------------------------------------------------------------- */

let t0 = Date.now();
let current = null;          // the record of the check in progress
const now = () => Date.now() - t0;
const record = (kind, entry) => { if (current) current[kind].push(entry); };

// Every HTTP request, whichever module made it.
const axios = require('axios');
const describeRequest = (url, config = {}) => {
  try {
    const u = new URL(url);
    const q = config.params?.q || config.params?.query || u.searchParams.get('q') || '';
    const model = (u.pathname.match(/models\/([^:/]+)/) || [])[1];
    return { host: u.hostname, what: model ? `model ${model}` : q ? `q="${String(q).slice(0, 70)}"` : u.pathname.slice(0, 60) };
  } catch (_) {
    return { host: String(url).slice(0, 40), what: '' };
  }
};
for (const method of ['get', 'post']) {
  const original = axios[method].bind(axios);
  axios[method] = async (url, ...rest) => {
    const config = (method === 'get' ? rest[0] : rest[1]) || {};
    const entry = { method, ...describeRequest(url, config), start: now() };
    if (method === 'post' && rest[0]?.model) entry.what = `model ${rest[0].model}`;
    try {
      const response = await original(url, ...rest);
      Object.assign(entry, { ms: now() - entry.start, status: response.status });
      return response;
    } catch (err) {
      Object.assign(entry, { ms: now() - entry.start, status: err.response?.status || err.code || 'error' });
      throw err;
    } finally {
      record('http', entry);
    }
  };
}

// Gateway and fetcher warnings: retries, "model busy", fallbacks, quota.
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    record('log', { at: now(), level, text: args.map(String).join(' ').slice(0, 200) });
    if (!current) original(...args);
  };
}

// The record of model calls the gateway keeps for each check.
const runContext = require('../utils/runContext');
const originalRun = runContext.runWithContext;
runContext.runWithContext = (fn) => originalRun(() => {
  if (current) current.context = runContext.currentContext();
  return fn();
});

/** Replace module exports with timed versions; names that do not exist are skipped. */
const wrap = (modulePath, names, kind = 'span') => {
  const mod = require(modulePath);
  for (const name of names) {
    const fn = mod[name];
    if (typeof fn !== 'function') continue;
    mod[name] = function timed(...args) {
      const entry = { name, start: now() };
      if (kind === 'model') entry.label = args[1]?.label || 'model call';
      const done = (extra) => { Object.assign(entry, { end: now(), ...extra }); record(kind === 'model' ? 'models' : 'spans', entry); };
      let result;
      try {
        result = fn.apply(this, args);
      } catch (err) {
        done({ error: err.message });
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then(v => { done(); return v; }, err => { done({ error: err.message }); throw err; });
      }
      done();
      return result;
    };
  }
  return mod;
};

// Leaves first, so each consumer destructures the timed version.
wrap('../utils/nvidiaNimApi', ['callNimApiJson'], 'model');
wrap('../services/claimMatchJudge', ['sameClaim']);
wrap('../services/claimMemory', ['recordCheck', 'lookupClaims', 'commitCheck', 'recentResult']);
wrap('../agents/claimVerificationAgent', ['verifyClaims']);
wrap('../agents/referenceCheck', ['checkPremises']);
wrap('../agents/factCheckSearch', ['checkFactCheckers']);
wrap('../agents/currentCoverage', ['checkCurrentCoverage']);
wrap('../agents/clickbaitAgent', ['analyzeClickbait']);
wrap('../agents/biasAgent', ['analyzeBias']);
wrap('../agents/manipulationAgent', ['detectManipulation']);
wrap('../agents/transparencyAgent', ['assessTransparency']);
wrap('../agents/trustAnalysisAgent', ['analyzeTrust']);
wrap('../agents/inputUnderstanding', ['understandInput']);
wrap('../agents/verdictTranslation', ['translateVerdict']);
wrap('../services/decisionExplainer', ['explainDecision']);
const { runContentCheck } = require('../services/contentCheck');
const mongoose = require('mongoose');

/* ---------------------------------------------------------------------------
   Reporting
--------------------------------------------------------------------------- */

const s = (ms) => (ms === undefined || ms === null ? '   -  ' : `${(ms / 1000).toFixed(1).padStart(5)}s`);
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

// What a verdict rested on, so a before/after difference can be traced to the
// evidence rather than guessed at.
const verdictOf = (r) => ({
  call: r.call,
  rule: r.decision?.rule,
  cached: Boolean(r.cached),
  claims: (r.evidence?.perClaim || []).map(c => ({ claim: c.claim, verdict: c.verdict, for: c.independentSupport, against: c.independentContradiction })),
  factChecks: r.factChecks?.status,
  currentCoverage: `${r.currentCoverage?.status}${r.currentCoverage?.counted ? ` (counted: ${r.currentCoverage.counted})` : ''}`,
  premises: r.premiseCheck?.status,
  writing: {
    transparency: r.factors?.find(f => f.id === 'transparency')?.score ?? null,
    persuasion: (r.factors?.find(f => f.id === 'manipulation')?.detail?.techniques || []).length,
    degraded: r.degradedFactors || []
  },
  unread: r.unreadChannels || []
});

const printCheck = (c) => {
  console.log(`\n# ${c.message}`);
  if (c.error) {
    console.log(`  FAILED after ${s(c.total).trim()}: ${c.error}`);
  } else {
    const v = c.verdict;
    console.log(`  ${v.call} | ${v.rule} | ${s(c.total).trim()}${v.cached ? ' | served from a check made minutes ago' : ''}`);
    for (const pc of v.claims) console.log(`    claim: ${pc.claim}  [${pc.verdict}, for ${pc.for}, against ${pc.against}]`);
    console.log(`    fact-checks ${v.factChecks} | this week ${v.currentCoverage} | reference ${v.premises} | transparency ${v.writing.transparency}, persuasion ${v.writing.persuasion}${v.writing.degraded.length ? `, degraded ${v.writing.degraded.join(',')}` : ''}${v.unread.length ? ` | not read in time: ${v.unread.join(',')}` : ''}`);
  }

  console.log('  stages and channels (start -> end, duration; after the response is marked *):');
  for (const sp of [...c.spans].sort((a, b) => a.start - b.start)) {
    const late = sp.end > c.total ? ' *' : '';
    console.log(`    ${sp.name.padEnd(22)} ${s(sp.start)} -> ${s(sp.end)}  ${s(sp.end - sp.start)}${sp.error ? `  error: ${sp.error}` : ''}${late}`);
  }
  if (c.channels.length) {
    console.log('  channel events as the page saw them (landed at):');
    for (const ch of c.channels) console.log(`    ${String(ch.id).padEnd(22)} ${s(ch.at)}  (${s(ch.ms).trim()} after it started)`);
  }
  console.log('  model calls (gateway record: provider/model; ms includes queueing and retries):');
  const recorded = [...(c.context?.calls || [])];
  for (const m of [...c.models].sort((a, b) => a.start - b.start)) {
    const i = recorded.findIndex(r => r.label === m.label);
    const r = i >= 0 ? recorded.splice(i, 1)[0] : null;
    const who = r ? (r.cached ? 'judgement cache' : `${r.provider}/${r.model}`) : (m.error ? 'failed' : '?');
    console.log(`    ${m.label.padEnd(30)} ${s(m.start)} -> ${s(m.end)}  ${s(m.end - m.start)}  ${who}${m.error ? `  error: ${m.error.slice(0, 80)}` : ''}`);
  }
  const slow = c.http.filter(h => h.ms >= 1500 || typeof h.status !== 'number' || h.status >= 400);
  const byHost = {};
  for (const h of c.http) {
    const k = h.host;
    byHost[k] = byHost[k] || { n: 0, ms: 0, failed: 0 };
    byHost[k].n++; byHost[k].ms += h.ms || 0;
    if (typeof h.status !== 'number' || h.status >= 400) byHost[k].failed++;
  }
  console.log(`  HTTP: ${c.http.length} requests`);
  for (const [host, x] of Object.entries(byHost)) console.log(`    ${host.padEnd(40)} ${String(x.n).padStart(3)} requests, ${s(x.ms).trim()} summed${x.failed ? `, ${x.failed} failed` : ''}`);
  if (slow.length) {
    console.log('  slow or failed requests (>= 1.5 s, or not 2xx):');
    for (const h of slow.sort((a, b) => a.start - b.start)) console.log(`    ${s(h.start)} ${s(h.ms)}  ${String(h.status).padEnd(12)} ${h.host} ${h.what}`);
  }
  const notes = c.log.filter(l => /retry|busy|rate limited|quota|falling through|answered after|switched|timed out|not read|could not/i.test(l.text));
  if (notes.length) {
    console.log('  gateway and fetcher warnings:');
    for (const l of notes) console.log(`    ${s(l.at)}  ${l.text}`);
  }
};

const summarise = (checks) => {
  const ok = checks.filter(c => !c.error);
  const totals = ok.map(c => c.total);
  console.log('\n== Summary ==');
  console.log(`  checks ${checks.length} (${ok.length} answered), median ${s(pct(totals, 50)).trim()}, p95 ${s(pct(totals, 95)).trim()}, max ${s(totals.length ? Math.max(...totals) : null).trim()}`);
  const names = [...new Set(ok.flatMap(c => c.spans.map(sp => sp.name)))];
  console.log('  median duration per stage across checks:');
  for (const name of names) {
    const ds = ok.map(c => c.spans.filter(sp => sp.name === name).reduce((m, sp) => Math.max(m, sp.end - sp.start), 0)).filter(d => d > 0);
    if (ds.length) console.log(`    ${name.padEnd(22)} ${s(pct(ds, 50))}  (max ${s(Math.max(...ds)).trim()}, n ${ds.length})`);
  }
  for (const c of checks) console.log(`  ${s(c.total)}  ${c.error ? 'FAILED' : `${c.verdict.call} / ${c.verdict.rule}${c.verdict.cached ? ' (cached)' : ''}`}  ${c.message}`);
};

/* ---------------------------------------------------------------------------
   Database: a throwaway copy of the claim memory, unless told otherwise
--------------------------------------------------------------------------- */

const MEMORY_COLLECTIONS = ['claimrecords', 'claimassessments'];
let scratchDb = null;

const connect = async (mode) => {
  if (mode === 'none') return null;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('No MONGO_URI in .env.');
  if (mode === 'live') {
    await mongoose.connect(uri);
    return null;
  }
  const scratch = `profile_${process.pid}_${Date.now().toString(36)}`;
  await mongoose.connect(uri, { dbName: scratch });
  scratchDb = scratch;
  const client = mongoose.connection.getClient();
  const source = client.db();            // the database named in the URI
  for (const name of MEMORY_COLLECTIONS) {
    const docs = await source.collection(name).find({}).toArray();
    if (docs.length) await mongoose.connection.db.collection(name).insertMany(docs);
  }
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
  return scratch;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.messages.length) {
    console.error('Give at least one message to check.');
    process.exit(2);
  }
  const scratch = await connect(opts.db);
  if (scratch) console.log(`Claim memory: a copy in scratch database "${scratch}", dropped at the end.`);

  const checks = [];
  let first = true;
  for (let round = 0; round < opts.repeat; round++) {
    for (const message of opts.messages) {
      if (!first && opts.gap) await sleep(opts.gap * 1000);
      first = false;
      t0 = Date.now();
      current = { message, round, spans: [], models: [], http: [], log: [], channels: [], context: null };
      try {
        const result = await runContentCheck({ text: message }, {
          trigger: 'eval',
          onStage: (e) => current.channels.push({ id: `stage:${e.id}`, at: now(), ms: null }),
          onChannel: (e) => current.channels.push({ id: e.id, at: now(), ms: e.ms })
        });
        current.total = now();
        current.verdict = verdictOf(result);
        current.memory = result.memory ? { timesSeen: result.memory.claims?.map(c => c.timesSeen), previous: result.memory.claims?.map(c => c.previous?.call || null) } : null;
      } catch (err) {
        current.total = now();
        current.error = err.payload?.error || err.message;
      }
      // Work the check left running after it answered (a deferred write) is
      // still timed: wait for it before the record is closed.
      const done = current;
      await sleep(Math.min(5000, opts.gap * 1000 || 1000));
      current = null;
      printCheck(done);
      checks.push(done);
    }
  }
  summarise(checks);
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(checks.map(({ context, ...c }) => ({ ...c, calls: context?.calls || [] })), null, 2));
    console.log(`\nRaw timings written to ${opts.out}`);
  }
  if (scratch && mongoose.connection.name === scratch) await mongoose.connection.db.dropDatabase();
  if (mongoose.connection.readyState) await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  current = null;
  console.error('Profiling failed:', err);
  // Never leave the scratch copy behind.
  if (scratchDb && mongoose.connection.readyState === 1 && mongoose.connection.name === scratchDb) {
    await mongoose.connection.db.dropDatabase().catch(() => {});
  }
  process.exit(1);
});
