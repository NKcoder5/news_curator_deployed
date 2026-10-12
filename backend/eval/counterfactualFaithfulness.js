// backend/eval/counterfactualFaithfulness.js
//
// Is "what decided it, and what would change it" true?
//
// services/decisionExplainer.js tells the reader which lines of evidence a
// verdict depends on (decisive), which of them would reach it on their own
// (rests on), whether it stands with all of them gone (from absence), and the
// smallest evidence that would change it (would change). It computes these by
// re-running the verdict engine. This script checks every one of those
// statements independently: its own removal of each channel, its own
// hypothetical outlets (different names, addresses and headlines from the
// explainer's), each replayed through agents/verdictEngine.replayVerdict, and
// reports how often the explainer's statement holds.
//
// Three sets of evidence ledgers are explained and checked:
//   stored     every ClaimAssessment in the claim memory (read only)
//   scenarios  ledgers built like the suites' cases — a figure contradicted,
//              a rumour fact-checked, old news as new, an invented event, two
//              claims one false — each with seeded variations
//   random     a seeded random grid of evidence combinations
//
// It also sweeps the random grid for monotonicity, extending
// test/verdictMonotonicity.test.js: more evidence against a claim must never
// make the verdict less false, more for it never more false.
//
// Deterministic and free: no model is called and nothing is written to the
// database. Usage:
//   node eval/counterfactualFaithfulness.js [--seed 12] [--random 2000] [--grid 20000] [--no-db]
// Writes eval/results/counterfactual_faithfulness.{json,md}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { replayVerdict } = require('../agents/verdictEngine');
const { explainDecision } = require('../services/decisionExplainer');

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const SEED = Number(flag('--seed', 12));
const RANDOM_LEDGERS = Number(flag('--random', 2000));
const GRID = Number(flag('--grid', 20000));
const useDb = !args.includes('--no-db');

const ASOF = Date.parse('2026-10-12T07:30:00Z');
const DAY = 86400000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const callOf = (input) => replayVerdict(input).call;

// mulberry32: a small seeded generator, so every run sweeps the same grid.
const rngFrom = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---------------------------------------------------------------------------
// Evidence, written independently of the explainer's.
// ---------------------------------------------------------------------------
const NAMES = ['amber', 'basalt', 'cobalt', 'dune', 'ember', 'fjord', 'garnet', 'harbour', 'indigo', 'jasper',
  'kestrel', 'lagoon', 'meadow', 'nimbus', 'onyx', 'prairie', 'quartz', 'russet', 'sierra', 'tundra'];
let outletSerial = 0;
/** n outlets no ownership record merges and whose headlines share no words. */
const outlets = (n, side, publishedAt, reported = '') => Array.from({ length: n }, () => {
  outletSerial += 1;
  const word = `${NAMES[outletSerial % NAMES.length]}${outletSerial}`;
  return {
    source: `${word} ${side === 'for' ? 'Gazette' : 'Courier'}`, title: `${word} ${side} ${outletSerial}`,
    description: '', url: `https://${word}.recount.test/${side}`, publishedAt, reported, reliability: 7
  };
});
const recent = (days = 2) => new Date(ASOF - days * DAY).toISOString();
const old = (days = 400) => new Date(ASOF - days * DAY).toISOString();

const ruling = (finding, n = 1) => ({
  status: finding === 'true' ? 'confirmed' : finding === 'misleading' ? 'misleading' : 'debunked',
  matches: Array.from({ length: n }, (_, k) => ({ publisher: `Recount Desk ${k + 1}`, finding, rating: finding === 'true' ? 'True' : finding === 'misleading' ? 'Misleading' : 'False',
    claimReviewed: 'the claim', url: `https://desk${k + 1}.recount.test/`, via: 'claimreview' }))
});

// The channels, and what "this channel found nothing" means for each. The
// explainer has its own versions; these are written from the ledger's
// definition, not copied, so a disagreement shows up rather than repeating.
const MINE = {
  'news-against': { has: (i) => i.claims.some(c => (c.contradictingEvidence || []).length > 0), remove: (i) => { for (const c of i.claims) c.contradictingEvidence = []; } },
  'news-for': { has: (i) => i.claims.some(c => (c.supportingEvidence || []).length > 0), remove: (i) => { for (const c of i.claims) c.supportingEvidence = []; } },
  'fact-checkers': { has: (i) => (i.factCheckResult?.matches || []).length > 0, remove: (i) => { i.factCheckResult = { status: 'none', matches: [] }; } },
  'this-week': { has: (i) => ['presupposed-false', 'absent'].includes(i.currentCoverageResult?.status), remove: (i) => { i.currentCoverageResult = null; } },
  reference: { has: (i) => (i.premiseResult?.contradictions || []).length + (i.premiseResult?.confirmations || []).length > 0, remove: (i) => { i.premiseResult = null; } },
  writing: {
    has: (i) => (i.manipulationResult?.techniques || []).length >= 2 || (Number(i.transparencyResult?.score) > 0 && Number(i.transparencyResult?.score) < 4),
    remove: (i) => { i.manipulationResult = { techniques: [] }; i.transparencyResult = { score: null }; }
  }
};

const without = (input, ids) => { const t = clone(input); for (const id of ids) MINE[id].remove(t); return t; };

/** Every statement the explainer makes about one ledger, checked. */
const checkExplanation = (input) => {
  const x = explainDecision(input);
  const base = callOf(input);
  const checks = [];
  const add = (kind, ok, detail) => checks.push({ kind, ok, detail });

  add('verdict', x.verdict.call === base, `explainer ${x.verdict.call}, replay ${base}`);
  const present = Object.keys(MINE).filter(id => MINE[id].has(input));
  const named = x.decisive.map(d => d.channel);
  add('channels present', present.length === named.length && present.every(id => named.includes(id)), `mine [${present}] explainer [${named}]`);

  for (const d of x.decisive) {
    if (!MINE[d.channel]) { add('decisive', false, `unknown channel ${d.channel}`); continue; }
    const call = callOf(without(input, [d.channel]));
    add('decisive', (call !== base) === d.decisive && call === d.without.call, `${d.channel}: explainer says ${d.decisive ? 'decisive' : 'not decisive'} (without it ${d.without.call}); recomputed ${call}`);
  }

  const bareCall = callOf(without(input, present));
  add('from absence', (bareCall === base) === x.fromAbsence, `explainer ${x.fromAbsence}; with every channel removed ${bareCall} vs ${base}`);

  if (x.fromAbsence) {
    add('rests on', x.restsOn === 0, `from absence, rests on ${x.restsOn}`);
  } else {
    const restsOn = new Set((x.restsOnChannels || []).map(c => c.channel));
    for (const id of present) {
      const alone = callOf(without(input, present.filter(o => o !== id)));
      add('rests on', (alone === base) === restsOn.has(id), `${id} alone gives ${alone}; explainer ${restsOn.has(id) ? 'lists' : 'does not list'} it`);
    }
  }

  // Would change: each step is reproduced with outlets of our own, it is the
  // first point that call is reached, and no step the explainer left out exists.
  if (input.claims.length) {
    for (const stance of ['for', 'against']) {
      const key = stance === 'for' ? 'supportingEvidence' : 'contradictingEvidence';
      const calls = [];
      for (let n = 1; n <= 8; n++) {
        const t = clone(input);
        t.claims[0][key] = [...(t.claims[0][key] || []), ...outlets(n, stance, null)];
        calls.push(callOf(t));
      }
      const steps = x.wouldChange.filter(w => w.added?.stance === stance);
      for (const w of steps) {
        const n = w.added.outlets;
        add('would change', calls[n - 1] === w.result.call, `${w.change}: explainer ${w.result.call}, recomputed ${calls[n - 1]}`);
        add('would change (smallest)', calls.slice(0, n - 1).every(c => c !== w.result.call), `${w.change}: ${w.result.call} not reached with fewer`);
      }
      const reached = [...new Set(calls.filter(c => c !== base))];
      const told = new Set(steps.map(w => w.result.call));
      add('would change (complete)', reached.every(c => told.has(c)), `${stance}: reachable ${reached.join(', ') || 'none'}; told ${[...told].join(', ') || 'none'}`);
    }
    const factStep = x.wouldChange.find(w => !w.added);
    const t = clone(input);
    t.factCheckResult = ruling('false');
    const withRuling = callOf(t);
    if (factStep) add('would change (ruling)', withRuling === factStep.result.call, `explainer ${factStep.result.call}, recomputed ${withRuling}`);
    else add('would change (ruling)', withRuling === base || (base === 'FAKE' && input.factCheckResult?.status === 'debunked'), `not offered; a ruling gives ${withRuling} vs ${base}`);
  }

  // Sensitivity, reported apart from the agreement rate: the explainer's
  // hypothetical outlets carry no date. Dated today, do they say the same?
  const dated = [];
  if (input.claims.length) {
    const told = new Map(x.wouldChange.filter(s => s.added?.stance === 'for').map(w => [w.result.call, w.added.outlets]));
    const seen = new Set([base]);
    for (let n = 1; n <= 8; n++) {
      const t = clone(input);
      t.claims[0].supportingEvidence = [...(t.claims[0].supportingEvidence || []), ...outlets(n, 'for', recent(0.5))];
      const call = callOf(t);
      if (seen.has(call)) continue;
      seen.add(call);
      if (told.get(call) !== n) dated.push(`${call} with ${n} confirming outlets dated today; the explainer ${told.has(call) ? `says ${told.get(call)}` : 'does not offer it'}`);
    }
  }
  return { base, rule: replayVerdict(input).rule, checks, dated };
};

// ---------------------------------------------------------------------------
// Ledgers.
// ---------------------------------------------------------------------------
const ledger = (claims, extra = {}) => ({
  claims,
  verificationStatus: claims.some(c => (c.supportingEvidence || []).length || (c.contradictingEvidence || []).length) ? 'checked' : 'unverified',
  premiseResult: { status: 'consistent', contradictions: [], confirmations: [] },
  factCheckResult: { status: 'none', matches: [] },
  currentCoverageResult: { status: 'silent', subject: 'the subject', headlinesRead: 20, outletsRead: 9, presupposingFalse: [] },
  unconfirmedClaimResult: null,
  sourceResult: { matched: false, score: 5, impersonates: null, type: null },
  transparencyResult: { score: 6 },
  manipulationResult: { techniques: [] },
  title: claims[0]?.claim || '',
  publishedAt: null, domainAge: null, indexLagHours: 3, asOf: ASOF,
  ...extra
});
const claim = (text, time, forItems = [], againstItems = [], kind = 'event') =>
  ({ claim: text, verdict: 'x', time, kind, supportingEvidence: forItems, contradictingEvidence: againstItems });
const premise = (kind) => kind === 'contradicts'
  ? { status: 'contradicted', contradictions: [{ entity: 'Subject', articleStates: 'x', referenceStates: 'y', reference: { title: 'Subject', url: 'https://en.wikipedia.org/wiki/Subject' } }], confirmations: [] }
  : { status: 'consistent', contradictions: [], confirmations: [{ entity: 'Subject', referenceStates: 'x', reference: { title: 'Subject', url: 'https://en.wikipedia.org/wiki/Subject' } }] };
const week = (status, n = 2) => ({
  status, subject: 'Subject', headlinesRead: status === 'absent' ? 24 : 20, outletsRead: status === 'absent' ? 9 : 8,
  presupposingFalse: status === 'presupposed-false' ? outlets(n, 'week', recent(1)).map(o => ({ ...o, reported: 'still in office' })) : []
});

// Suite-like scenarios, each with the counts the variations draw from.
const SCENARIOS = [
  { name: 'figure contradicted', make: (r) => ledger([claim('India won 84 medals at the Asian Games 2026.', 'past', [], outlets(1 + Math.floor(r() * 4), 'against', recent(3), '85 medals'), 'figure')]) },
  { name: 'true event, corroborated', make: (r) => ledger([claim('Navi Pillay won the 2026 Nobel Peace Prize.', 'now', outlets(1 + Math.floor(r() * 5), 'for', recent(2)))]) },
  { name: 'reversed outcome', make: (r) => ledger([claim('India beat West Indies in the second T20I.', 'now', outlets(Math.floor(r() * 2), 'for', recent(2)), outlets(2 + Math.floor(r() * 3), 'against', recent(2), 'West Indies won'))]) },
  { name: 'rumour fact-checked', make: (r) => ledger([claim('Instagram will be banned in India from 25 August.', 'now')], { factCheckResult: ruling('false', 1 + Math.floor(r() * 3)) }) },
  { name: 'rumour fact-checked, debunk headlines', make: (r) => ledger([claim('Video shows the Army chief dancing.', 'now', outlets(2 + Math.floor(r() * 4), 'for', recent(2)).map(o => ({ ...o, title: `${o.title} video is AI-generated fake` })))], { factCheckResult: ruling('false', 2) }) },
  { name: 'ruling overtaken by reporting', make: (r) => ledger([claim('The minister resigned.', 'now', outlets(2 + Math.floor(r() * 3), 'for', recent(1)))], { factCheckResult: ruling('false') }) },
  { name: 'misleading ruling', make: () => ledger([claim('The old video shows today\'s protest.', 'now')], { factCheckResult: ruling('misleading') }) },
  { name: 'old news as today', make: (r) => ledger([claim('India won the T20 World Cup today.', 'now', outlets(1 + Math.floor(r() * 4), 'for', old(800)))]) },
  { name: 'old news, fresh anniversary coverage', make: (r) => ledger([claim('Ratan Tata passed away today.', 'now', [...outlets(2, 'for', old(730)), ...outlets(Math.floor(r() * 3), 'for', recent(3))])]) },
  { name: 'invented, high impact, warning signs', make: (r) => ledger([claim('RBI has banned 500 rupee notes from tomorrow.', 'now')], { manipulationResult: { techniques: Array.from({ length: 2 + Math.floor(r() * 2) }, (_, k) => ({ technique: `t${k}` })) }, transparencyResult: { score: 2 } }) },
  { name: 'invented, ruled out by this week', make: (r) => ledger([claim('Narendra Modi resigned as Prime Minister.', 'now')], { currentCoverageResult: week('presupposed-false', 2 + Math.floor(r() * 2)) }) },
  { name: 'invented, absent from heavy coverage', make: () => ledger([claim('Vijay resigned as Chief Minister.', 'now')], { currentCoverageResult: week('absent') }) },
  { name: 'unverified local', make: () => ledger([claim('A bakery opened on Gandhi Road in Erode.', 'past')]) },
  { name: 'false premise', make: (r) => ledger([claim('Chennai is the capital of Karnataka.', 'timeless', [], [], 'standing_fact')], { premiseResult: premise('contradicts'), factCheckResult: r() < 0.3 ? ruling('false') : { status: 'none', matches: [] } }) },
  { name: 'standing fact confirmed by reference', make: () => ledger([claim('Bengaluru is the capital of Karnataka.', 'timeless', [], [], 'standing_fact')], { premiseResult: premise('confirms') }) },
  { name: 'two claims, one false', make: (r) => ledger([
    claim('Francis Halzen won the Nobel Prize in Physics.', 'now', outlets(2 + Math.floor(r() * 2), 'for', recent(4))),
    claim('India beat West Indies in Ranchi.', 'now', [], outlets(2, 'against', recent(2)))]) },
  { name: 'true claim carrying an invented one', make: (r) => {
    const l = ledger([claim('Vijay launched the Dream Olympics scheme.', 'now', outlets(2, 'for', recent(3))), claim('Vijay announced free petrol for students.', 'now')]);
    const status = ['presupposed-false', 'absent', 'silent'][Math.floor(r() * 3)];
    l.unconfirmedClaimResult = { claim: l.claims[1].claim, confirmedClaim: l.claims[0].claim, week: week(status) };
    return l;
  } },
  { name: 'too recent to corroborate', make: () => ledger([claim('Five people were arrested near the air base.', 'now')], { publishedAt: new Date(ASOF - 2 * 3600000).toISOString(), indexLagHours: 6 }) },
  { name: 'search failed', make: () => ledger([claim('The council approved a new bus route.', 'now')], { verificationStatus: 'error' }) }
];

/** A random ledger: any combination the channels can produce, and some they rarely do. */
const randomLedger = (r) => {
  const pick = (list) => list[Math.floor(r() * list.length)];
  const date = () => pick([recent(1 + r() * 10), recent(1 + r() * 10), old(30 + r() * 900), null]);
  const n = r() < 0.6 ? 1 : r() < 0.75 ? 2 : 3;
  const texts = ['Narendra Modi resigned as Prime Minister.', 'India won 84 medals at the Asian Games.', 'A new bakery opened in Erode.',
    'The RBI banned 500 rupee notes.', 'Navi Pillay won the Nobel Peace Prize.', 'West Indies beat India in Ranchi.'];
  const first = Math.floor(r() * texts.length);   // claims in one message are distinct sentences
  const claims = Array.from({ length: n }, (_, k) => {
    const forN = Math.floor(r() * 5);
    const againstN = r() < 0.6 ? 0 : 1 + Math.floor(r() * 3);
    const forItems = [];
    for (let i = 0; i < forN; i++) {
      const item = outlets(1, 'for', date())[0];
      if (r() < 0.1) item.title = `${item.title} claim is fake`;
      forItems.push(item);
    }
    const againstItems = [];
    for (let i = 0; i < againstN; i++) againstItems.push(outlets(1, 'against', date(), 'otherwise')[0]);
    return claim(texts[(first + k) % texts.length], pick(['now', 'now', 'past', 'timeless']), forItems, againstItems, pick(['event', 'event', 'figure', 'standing_fact']));
  });
  const fc = r();
  const l = ledger(claims, {
    verificationStatus: r() < 0.05 ? 'error' : undefined,
    premiseResult: r() < 0.15 ? premise('contradicts') : r() < 0.15 ? premise('confirms') : { status: 'consistent', contradictions: [], confirmations: [] },
    factCheckResult: fc < 0.7 ? { status: 'none', matches: [] } : fc < 0.85 ? ruling('false', 1 + Math.floor(r() * 3)) : fc < 0.9 ? ruling('misleading') : ruling('true'),
    currentCoverageResult: week(pick(['silent', 'silent', 'presupposed-false', 'absent']), 1 + Math.floor(r() * 3)),
    sourceResult: r() < 0.3 ? { matched: true, score: 2 + Math.round(r() * 75) / 10, impersonates: null, type: r() < 0.05 ? 'satire' : r() < 0.08 ? 'conspiracy' : null }
      : { matched: false, score: 5, impersonates: r() < 0.03 ? 'BBC News' : null, type: null },
    transparencyResult: { score: Math.round(r() * 10) },
    manipulationResult: { techniques: Array.from({ length: Math.floor(r() * 4) }, (_, k) => ({ technique: `t${k}` })) },
    publishedAt: r() < 0.2 ? new Date(ASOF - (0.5 + r() * 72) * 3600000).toISOString() : null,
    indexLagHours: pick([3, 6, 24]),
    domainAge: r() < 0.05 ? { young: true, ageDays: 20 } : null
  });
  // The search reports an error only when it could check no claim at all
  // (agents/claimVerificationAgent.js), so an error never comes with evidence.
  if (l.verificationStatus === 'error') for (const c of claims) { c.supportingEvidence = []; c.contradictingEvidence = []; }
  else l.verificationStatus = claims.some(c => c.supportingEvidence.length || c.contradictingEvidence.length) ? 'checked' : 'unverified';
  if (n >= 2 && r() < 0.3) {
    l.unconfirmedClaimResult = { claim: claims[1].claim, confirmedClaim: claims[0].claim, week: week(pick(['silent', 'presupposed-false', 'absent'])) };
  }
  return realistic(l);
};

// The second claim's reading of this week's news exists only when one claim
// was confirmed and another found no coverage at all (agents/
// trustAnalysisAgent.js); evidence added by a perturbation can undo either
// condition, and then the pipeline would not have produced it.
function realistic(l) {
  // Evidence found means the search ran.
  if (l.verificationStatus === 'error' && l.claims.some(c => c.supportingEvidence.length || c.contradictingEvidence.length)) l.verificationStatus = 'checked';
  const u = l.unconfirmedClaimResult;
  if (!u) return l;
  const confirmed = l.claims.find(c => c.claim === u.confirmedClaim);
  const unreported = l.claims.find(c => c.claim === u.claim && c !== confirmed);
  const ok = confirmed && unreported && confirmed.supportingEvidence.length > confirmed.contradictingEvidence.length
    && !unreported.supportingEvidence.length && !unreported.contradictingEvidence.length;
  if (!ok) l.unconfirmedClaimResult = null;
  return l;
}

// ---------------------------------------------------------------------------
// Monotonicity.
// ---------------------------------------------------------------------------
const FALSITY = { REAL: 0, 'CANNOT VERIFY': 1, 'NOT A FACTUAL CLAIM': 1, SATIRE: 1, MISLEADING: 2, 'PARTLY FALSE': 2, FAKE: 3 };
const falsity = (call) => FALSITY[call] ?? 1;
const PERTURBATIONS = [
  { name: 'a fact-checker rates it false', direction: 'against', applies: (i) => (i.factCheckResult?.status || 'none') === 'none', apply: (i) => { i.factCheckResult = ruling('false'); } },
  { name: 'two more fresh outlets report otherwise', direction: 'against', applies: (i) => i.claims.length > 0, apply: (i, r) => { i.claims[Math.floor(r() * i.claims.length)].contradictingEvidence.push(...outlets(2, 'against', recent(1), 'otherwise')); } },
  { name: 'the encyclopedia contradicts it', direction: 'against', applies: (i) => !(i.premiseResult?.contradictions || []).length, apply: (i) => { i.premiseResult = { ...premise('contradicts'), confirmations: i.premiseResult?.confirmations || [] }; } },
  { name: 'two more fresh outlets confirm it', direction: 'for', applies: (i) => i.claims.length > 0, apply: (i, r) => { i.claims[Math.floor(r() * i.claims.length)].supportingEvidence.push(...outlets(2, 'for', recent(1))); } },
  { name: 'a fact-checker rates it true', direction: 'for', applies: (i) => (i.factCheckResult?.status || 'none') === 'none', apply: (i) => { i.factCheckResult = ruling('true'); } }
];

const sweep = (r) => {
  const result = PERTURBATIONS.map(p => ({ name: p.name, direction: p.direction, tried: 0, broken: 0, transitions: {}, examples: [] }));
  for (let g = 0; g < GRID; g++) {
    const input = randomLedger(r);
    const before = replayVerdict(input);
    PERTURBATIONS.forEach((p, k) => {
      if (!p.applies(input)) return;
      const t = clone(input);
      p.apply(t, r);
      const after = replayVerdict(realistic(t));
      const res = result[k];
      res.tried += 1;
      const worse = p.direction === 'against' ? falsity(after.call) < falsity(before.call) : falsity(after.call) > falsity(before.call);
      if (!worse) return;
      res.broken += 1;
      const key = `${before.call} (${before.rule}) -> ${after.call} (${after.rule})`;
      res.transitions[key] = (res.transitions[key] || 0) + 1;
      if (res.examples.length < 3) res.examples.push({ key, claims: input.claims.map(c => ({ time: c.time, for: c.supportingEvidence.length, against: c.contradictingEvidence.length })), factCheck: input.factCheckResult?.status, week: input.currentCoverageResult?.status, unconfirmed: Boolean(input.unconfirmedClaimResult) });
    });
  }
  return result;
};

// ---------------------------------------------------------------------------
const tallyChecks = (explained) => {
  const byKind = {};
  for (const e of explained) {
    for (const c of e.checks) {
      byKind[c.kind] = byKind[c.kind] || { n: 0, agree: 0 };
      byKind[c.kind].n += 1;
      if (c.ok) byKind[c.kind].agree += 1;
    }
  }
  const n = Object.values(byKind).reduce((s, v) => s + v.n, 0);
  const agree = Object.values(byKind).reduce((s, v) => s + v.agree, 0);
  return { ledgers: explained.length, statements: n, agree, rate: n ? Number((agree / n).toFixed(4)) : null, byKind,
    datedSensitivity: explained.filter(e => e.dated.length).length };
};

(async () => {
  const sets = {};

  if (useDb) {
    const mongoose = require('mongoose');
    const ClaimAssessment = require('../models/ClaimAssessment');
    try {
      await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      const docs = await ClaimAssessment.find({}).select('ledgerInput call rule').lean();
      sets.stored = docs.filter(d => d.ledgerInput?.claims).map(d => ({ id: String(d._id), input: d.ledgerInput }));
      await mongoose.disconnect();
    } catch (err) {
      console.warn(`Stored assessments not read (${err.message}).`);
    }
  }

  const r = rngFrom(SEED);
  sets.scenarios = SCENARIOS.flatMap(s => Array.from({ length: 20 }, (_, k) => ({ id: `${s.name} #${k + 1}`, scenario: s.name, input: s.make(r) })));
  sets.random = Array.from({ length: RANDOM_LEDGERS }, (_, k) => ({ id: `random #${k + 1}`, input: randomLedger(r) }));

  const report = { ranAt: new Date().toISOString(), seed: SEED, sets: {}, disagreements: [], monotonicity: null };
  for (const [name, list] of Object.entries(sets)) {
    const explained = list.map(item => ({ ...item, ...checkExplanation(item.input) }));
    report.sets[name] = tallyChecks(explained);
    for (const e of explained) {
      for (const c of e.checks.filter(x => !x.ok)) {
        if (report.disagreements.filter(d => d.set === name && d.kind === c.kind).length < 5) {
          report.disagreements.push({ set: name, ledger: e.id, rule: e.rule, kind: c.kind, detail: c.detail });
        }
      }
      if (e.dated.length && !report.sets[name].datedExample) report.sets[name].datedExample = { ledger: e.id, rule: e.rule, detail: e.dated[0] };
    }
    if (name === 'scenarios') {
      report.sets[name].byScenario = Object.fromEntries(SCENARIOS.map(s => {
        const own = explained.filter(e => e.scenario === s.name);
        const t = tallyChecks(own);
        return [s.name, { agree: t.agree, statements: t.statements, verdicts: [...new Set(own.map(e => e.base))].join('/') }];
      }));
    }
  }

  report.monotonicity = { grid: GRID, perturbations: sweep(rngFrom(SEED + 1)) };

  const out = path.join(__dirname, 'results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'counterfactual_faithfulness.json'), JSON.stringify(report, null, 2));

  const pct = (a, n) => (n ? `${(100 * a / n).toFixed(1)}%` : '–');
  const md = [
    '# Counterfactual faithfulness of the decision explainer',
    '',
    `Run ${report.ranAt.slice(0, 16).replace('T', ' ')} UTC, seed ${SEED}. Every statement services/decisionExplainer.js makes was recomputed with this script's own channel removals and hypothetical outlets through replayVerdict.`,
    '',
    '| Ledgers | Count | Statements checked | Agree | Rate |',
    '|---|---|---|---|---|',
    ...Object.entries(report.sets).map(([name, s]) => `| ${name} | ${s.ledgers} | ${s.statements} | ${s.agree} | ${pct(s.agree, s.statements)} |`),
    '',
    '| Statement | ' + Object.keys(report.sets).join(' | ') + ' |',
    '|---|' + Object.keys(report.sets).map(() => '---').join('|') + '|',
    ...[...new Set(Object.values(report.sets).flatMap(s => Object.keys(s.byKind)))].map(kind =>
      `| ${kind} | ${Object.values(report.sets).map(s => (s.byKind[kind] ? `${s.byKind[kind].agree}/${s.byKind[kind].n}` : '–')).join(' | ')} |`),
    '',
    `Sensitivity (not counted above): the explainer's hypothetical outlets carry no date. Dated today instead, a "would change" step reaches a different verdict for ${Object.entries(report.sets).map(([n, s]) => `${s.datedSensitivity} ${n}`).join(', ')} ledgers.`
      + (Object.values(report.sets).find(s => s.datedExample) ? ` Example (${Object.values(report.sets).find(s => s.datedExample).datedExample.rule}): ${Object.values(report.sets).find(s => s.datedExample).datedExample.detail}.` : ''),
    '',
    report.disagreements.length ? '## Disagreements (first few of each kind)' : '## Disagreements: none',
    '',
    ...report.disagreements.map(d => `- ${d.set}, ${d.ledger} (${d.rule}), ${d.kind}: ${d.detail}`),
    '',
    `## Monotonicity over ${GRID} random ledgers`,
    '',
    '| More evidence | Direction | Tried | Made it the wrong way | Rate |',
    '|---|---|---|---|---|',
    ...report.monotonicity.perturbations.map(p => `| ${p.name} | ${p.direction} | ${p.tried} | ${p.broken} | ${pct(p.broken, p.tried)} |`),
    '',
    ...report.monotonicity.perturbations.filter(p => p.broken).flatMap(p => [
      `${p.name}:`,
      ...Object.entries(p.transitions).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `- ${v} × ${k}`),
      ''
    ])
  ].join('\n');
  fs.writeFileSync(path.join(out, 'counterfactual_faithfulness.md'), md);
  console.log(md);
  process.exit(0);
})();
