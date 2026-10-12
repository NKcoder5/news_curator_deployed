// backend/eval/ruleReliability.js
//
// How often has each rule been right?
//
// The page used to show a "confidence" beside every verdict: a number set by
// hand for each rule (0.7 plus a little per extra outlet). It looked like a
// measurement and was not one. Every verdict is reached by one named rule
// (agents/verdictEngine.js), so a rule's record can be counted instead: across
// the labelled test messages that ended at this rule, how many got the
// expected answer. That count, with its 95% Wilson interval, is what the page
// now shows — "right in 9 of 10 test messages (60–98%)" — and a rule with few
// test messages says so by its wide interval.
//
// Read from the latest labelled runs of each suite:
//   eval/results/robustness_final.json         the robustness suite (55 cases;
//                                              written while the system was
//                                              being tuned, so optimistic)
//   eval/results/robustness_heldout_final.json the held-out suite, written after
//                                              tuning (falls back to
//                                              robustness_heldout.json)
//   eval/results/checkAnything_benchmark.json  the benchmark of real claims
//
// Each run is counted once; earlier runs of the same suite are not added, so
// one message is never counted twice.
//
// Usage: node eval/ruleReliability.js
// Writes data/ruleReliability.json.
const fs = require('fs');
const path = require('path');

const RESULTS = path.join(__dirname, 'results');
const ABSTENTIONS = new Set(['CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'ERROR']);

const readJson = (name) => {
  const file = path.join(RESULTS, name);
  return fs.existsSync(file) ? { name, data: JSON.parse(fs.readFileSync(file, 'utf8')) } : null;
};

// 95% Wilson score interval for k successes in n trials.
const wilson = (k, n, z = 1.96) => {
  if (!n) return { low: 0, high: 1 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
};

const sources = [];
const cases = [];

const robustness = readJson('robustness_final.json');
if (robustness) {
  sources.push({ file: robustness.name, ranAt: robustness.data.summary?.ranAt || null, cases: robustness.data.rows.length, writtenDuringTuning: true });
  for (const r of robustness.data.rows) cases.push({ suite: 'robustness', id: r.id, rule: r.rule, call: r.call, expected: r.expected, outcome: r.outcome });
}

const heldout = readJson('robustness_heldout_final.json') || readJson('robustness_heldout.json');
if (heldout) {
  sources.push({ file: heldout.name, ranAt: heldout.data.summary?.ranAt || null, cases: heldout.data.rows.length, writtenDuringTuning: false });
  for (const r of heldout.data.rows) {
    // The earliest held-out run predates the four outcomes; recompute them.
    const outcome = r.call === r.expected ? 'right'
      : (r.alsoAcceptable || []).includes(r.call) ? 'safe'
      : ABSTENTIONS.has(r.call) ? 'missed' : 'wrong';
    cases.push({ suite: 'heldout', id: r.id, rule: r.rule, call: r.call, expected: r.expected, outcome });
  }
}

const benchmark = readJson('checkAnything_benchmark.json');
if (benchmark) {
  sources.push({ file: benchmark.name, ranAt: benchmark.data.summary?.ranAt || null, cases: benchmark.data.rows.length, writtenDuringTuning: false });
  benchmark.data.rows.forEach((r, i) => {
    const expected = r.truth ? 'REAL' : 'FAKE';
    const call = r.ours?.call || 'ERROR';
    const outcome = call === expected ? 'right' : ABSTENTIONS.has(call) ? 'missed' : 'wrong';
    cases.push({ suite: 'benchmark', id: `b-${i + 1}`, rule: r.ours?.rule || null, call, expected, outcome });
  });
}

// A rule is scored on the answers it gave. For a rule that gives a verdict,
// the share of its verdicts that were right. For a rule that declines to
// answer, the share of its abstentions that were due — that the expected
// answer was itself "cannot verify" or an acceptable abstention — and how
// often an answer existed that it did not reach.
const byRule = new Map();
for (const c of cases.filter(x => x.rule)) {
  if (!byRule.has(c.rule)) byRule.set(c.rule, []);
  byRule.get(c.rule).push(c);
}

const rules = {};
for (const [rule, list] of [...byRule.entries()].sort()) {
  const n = list.length;
  const right = list.filter(c => c.outcome === 'right' || c.outcome === 'safe').length;
  const calls = {};
  for (const c of list) calls[c.call] = (calls[c.call] || 0) + 1;
  const { low, high } = wilson(right, n);
  rules[rule] = {
    n,
    right,
    missed: list.filter(c => c.outcome === 'missed').length,
    wrong: list.filter(c => c.outcome === 'wrong').length,
    rate: Number((right / n).toFixed(3)),
    low: Number(low.toFixed(3)),
    high: Number(high.toFixed(3)),
    abstains: list.every(c => ABSTENTIONS.has(c.call)),
    calls,
    heldOut: (() => {
      const h = list.filter(c => c.suite !== 'robustness');
      return { n: h.length, right: h.filter(c => c.outcome === 'right' || c.outcome === 'safe').length };
    })(),
    cases: list.map(c => `${c.suite}:${c.id}`)
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  note: 'Per-rule record on labelled test messages. Robustness-suite cases were written while the system was tuned, so rates that rest on them are optimistic; heldOut counts only the held-out suite and the benchmark.',
  sources,
  totalCases: cases.length,
  rules
};
fs.writeFileSync(path.join(__dirname, '..', 'data', 'ruleReliability.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`${cases.length} labelled cases from ${sources.map(s => s.file).join(', ')}`);
for (const [rule, r] of Object.entries(rules)) {
  console.log(`${rule.padEnd(48)} ${String(r.right).padStart(3)}/${String(r.n).padEnd(3)} ${(r.rate * 100).toFixed(0).padStart(3)}%  [${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}%]${r.wrong ? `  ${r.wrong} wrong` : ''}${r.missed ? `  ${r.missed} missed` : ''}  held-out ${r.heldOut.right}/${r.heldOut.n}`);
}
