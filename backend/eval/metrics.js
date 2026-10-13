// backend/eval/metrics.js
// Classification and calibration metrics for the trust-analysis evaluation.
// All functions take arrays of { label, score } where label is 1 = real, 0 = fake
// and score is the pipeline's 0-10 trust score (higher = more trustworthy).

function confusionAt(items, threshold) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const it of items) {
    const pred = it.score >= threshold ? 1 : 0;
    if (pred === 1 && it.label === 1) tp++;
    else if (pred === 0 && it.label === 0) tn++;
    else if (pred === 1 && it.label === 0) fp++;
    else fn++;
  }
  return { tp, tn, fp, fn };
}

function classificationMetrics(items, threshold) {
  const { tp, tn, fp, fn } = confusionAt(items, threshold);
  const total = tp + tn + fp + fn;
  const accuracy = total ? (tp + tn) / total : 0;
  const precision = (tp + fp) ? tp / (tp + fp) : 0;
  const recall = (tp + fn) ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) ? 2 * precision * recall / (precision + recall) : 0;
  // Macro-F1: average of F1 for the "real" class and F1 for the "fake" class
  const precisionFake = (tn + fn) ? tn / (tn + fn) : 0;
  const recallFake = (tn + fp) ? tn / (tn + fp) : 0;
  const f1Fake = (precisionFake + recallFake)
    ? 2 * precisionFake * recallFake / (precisionFake + recallFake) : 0;
  const macroF1 = (f1 + f1Fake) / 2;
  return { threshold, accuracy, precision, recall, f1, f1Fake, macroF1, confusion: { tp, tn, fp, fn } };
}

// Threshold-free ranking quality: probability that a random real article
// scores higher than a random fake one (equivalent to ROC-AUC).
function rocAuc(items) {
  const pos = items.filter(i => i.label === 1).map(i => i.score);
  const neg = items.filter(i => i.label === 0).map(i => i.score);
  if (!pos.length || !neg.length) return null;
  let wins = 0, ties = 0;
  for (const p of pos) {
    for (const n of neg) {
      if (p > n) wins++;
      else if (p === n) ties++;
    }
  }
  return (wins + ties / 2) / (pos.length * neg.length);
}

// Pick the threshold that maximizes macro-F1 on a (validation) set.
function bestThreshold(items) {
  let best = { macroF1: -1, threshold: 5 };
  for (let t = 0.5; t <= 9.5; t += 0.5) {
    const m = classificationMetrics(items, t);
    if (m.macroF1 > best.macroF1) best = { macroF1: m.macroF1, threshold: t };
  }
  return best.threshold;
}

const sigmoid = z => 1 / (1 + Math.exp(-z));

// Platt scaling: fit p(real) = sigmoid(a * score/10 + b) on a validation set
// by minimizing log loss with plain gradient descent. Returns the mapping so
// raw trust scores can be converted into calibrated probabilities.
function plattFit(items, iterations = 2000, lr = 0.5) {
  let a = 1, b = 0;
  const n = items.length;
  for (let iter = 0; iter < iterations; iter++) {
    let gradA = 0, gradB = 0;
    for (const it of items) {
      const x = Math.max(0, Math.min(1, it.score / 10));
      const err = sigmoid(a * x + b) - it.label;
      gradA += err * x;
      gradB += err;
    }
    a -= lr * gradA / n;
    b -= lr * gradB / n;
  }
  return {
    a, b,
    apply: score => sigmoid(a * Math.max(0, Math.min(1, score / 10)) + b)
  };
}

// Expected Calibration Error. By default treats score/10 as P(article is real)
// and checks, per confidence bin, how far that probability is from the observed
// fraction of real articles. Pass probOf to evaluate a calibrated mapping
// instead. Returns ECE plus per-bin data for a reliability diagram.
function calibration(items, numBins = 10, probOf = it => it.score / 10) {
  const bins = Array.from({ length: numBins }, () => ({ n: 0, sumConf: 0, sumLabel: 0 }));
  for (const it of items) {
    const conf = Math.max(0, Math.min(1, probOf(it)));
    const b = Math.min(numBins - 1, Math.floor(conf * numBins));
    bins[b].n++;
    bins[b].sumConf += conf;
    bins[b].sumLabel += it.label;
  }
  let ece = 0;
  const binReport = bins.map((b, i) => {
    const avgConf = b.n ? b.sumConf / b.n : 0;
    const fracReal = b.n ? b.sumLabel / b.n : 0;
    ece += (b.n / items.length) * Math.abs(avgConf - fracReal);
    return {
      bin: `${(i / numBins).toFixed(1)}-${((i + 1) / numBins).toFixed(1)}`,
      n: b.n,
      meanConfidence: +avgConf.toFixed(3),
      observedFractionReal: +fracReal.toFixed(3)
    };
  });
  return { ece: +ece.toFixed(4), bins: binReport };
}

// 95% Wilson score interval for k successes in n trials. Unlike k/n ± 2 s.e.
// it stays inside [0, 1] and is honest about small samples: 3 of 3 right is
// 44–100%, not 100%.
function wilson(k, n, z = 1.96) {
  if (!n) return { low: 0, high: 1 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

module.exports = { classificationMetrics, rocAuc, bestThreshold, calibration, plattFit, wilson };
