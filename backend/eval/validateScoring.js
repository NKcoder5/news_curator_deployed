// backend/eval/validateScoring.js
//
// Is the new scoring actually better than the old one, and is its probability
// honest?
//
// Two questions, and they are not the same. A score can rank articles well and
// still lie about its own confidence. The old 0-10 number could not even be
// asked the second question, because it was not a probability of anything.
//
// Protocol
// --------
// Likelihood ratios are estimated on a training half and every reported figure
// comes from the held-out half, so nothing is tested on the data that produced
// it. The split is by a hash of the article id: deterministic, so the run is
// reproducible, and independent of the order records were written in.
//
// Reported
// --------
//   accuracy, macro-F1  - can it separate the classes at all
//   ROC-AUC             - how well it ranks, independent of any threshold
//   ECE (10 bins)       - whether a stated probability means what it says
//   Brier score         - accuracy and calibration together, in one number
//
// The old weighted sum is scored alongside on the identical held-out articles,
// mapped to [0,1] so that the two are comparable.
//
// THE CLAMP ABLATION
// ------------------
// --no-clamp turns off the rule that author-controlled evidence may not speak
// in an article's favour. Expect it to IMPROVE the numbers here, and expect
// that to be misleading: ISOT's fabrications are crude, so on this corpus
// polished writing genuinely does indicate a genuine article. The clamp gives
// up accuracy on ISOT in exchange for not being fooled by a competent
// fabrication — which is the case ISOT contains none of, and the adversarial
// benchmark contains ten of. Both numbers belong in the report.
//
// Usage:
//   node eval/validateScoring.js
//   node eval/validateScoring.js --no-clamp
//   node eval/validateScoring.js --bins 5
const fs = require('fs');
const path = require('path');
const { estimateFactor, estimateDamping, binFor } = require('./estimateWeights');

const args = process.argv.slice(2);
const NO_CLAMP = args.includes('--no-clamp');
// Validate on records whose measurement channel is known, matching
// estimateWeights.js --clean-only. Without it the held-out split is drawn from
// the pooled corpus while the ratios come from the clean one, which measures
// a model against data it was not estimated on in a way that is not a
// held-out test but a mismatch.
const CLEAN_ONLY = args.includes('--clean-only');
// --input <file.jsonl>: one run only, split by the article's own id, so two readings of the same articles
// (eval/runEval.js --ids-from) are tested on the same held-out half. Without it every run in the results
// folders is pooled, and two readings of one article count as two articles.
const INPUT = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'scoring-validation.json';

const FABRICATED = 0;

/** Deterministic train/test assignment from the article id. */
const isTestRecord = (id) => {
  const text = String(id);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 2 === 0;
};

const loadRecords = () => {
  const dirs = INPUT ? [] : ['results', 'results_archive_20260910_pre6factor', 'results_llama31_archive']
    .map(dir => path.join(__dirname, dir))
    .filter(dir => fs.existsSync(dir));
  const files = INPUT
    ? [path.resolve(INPUT)]
    : dirs.flatMap(dir => fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && !f.startsWith('smoke')).map(f => path.join(dir, f)));

  const records = [];
  {
    for (const filePath of files) {
      const file = path.basename(filePath);
      for (const line of fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/)) {
        try {
          const row = JSON.parse(line);
          if (!row.factors || (row.label !== 0 && row.label !== 1)) continue;
          const factors = { ...row.factors };
          delete factors.baseline;
          if (!Object.keys(factors).length) continue;

          const degraded = Array.isArray(row.degraded) ? row.degraded : null;
          if (degraded) {
            for (const name of degraded) delete factors[name];
            if (!Object.keys(factors).length) continue;
          } else if (CLEAN_ONLY) {
            continue;
          }
          records.push({ id: INPUT ? String(row.id) : `${file}:${row.id}`, label: row.label, factors });
        } catch (_) { /* ignore a truncated line */ }
      }
    }
  }
  return records;
};

const STYLE_FACTORS = ['clickbait', 'bias', 'manipulation', 'transparency'];

/**
 * Score one record with the weight-of-evidence model, using ratios estimated
 * on the training half only.
 *
 * Neither provenance nor corroboration is available on ISOT — source identity
 * is hidden to defeat the corpus's label leak, and historical articles have no
 * live coverage — so this measures the CONTENT half of the model in isolation.
 * That is the honest scope of the claim.
 */
const scoreRecord = (record, model) => {
  let decibans = model.priorDecibans;
  let styleTotal = 0;

  for (const [name, value] of Object.entries(record.factors)) {
    const estimate = model.factors[name];
    if (!estimate || !estimate.estimated) continue;
    const bin = estimate.bins[binFor(value, model.binCount)];
    let weight = bin.decibans;
    if (!NO_CLAMP && STYLE_FACTORS.includes(name)) weight = Math.max(0, weight);
    if (STYLE_FACTORS.includes(name)) styleTotal += weight;
    else decibans += weight;
  }

  const damped = styleTotal * model.damping;
  const capped = Math.sign(damped) * Math.min(Math.abs(damped), model.styleCap);
  decibans += capped;

  const odds = 10 ** (decibans / 10);
  return { decibans, probability: odds / (1 + odds) };
};

/**
 * Platt scaling: fit P = sigmoid(a·x + b) on the training half.
 *
 * This is not cosmetic. Discarding exculpatory evidence — the clamp — leaves
 * genuine articles bunched at the prior and makes the raw posterior
 * systematically under-confident in both directions. The ranking is sound; the
 * mapping from ranking to probability is not, and that is exactly what a
 * calibration map repairs. Fitted on train, reported on test, ECE given before
 * and after so the correction is visible rather than assumed.
 */
const fitPlatt = (samples, iterations = 4000, learningRate = 0.02) => {
  let a = 1;
  let b = 0;
  const n = samples.length;
  for (let step = 0; step < iterations; step++) {
    let gradA = 0;
    let gradB = 0;
    for (const { x, y } of samples) {
      const predicted = 1 / (1 + Math.exp(-(a * x + b)));
      const error = predicted - y;
      gradA += error * x;
      gradB += error;
    }
    a -= learningRate * (gradA / n);
    b -= learningRate * (gradB / n);
  }
  return { a, b };
};

const applyPlatt = ({ a, b }, x) => 1 / (1 + Math.exp(-(a * x + b)));

/**
 * Isotonic regression by pool-adjacent-violators.
 *
 * Platt assumes the miscalibration is a smooth sigmoid squeeze. Ours is not:
 * the clamp collapses every well-written article onto the prior, so half the
 * corpus lands on a single score and a two-parameter curve cannot separate what
 * is piled up there. Isotonic regression fits any monotone map, which is the
 * only assumption we actually want to make — a higher weight of evidence should
 * never mean a lower probability.
 *
 * Returns a step function stored as breakpoints, which is small enough to ship
 * in the weights file and simple enough to audit by reading it.
 */
const fitIsotonic = (samples) => {
  const sorted = [...samples].sort((p, q) => p.x - q.x);
  // Each point starts as its own block; adjacent blocks that violate
  // monotonicity are pooled until none remain.
  const blocks = sorted.map(s => ({ sum: s.y, count: 1, value: s.y, minX: s.x, maxX: s.x }));

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].value > blocks[i + 1].value) {
        const next = blocks[i + 1];
        blocks[i].sum += next.sum;
        blocks[i].count += next.count;
        blocks[i].value = blocks[i].sum / blocks[i].count;
        blocks[i].maxX = next.maxX;
        blocks.splice(i + 1, 1);
        merged = true;
        break;
      }
    }
  }

  return blocks.map(b => ({ upTo: round(b.maxX, 4), probability: round(b.value, 4), n: b.count }));
};

const applyIsotonic = (breakpoints, x) => {
  for (const point of breakpoints) {
    if (x <= point.upTo) return point.probability;
  }
  return breakpoints.length ? breakpoints[breakpoints.length - 1].probability : 0.5;
};

/** The rule this replaces: a weighted mean of factor scores, mapped to [0,1]. */
const legacyProbability = (record) => {
  const weights = { sourceReputation: 0.15, clickbait: 0.10, bias: 0.15, manipulation: 0.15, transparency: 0.18 };
  let total = 0;
  let used = 0;
  for (const [name, value] of Object.entries(record.factors)) {
    if (weights[name] === undefined) continue;
    total += value * weights[name];
    used += weights[name];
  }
  if (used === 0) return 0.5;
  const trust = total / used;          // 0-10, high = trustworthy
  return 1 - (trust / 10);             // convert to P(fake) so the two are comparable
};

const metrics = (scored) => {
  const n = scored.length;
  const correct = scored.filter(s => (s.probability >= 0.5 ? FABRICATED : 1) === s.label).length;

  // ROC-AUC via the Mann-Whitney statistic, with ties handled by mid-rank.
  const fake = scored.filter(s => s.label === FABRICATED).map(s => s.probability);
  const real = scored.filter(s => s.label !== FABRICATED).map(s => s.probability);
  let wins = 0;
  for (const f of fake) for (const r of real) wins += f > r ? 1 : (f === r ? 0.5 : 0);
  const auc = fake.length && real.length ? wins / (fake.length * real.length) : NaN;

  // Expected calibration error over ten equal-width bins.
  const bins = Array.from({ length: 10 }, () => ({ total: 0, fabricated: 0, confidence: 0 }));
  for (const s of scored) {
    const index = Math.min(9, Math.floor(s.probability * 10));
    bins[index].total++;
    bins[index].confidence += s.probability;
    if (s.label === FABRICATED) bins[index].fabricated++;
  }
  let ece = 0;
  const reliability = [];
  for (const [index, bin] of bins.entries()) {
    if (!bin.total) continue;
    const observed = bin.fabricated / bin.total;
    const stated = bin.confidence / bin.total;
    ece += (bin.total / n) * Math.abs(observed - stated);
    reliability.push({ band: `${index / 10}-${(index + 1) / 10}`, n: bin.total, stated: round(stated, 3), observed: round(observed, 3) });
  }

  const brier = scored.reduce((sum, s) => sum + (s.probability - (s.label === FABRICATED ? 1 : 0)) ** 2, 0) / n;

  // Macro-F1 over both classes.
  const f1For = (positive) => {
    const tp = scored.filter(s => s.label === positive && (s.probability >= 0.5 ? FABRICATED : 1) === positive).length;
    const fp = scored.filter(s => s.label !== positive && (s.probability >= 0.5 ? FABRICATED : 1) === positive).length;
    const fn = scored.filter(s => s.label === positive && (s.probability >= 0.5 ? FABRICATED : 1) !== positive).length;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  };

  // Calibration error split by which way the system is leaning.
  //
  // A single ECE hides the most important thing about an adversarial detector.
  // Refusing to believe that a polished article is genuine — because polish is
  // exactly what a fabricator produces — makes the system deliberately
  // under-confident when it exonerates, and that shows up as calibration error
  // whether or not the caution is justified. What matters is whether it is
  // honest WHEN IT ACCUSES. Reported separately so the trade is visible instead
  // of averaged into one misleading number.
  const partialEce = (subset) => {
    if (!subset.length) return null;
    const localBins = Array.from({ length: 10 }, () => ({ total: 0, fabricated: 0, confidence: 0 }));
    for (const s of subset) {
      const index = Math.min(9, Math.floor(s.probability * 10));
      localBins[index].total++;
      localBins[index].confidence += s.probability;
      if (s.label === FABRICATED) localBins[index].fabricated++;
    }
    let value = 0;
    for (const bin of localBins) {
      if (!bin.total) continue;
      value += (bin.total / subset.length) * Math.abs((bin.fabricated / bin.total) - (bin.confidence / bin.total));
    }
    return round(value, 4);
  };

  const flagged = scored.filter(s => s.probability >= 0.5);
  const notFlagged = scored.filter(s => s.probability < 0.5);

  return {
    n,
    accuracy: round(correct / n, 4),
    macroF1: round((f1For(0) + f1For(1)) / 2, 4),
    rocAuc: round(auc, 4),
    ece: round(ece, 4),
    eceWhenAccusing: partialEce(flagged),
    eceWhenExonerating: partialEce(notFlagged),
    flaggedCount: flagged.length,
    // Of the articles it flagged, how many really were fabricated.
    precisionWhenAccusing: flagged.length ? round(flagged.filter(s => s.label === FABRICATED).length / flagged.length, 4) : null,
    brier: round(brier, 4),
    reliability
  };
};

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const main = () => {
  const records = loadRecords();
  const train = records.filter(r => !isTestRecord(r.id));
  const test = records.filter(r => isTestRecord(r.id));

  if (test.length < 50) {
    console.error(`Only ${test.length} held-out records — not enough to report on.`);
    process.exit(1);
  }

  const factorNames = [...new Set(train.flatMap(r => Object.keys(r.factors)))];
  const factors = Object.fromEntries(factorNames.map(name => [name, estimateFactor(train, name)]));
  const damping = estimateDamping(train, factorNames.filter(n => STYLE_FACTORS.includes(n)));

  // The base rate of the training half, which is the honest prior for a corpus
  // whose composition we know.
  const baseRate = train.filter(r => r.label === FABRICATED).length / train.length;
  const declared = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/evidenceWeights.json'), 'utf8')).declared;

  const model = {
    factors,
    binCount: 5,
    damping: damping.damping,
    styleCap: declared.styleWeightCap.value,
    priorDecibans: 10 * Math.log10(baseRate / (1 - baseRate))
  };

  const newScored = test.map(r => {
    const { decibans, probability } = scoreRecord(r, model);
    return { label: r.label, probability, decibans };
  });
  const oldScored = test.map(r => ({ label: r.label, probability: legacyProbability(r) }));

  // Calibration map fitted on the training half only, in log-odds space.
  const platt = fitPlatt(train.map(r => ({
    x: scoreRecord(r, model).decibans / 10,
    y: r.label === FABRICATED ? 1 : 0
  })));
  const newCalibrated = newScored.map(s => ({
    label: s.label,
    probability: Math.min(0.98, Math.max(0.002, applyPlatt(platt, s.decibans / 10)))
  }));

  const isotonic = fitIsotonic(train.map(r => ({
    x: scoreRecord(r, model).decibans,
    y: r.label === FABRICATED ? 1 : 0
  })));
  const newIsotonic = newScored.map(s => ({
    label: s.label,
    probability: Math.min(0.98, Math.max(0.002, applyIsotonic(isotonic, s.decibans)))
  }));

  // The shipped path, exactly as agents/weightOfEvidence.js runs it: calibrate,
  // then apply the one-sided clamp and the cap to the CALIBRATED weight, then
  // add the prior. Calibrating without re-clamping quietly reverses the clamp,
  // because the map is fitted on a corpus where a clean style genuinely does
  // predict a genuine article.
  const corpusDecibans = 10 * Math.log10(baseRate / (1 - baseRate));
  const productionScored = test.map(r => {
    const raw = scoreRecord(r, model).decibans - model.priorDecibans;
    const calibratedProbability = applyIsotonic(isotonic, raw + model.priorDecibans);
    const calibrated = 10 * Math.log10(calibratedProbability / (1 - calibratedProbability)) - corpusDecibans;
    const admitted = NO_CLAMP
      ? Math.min(declared.styleWeightCap.value, calibrated)
      : Math.min(declared.styleWeightCap.value, Math.max(0, calibrated));
    const total = model.priorDecibans + admitted;
    const odds = 10 ** (total / 10);
    return {
      label: r.label,
      probability: Math.min(0.98, Math.max(0.002, odds / (1 + odds)))
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    clampEnabled: !NO_CLAMP,
    trainRecords: train.length,
    testRecords: test.length,
    trainBaseRate: round(baseRate, 4),
    plattScaling: { a: round(platt.a, 4), b: round(platt.b, 4), fittedOn: 'training half only' },
    weightOfEvidence: metrics(newScored),
    weightOfEvidenceCalibrated: metrics(newCalibrated),
    weightOfEvidenceIsotonic: metrics(newIsotonic),
    productionPath: metrics(productionScored),
    isotonicMap: isotonic,
    legacyWeightedSum: metrics(oldScored),
    note: 'ISOT only, content factors only: source identity is hidden on this corpus and historical articles have no live coverage, so neither provenance nor corroboration is exercised here. The adversarial benchmark covers what this cannot.'
  };

  fs.writeFileSync(path.join(__dirname, 'results', OUT), JSON.stringify(result, null, 2));

  const line = (label, m) =>
    `${label.padEnd(24)} acc ${String(m.accuracy).padEnd(8)} AUC ${String(m.rocAuc).padEnd(8)} ECE ${String(m.ece).padEnd(8)} ECE-accusing ${String(m.eceWhenAccusing).padEnd(8)} precision ${m.precisionWhenAccusing}`;

  console.log(`\nHeld-out validation — trained on ${train.length}, tested on ${test.length} articles`);
  console.log(`Author-controlled clamp: ${NO_CLAMP ? 'OFF' : 'ON'}\n`);
  console.log(line('Weight of evidence (raw)', result.weightOfEvidence));
  console.log(line('  + Platt calibration', result.weightOfEvidenceCalibrated));
  console.log(line('  + isotonic calibration', result.weightOfEvidenceIsotonic));
  console.log(line('SHIPPED path', result.productionPath));
  console.log(line('Legacy weighted sum', result.legacyWeightedSum));
  console.log('\nCalibration after isotonic (stated vs observed rate of fabrication):');
  for (const band of result.weightOfEvidenceIsotonic.reliability) {
    console.log(`   ${band.band.padEnd(10)} n=${String(band.n).padStart(4)}   says ${String(band.stated).padEnd(7)} actually ${band.observed}`);
  }
  console.log(`\nWritten to ${path.relative(process.cwd(), path.join(__dirname, 'results', OUT))}`);
};

main();
