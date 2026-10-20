// backend/eval/stanceAgreement.js
//
// How often does our own pair model agree with the hosted model on the stance
// step: does this headline agree with the claim, disagree with it, or say
// nothing about it?
//
// Each claim goes through the verifier's own retrieval and its own stance
// judgement (agents/claimVerificationAgent.js), and every headline the hosted
// model was shown is recorded with its answer, which provider gave it, and our
// model's reading of the same pair (services/localNli.js). The records are
// the measurement and, if the model needs training, its silver labels.
//
// Claims come from suites not used to measure verdicts afterwards: the
// benchmark and eval/suites/heldout_v2.json stay unseen.
//
//   node eval/stanceAgreement.js [--limit N] [--suites a,b]
//
// Writes eval/results/stance_pairs.jsonl (appending, one line per headline,
// resumable by claim) and eval/results/stance_agreement.md.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

// Recorded before the verifier loads, which takes its reference at require time.
const gateway = require('../utils/nvidiaNimApi');
const recorded = [];
const realCall = gateway.callNimApiJson;
gateway.callNimApiJson = async (prompt, options = {}) => {
  const value = await realCall(prompt, options);
  if (options.label === 'stance judgement') recorded.push({ prompt, value });
  return value;
};

const { __test: { gatherCoverage, judgeClaim, deriveKeywords } } = require('../agents/claimVerificationAgent');
const { runWithContext, currentContext } = require('../utils/runContext');
const localNli = require('../services/localNli');

const RESULTS = path.join(__dirname, 'results');
const PAIRS = path.join(RESULTS, 'stance_pairs.jsonl');
const REPORT = path.join(RESULTS, 'stance_agreement.md');
const DEFAULT_SUITES = ['reviewer_probe', 'robustness_suite', 'heldout_suite'];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

/** Claims worth a stance judgement: one statement, not a link, not a forward of several. */
const claimsFrom = (suites) => suites.flatMap((name) => {
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', `${name}.json`), 'utf8'));
  return (Array.isArray(suite) ? suite : suite.cases || [])
    .filter((c) => typeof c.input === 'string' && !/^https?:/i.test(c.input.trim()) && c.input.length <= 280)
    .map((c) => ({ id: `${name}:${c.id}`, claim: c.input.replace(/\s+/g, ' ').trim() }));
});

/** The headlines as the model saw them, numbered: "[n] source: "title" — description". */
const shownHeadlines = (prompt) => {
  const block = prompt.split(/\[\[UNTRUSTED headlines [^\]]*\]\]\n/)[1]?.split(/\n\[\[\/UNTRUSTED headlines/)[0] || '';
  return block.split('\n').map((line) => {
    const m = line.match(/^\[(\d+)\] (.*?): "(.*)" — (.*)$/) || line.match(/^\[(\d+)\] (.*?): "(.*)"?(.*)$/);
    return m && { n: Number(m[1]), source: m[2], title: m[3], description: m[4] || '' };
  }).filter(Boolean);
};

/** What the verifier counts the hosted model's item as (same rules as judgeClaim). */
const effective = (item, headline) => {
  const truthy = (v) => v === true || v === 'true';
  const falsy = (v) => v === false || v === 'false';
  const reported = String(item?.reported || '').trim() || headline.title;
  if (/\?["'”’)\]]*$/.test(reported.trim())) return 'unrelated';
  if (item?.stance === 'agree' && !falsy(item.same_event)) return 'agree';
  if (item?.stance === 'disagree' && truthy(item.same_event) && falsy(item.both_can_be_true)) return 'disagree';
  return 'unrelated';
};
const LOCAL_TO_STANCE = { entailment: 'agree', contradiction: 'disagree', neutral: 'unrelated' };

const runOne = async ({ id, claim }) => runWithContext(async () => {
  recorded.length = 0;
  const { articles, searchFailed } = await gatherCoverage({ claim, keywords: deriveKeywords(claim), sourceName: 'eval' });
  if (searchFailed || !articles?.length) return [];
  await judgeClaim(claim, articles);
  const providers = (currentContext()?.calls || []).filter((c) => c.label === 'stance judgement').map((c) => c.provider || 'unknown');
  const rows = [];
  recorded.forEach(({ prompt, value }, k) => {
    const items = new Map((Array.isArray(value?.items) ? value.items : []).map((it) => [Number(it.n), it]));
    for (const h of shownHeadlines(prompt)) {
      rows.push({ id, claim, n: h.n, source: h.source, premise: `${h.title} — ${h.description}`.trim(),
        hosted: effective(items.get(h.n), h), hostedRaw: items.get(h.n)?.stance || null, provider: providers[k] || 'unknown' });
    }
  });
  const judged = await localNli.judgePairs(rows.map((r) => ({ premise: r.premise, hypothesis: r.claim })));
  rows.forEach((r, i) => { r.local = judged[i] ? { stance: LOCAL_TO_STANCE[judged[i].label], scores: judged[i].scores } : null; });
  return rows;
});

const pct = (a, b) => (b ? `${Math.round((1000 * a) / b) / 10}%` : '–');

const report = (rows) => {
  const labelled = rows.filter((r) => r.provider === 'gemini' && r.local);
  const classes = ['agree', 'disagree', 'unrelated'];
  const lines = [`# Stance: our model against the hosted model`, '',
    `Measured ${new Date().toISOString().slice(0, 10)} on ${new Set(rows.map((r) => r.id)).size} claims, ${rows.length} headlines; ` +
    `${labelled.length} judged by Gemini are compared (other providers are recorded but not used as reference).`, '',
    '## Confusion (rows: Gemini, columns: our model)', '', '| Gemini \\ ours | agree | disagree | unrelated | total |', '|---|---|---|---|---|'];
  for (const g of classes) {
    const row = labelled.filter((r) => r.hosted === g);
    lines.push(`| ${g} | ${classes.map((l) => row.filter((r) => r.local.stance === l).length).join(' | ')} | ${row.length} |`);
  }
  const agree = labelled.filter((r) => r.local.stance === r.hosted).length;
  lines.push('', `Overall agreement: ${agree} / ${labelled.length} (${pct(agree, labelled.length)}).`, '',
    '## When our model is confident', '',
    'Coverage is the share of headlines where our top probability is at least the threshold; agreement is measured on those only. ' +
    'Precision for "disagree" matters most: a wrong "disagree" can make a true claim FAKE.', '',
    '| threshold | coverage | agreement | agree precision | disagree precision |', '|---|---|---|---|---|');
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98]) {
    const sure = labelled.filter((r) => Math.max(...Object.values(r.local.scores)) >= t);
    const ok = sure.filter((r) => r.local.stance === r.hosted).length;
    const prec = (cls) => { const said = sure.filter((r) => r.local.stance === cls); return `${pct(said.filter((r) => r.hosted === cls).length, said.length)} (${said.length})`; };
    lines.push(`| ${t} | ${pct(sure.length, labelled.length)} | ${pct(ok, sure.length)} | ${prec('agree')} | ${prec('disagree')} |`);
  }
  const byProvider = rows.reduce((m, r) => ({ ...m, [r.provider]: (m[r.provider] || 0) + 1 }), {});
  lines.push('', `Headlines by provider: ${Object.entries(byProvider).map(([p, n]) => `${p} ${n}`).join(', ')}.`, '');
  fs.writeFileSync(REPORT, lines.join('\n'));
  return lines.join('\n');
};

const main = async () => {
  const suites = (arg('suites', DEFAULT_SUITES.join(',')) || '').split(',').filter(Boolean);
  const limit = Number(arg('limit', 0)) || Infinity;
  const readRows = () => (fs.existsSync(PAIRS) ? fs.readFileSync(PAIRS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const done = new Set(readRows().map((r) => r.id));
  const todo = claimsFrom(suites).filter((c) => !done.has(c.id)).slice(0, limit);
  console.log(`${todo.length} claims to judge (${done.size} already recorded)`);
  for (const [i, c] of todo.entries()) {
    try {
      const rows = await runOne(c);
      fs.appendFileSync(PAIRS, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
      // A claim with no coverage is recorded once, so a resumed run does not search it again.
      if (!rows.length) fs.appendFileSync(PAIRS, `${JSON.stringify({ id: c.id, claim: c.claim, noCoverage: true })}\n`);
      console.log(`[${i + 1}/${todo.length}] ${c.id}: ${rows.length} headlines, ${rows[0]?.provider || '-'}`);
    } catch (err) {
      console.log(`[${i + 1}/${todo.length}] ${c.id}: failed (${err.message})`);
    }
  }
  console.log(report(readRows().filter((r) => !r.noCoverage)));
  process.exit(0);
};

if (require.main === module) main();

module.exports = { shownHeadlines, effective, claimsFrom };
