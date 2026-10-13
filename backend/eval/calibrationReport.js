// backend/eval/calibrationReport.js
//
// When Check Anything gives a verdict, how often is it right — and how often
// does it give one?
//
// A system that may abstain has two numbers, not one: coverage (the share of
// messages that deserved a verdict and got one) and accuracy when it answers.
// Either can be bought with the other, so both are reported, with the error
// that matters most counted on its own: a wrong-direction verdict, REAL for
// something false or FAKE / PARTLY FALSE for something true. Each call's
// precision ("when it says FAKE, how often is that right?") is given with its
// 95% Wilson interval, because on tens of cases the interval is the honest
// part of the number.
//
// Read from the labelled results files, grouped by how much the cases could
// have shaped the system:
//   tuned      robustness_final.json — written while the system was tuned
//   held-out   robustness_heldout_final.json, checkAnything_benchmark.json and
//              robustness_heldout_v2.json (when it has been run)
//   consistency  consistency_with_memory.json / consistency_no_memory.json,
//              reported apart: four phrasings of one claim are not four
//              independent cases
// Rows that measured the quota (degraded, ERROR) are left out and counted.
// Where the verdict's stated confidence was recorded, it is checked against
// how often the verdict was right at that confidence.
//
// Usage: node eval/calibrationReport.js
// Writes eval/results/calibration.{json,md}.
const fs = require('fs');
const path = require('path');
const { wilson } = require('./metrics');

const RESULTS = path.join(__dirname, 'results');
const ABSTENTIONS = new Set(['CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'ERROR', 'SATIRE']);
const VERDICTS = ['REAL', 'FAKE', 'PARTLY FALSE', 'MISLEADING'];
const TRUE_SIDE = new Set(['REAL']);
const FALSE_SIDE = new Set(['FAKE', 'PARTLY FALSE', 'MISLEADING']);

const read = (name) => {
  const file = path.join(RESULTS, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

/** Rows as {suite, id, expected, alsoAcceptable, call, confidence}. */
const fromSuite = (name, suite) => {
  const data = read(name);
  if (!data) return null;
  const kept = data.rows.filter(r => r.call !== 'ERROR' && !(r.degraded || []).length);
  return {
    file: name, suite, ranAt: data.summary?.ranAt || null, dropped: data.rows.length - kept.length,
    rows: kept.map(r => ({ suite, id: r.id || `${r.claimId}:${r.style}`, expected: r.expected, alsoAcceptable: r.alsoAcceptable || [], call: r.call, confidence: r.confidence ?? null }))
  };
};
const fromBenchmark = () => {
  const data = read('checkAnything_benchmark.json');
  if (!data) return null;
  const kept = data.rows.filter(r => r.ours?.call && r.ours.call !== 'ERROR' && r.ours.call !== 'SKIPPED');
  return {
    file: 'checkAnything_benchmark.json', suite: 'benchmark', ranAt: data.summary?.ranAt || null, dropped: data.rows.length - kept.length,
    rows: kept.map((r, i) => ({ suite: 'benchmark', id: `b-${i + 1}`, expected: r.truth ? 'REAL' : 'FAKE', alsoAcceptable: [], call: r.ours.call, confidence: r.ours.confidence ?? null }))
  };
};

const isRight = (r) => r.call === r.expected || r.alsoAcceptable.includes(r.call);
const verdictDue = (r) => VERDICTS.includes(r.expected);
const answered = (r) => VERDICTS.includes(r.call);
const wrongDirection = (r) => (TRUE_SIDE.has(r.expected) && FALSE_SIDE.has(r.call)) || (FALSE_SIDE.has(r.expected) && TRUE_SIDE.has(r.call));
const pct = (x) => (x === null ? '–' : `${(100 * x).toFixed(0)}%`);
const interval = (k, n) => {
  const { low, high } = wilson(k, n);
  return { k, n, rate: n ? Number((k / n).toFixed(3)) : null, low: Number(low.toFixed(3)), high: Number(high.toFixed(3)) };
};

const measure = (rows) => {
  const due = rows.filter(verdictDue);
  const dueAnswered = due.filter(answered);
  const allAnswered = rows.filter(answered);
  const perCall = Object.fromEntries([...VERDICTS, 'CANNOT VERIFY', 'REFUSED'].map(call => {
    const own = rows.filter(r => r.call === call);
    return [call, interval(own.filter(isRight).length, own.length)];
  }).filter(([, v]) => v.n));
  return {
    cases: rows.length,
    right: rows.filter(isRight).length,
    coverage: interval(dueAnswered.length, due.length),
    accuracyWhenAnswered: interval(allAnswered.filter(isRight).length, allAnswered.length),
    wrongDirection: interval(allAnswered.filter(wrongDirection).length, allAnswered.length),
    // An abstention is due when the case's own label or acceptable answers include it.
    abstentionsDue: interval(rows.filter(r => !answered(r) && isRight(r)).length, rows.filter(r => !answered(r)).length),
    perCall
  };
};

// Stated confidence against observed accuracy, for the verdicts that carry one.
const reliability = (rows) => {
  const withConf = rows.filter(r => answered(r) && Number.isFinite(r.confidence));
  if (!withConf.length) return null;
  const bins = [[0, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([lo, hi]) => {
    const own = withConf.filter(r => r.confidence >= lo && r.confidence < hi);
    const right = own.filter(isRight).length;
    return { bin: `${lo.toFixed(1)}-${Math.min(hi, 1).toFixed(1)}`, n: own.length,
      meanConfidence: own.length ? Number((own.reduce((s, r) => s + r.confidence, 0) / own.length).toFixed(3)) : null,
      accuracy: own.length ? Number((right / own.length).toFixed(3)) : null };
  });
  const ece = bins.reduce((s, b) => s + (b.n ? (b.n / withConf.length) * Math.abs(b.meanConfidence - b.accuracy) : 0), 0);
  // Selective accuracy: answer only above a confidence threshold.
  const sorted = [...withConf].sort((a, b) => b.confidence - a.confidence);
  const curve = [0.25, 0.5, 0.75, 1].map(share => {
    const top = sorted.slice(0, Math.max(1, Math.round(share * sorted.length)));
    return { coverage: share, minConfidence: top[top.length - 1].confidence, accuracy: Number((top.filter(isRight).length / top.length).toFixed(3)), n: top.length };
  });
  return { n: withConf.length, ece: Number(ece.toFixed(3)), bins, curve };
};

const sources = [
  fromSuite('robustness_final.json', 'robustness'),
  fromSuite('robustness_heldout_final.json', 'heldout'),
  fromBenchmark(),
  fromSuite('robustness_heldout_v2.json', 'heldout_v2'),
  fromSuite('consistency_with_memory.json', 'consistency (memory on)'),
  fromSuite('consistency_no_memory.json', 'consistency (memory off)')
].filter(Boolean);

const groups = {
  tuned: sources.filter(s => s.suite === 'robustness'),
  'held-out': sources.filter(s => ['heldout', 'benchmark', 'heldout_v2'].includes(s.suite)),
  ...Object.fromEntries(sources.filter(s => s.suite !== 'robustness').map(s => [s.suite, [s]]))
};

const report = {
  generatedAt: new Date().toISOString(),
  sources: sources.map(s => ({ file: s.file, suite: s.suite, ranAt: s.ranAt, cases: s.rows.length, droppedAsQuota: s.dropped })),
  groups: Object.fromEntries(Object.entries(groups).filter(([, list]) => list.length).map(([name, list]) => {
    const rows = list.flatMap(s => s.rows);
    return [name, { ...measure(rows), confidence: reliability(rows) }];
  }))
};

fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, 'calibration.json'), JSON.stringify(report, null, 2));

const ci = (x) => (x.n ? `${x.k}/${x.n} = ${pct(x.rate)} (${pct(x.low)}–${pct(x.high)})` : '–');
const md = [
  '# Selective accuracy and calibration',
  '',
  `Generated ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC from ${report.sources.map(s => `${s.file} (${s.cases}${s.droppedAsQuota ? `, ${s.droppedAsQuota} dropped as quota` : ''})`).join(', ')}.`,
  'Coverage: of the cases that deserved a verdict, how many got one. Accuracy when answered: of the verdicts given, how many were right or acceptable. Wrong direction: REAL for something false, or FAKE / PARTLY FALSE for something true. Intervals are 95% Wilson.',
  '',
  '| Group | Cases | Coverage | Accuracy when answered | Wrong direction | Abstentions that were due |',
  '|---|---|---|---|---|---|',
  ...Object.entries(report.groups).map(([name, g]) => `| ${name} | ${g.cases} | ${ci(g.coverage)} | ${ci(g.accuracyWhenAnswered)} | ${ci(g.wrongDirection)} | ${ci(g.abstentionsDue)} |`),
  '',
  '## Precision of each call',
  '',
  '| Group | ' + [...VERDICTS, 'CANNOT VERIFY', 'REFUSED'].join(' | ') + ' |',
  '|---|' + [...VERDICTS, 'CANNOT VERIFY', 'REFUSED'].map(() => '---').join('|') + '|',
  ...Object.entries(report.groups).map(([name, g]) => `| ${name} | ${[...VERDICTS, 'CANNOT VERIFY', 'REFUSED'].map(c => (g.perCall[c] ? ci(g.perCall[c]) : '–')).join(' | ')} |`),
  '',
  '## Stated confidence against observed accuracy',
  '',
  ...Object.entries(report.groups).flatMap(([name, g]) => (g.confidence ? [
    `${name}: ${g.confidence.n} verdicts with a recorded confidence, expected calibration error ${g.confidence.ece}.`,
    '',
    '| Confidence | Verdicts | Mean confidence | Right |',
    '|---|---|---|---|',
    ...g.confidence.bins.filter(b => b.n).map(b => `| ${b.bin} | ${b.n} | ${b.meanConfidence} | ${pct(b.accuracy)} |`),
    '',
    `Answering only the most confident: ${g.confidence.curve.map(c => `top ${c.coverage * 100}% (confidence ≥ ${c.minConfidence}) ${pct(c.accuracy)} right`).join('; ')}.`,
    ''
  ] : [])),
  ''
].join('\n');
fs.writeFileSync(path.join(RESULTS, 'calibration.md'), md);
console.log(md);
