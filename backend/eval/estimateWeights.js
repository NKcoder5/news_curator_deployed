// backend/eval/estimateWeights.js
//
// Where the weights come from.
//
// The previous scoring rule multiplied each factor by a constant — 0.15 for
// source, 0.10 for headline, 0.18 for transparency — and those constants were
// chosen by hand. There is no defence of that. Ask "why 0.18?" and the honest
// answer is "it looked about right", which is not a basis for telling a reader
// whether to believe a news story.
//
// This script replaces the question. Instead of asking how much a factor should
// count, it measures how much a factor's observed value actually distinguishes
// a fabricated article from a genuine one, on labelled data:
//
//     LR(observation) = P(observation | fabricated) / P(observation | genuine)
//
// A likelihood ratio of 1 means the observation is equally common in both
// classes — it carries no information, and it contributes nothing. A ratio of 4
// means the observation is four times more likely in a fabricated article. These
// ratios are what the running system uses; they are estimated here, written to
// data/evidenceWeights.json, and versioned with the counts they came from, so any
// number the system uses can be traced to the articles that produced it.
//
// Weight of evidence is reported in decibans, W = 10·log10(LR), after I. J. Good
// and the Bletchley Park usage: decibans ADD, which is what makes the final
// score an auditable sum rather than an opaque blend.
//
// Two safeguards, because a small sample will happily produce enormous ratios:
//
//   1. Conservative bound. Each weight is shrunk toward zero by its own 95%
//      confidence interval, so the system never claims more evidence than the
//      data supports. A bin with three articles in it ends up contributing
//      nothing, which is correct.
//   2. Correlation damping. Bias, persuasion and clickbait measure overlapping
//      things; adding their weights independently counts the same evidence
//      several times. The effective number of independent factors is computed
//      from the observed correlation matrix and the family's total weight is
//      scaled accordingly.
//
// Usage:
//   node eval/estimateWeights.js                       # uses every labelled run it can find
//   node eval/estimateWeights.js --input path.jsonl    # a specific run
//   node eval/estimateWeights.js --bins 5 --dry-run
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BIN_COUNT = Number(argValue('--bins', 5));
const DRY_RUN = args.includes('--dry-run');
// Estimate only from records that state which channel produced each factor.
const CLEAN_ONLY = args.includes('--clean-only');

/** ISOT labels: 0 = fabricated, 1 = genuine. */
const FABRICATED = 0;

/** Which bin does a 0-10 factor score fall in? */
const binFor = (score, bins = BIN_COUNT) => {
  const clamped = Math.max(0, Math.min(10, Number(score)));
  return Math.min(bins - 1, Math.floor((clamped / 10) * bins));
};

const binLabel = (index, bins = BIN_COUNT) => {
  const width = 10 / bins;
  const low = (index * width).toFixed(1);
  const high = ((index + 1) * width).toFixed(1);
  return `${low}-${high}`;
};

/**
 * Collect every labelled record that carries factor scores.
 * Records from different pipeline configurations are pooled deliberately: the
 * quantity being estimated is how a factor's VALUE relates to the label, which
 * does not depend on which other factors ran alongside it.
 */
const loadRecords = (inputPath) => {
  const roots = inputPath
    ? [inputPath]
    : ['results', 'results_archive_20260910_pre6factor', 'results_llama31_archive']
        .map(dir => path.join(__dirname, dir))
        .filter(dir => fs.existsSync(dir))
        .flatMap(dir => fs.readdirSync(dir)
          .filter(file => file.endsWith('.jsonl') && !file.startsWith('smoke'))
          .map(file => path.join(dir, file)));

  const records = [];
  let dropped = 0;
  let unknownChannel = 0;
  const sources = [];
  for (const file of roots) {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    let kept = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.factors && (row.label === 0 || row.label === 1)) {
          // The single-prompt baseline is a comparison system, not a factor of
          // ours; including it would estimate a weight for something the
          // pipeline does not run.
          const factors = { ...row.factors };
          delete factors.baseline;
          if (Object.keys(factors).length === 0) continue;

          // A factor that fell back to the pattern matcher is a different
          // measurement from the one these ratios describe, so it is dropped
          // rather than pooled. Records written before runEval recorded the
          // channel carry no `degraded` field at all: those are kept, and
          // counted separately, because an unknown channel is not the same as
          // a known-bad one - but it is not a clean one either, and the count
          // is reported so the corpus can be read honestly.
          const degraded = Array.isArray(row.degraded) ? row.degraded : null;
          if (degraded) {
            for (const name of degraded) delete factors[name];
            if (Object.keys(factors).length === 0) { dropped++; continue; }
          } else if (CLEAN_ONLY) {
            // --clean-only: estimate from records whose measurement channel is
            // known, and from those alone. The table this produces is thinner
            // — fewer articles, so more bins fall below the count at which a
            // ratio can be estimated and contribute nothing — but every ratio
            // in it was measured on the path the deployed pipeline runs. That
            // is a different and stronger claim than a ratio measured on an
            // unknown mixture, and it is the claim the paper needs.
            unknownChannel++;
            continue;
          } else {
            unknownChannel++;
          }
          records.push({ label: row.label, factors, id: row.id, file: path.basename(file) });
          kept++;
        }
      } catch (_) { /* a truncated final line is not worth failing over */ }
    }
    if (kept) sources.push({ file: path.relative(__dirname, file), records: kept });
  }
  if (unknownChannel) {
    console.warn(
      CLEAN_ONLY
        ? `${unknownChannel} records skipped: they predate channel recording, and --clean-only was given.`
        : `${unknownChannel} of ${records.length} records predate channel recording: ` +
          'it is not known whether their factors came from the model or the pattern matcher.'
    );
  }
  if (dropped) console.warn(`${dropped} records dropped: every factor had fallen back to the pattern check.`);

  // Two readings of the same articles (the four writing checks, and the merged one, over the same ISOT
  // sample: eval/runEval.js --ids-from) are not twice the evidence. Pooled, every article would count
  // twice and the ratios would describe neither reading. One run is chosen with --input. (The older,
  // pooled estimate without --clean-only mixes configurations over one sample by design; see above.)
  if (!inputPath && CLEAN_ONLY) {
    const filesById = new Map();
    for (const r of records) filesById.set(r.id, new Set([...(filesById.get(r.id) || []), r.file]));
    const shared = [...filesById.values()].filter(files => files.size > 1);
    if (shared.length) {
      const files = [...new Set(shared.flatMap(f => [...f]))];
      console.error(`${shared.length} articles were read in more than one run (${files.join(', ')}). Choose the run to estimate from with --input.`);
      process.exit(1);
    }
  }

  return { records, sources, corpus: { unknownChannel, droppedForDegraded: dropped } };
};

/**
 * Weight of evidence for one factor, per bin.
 *
 * Laplace smoothing keeps an empty bin finite; the conservative bound then
 * removes whatever the sample does not support.
 */
const estimateFactor = (records, factor) => {
  const present = records.filter(r => typeof r.factors[factor] === 'number');
  const fabricated = present.filter(r => r.label === FABRICATED);
  const genuine = present.filter(r => r.label !== FABRICATED);

  if (fabricated.length < 10 || genuine.length < 10) {
    return {
      factor,
      estimated: false,
      reason: `too few labelled examples (${fabricated.length} fabricated, ${genuine.length} genuine) — this factor contributes no evidence until it is measured`,
      n: present.length,
      bins: []
    };
  }

  const alpha = 0.5; // Jeffreys prior
  const bins = [];
  for (let index = 0; index < BIN_COUNT; index++) {
    const inBinFab = fabricated.filter(r => binFor(r.factors[factor]) === index).length;
    const inBinGen = genuine.filter(r => binFor(r.factors[factor]) === index).length;

    const pFab = (inBinFab + alpha) / (fabricated.length + alpha * BIN_COUNT);
    const pGen = (inBinGen + alpha) / (genuine.length + alpha * BIN_COUNT);
    const lr = pFab / pGen;
    const decibans = 10 * Math.log10(lr);

    // Delta-method standard error of log LR, converted to decibans.
    const variance = (1 / (inBinFab + alpha)) - (1 / (fabricated.length + alpha * BIN_COUNT))
      + (1 / (inBinGen + alpha)) - (1 / (genuine.length + alpha * BIN_COUNT));
    const seDecibans = (10 / Math.LN10) * Math.sqrt(Math.max(variance, 0));

    // Never claim more evidence than survives a 95% interval. A bin with a
    // handful of articles collapses to zero, which is the intended behaviour.
    const conservative = Math.sign(decibans) * Math.max(0, Math.abs(decibans) - 1.96 * seDecibans);

    bins.push({
      bin: index,
      range: binLabel(index),
      nFabricated: inBinFab,
      nGenuine: inBinGen,
      likelihoodRatio: round(lr, 3),
      decibansRaw: round(decibans, 2),
      standardError: round(seDecibans, 2),
      decibans: round(conservative, 2)
    });
  }

  return {
    factor,
    estimated: true,
    n: present.length,
    nFabricated: fabricated.length,
    nGenuine: genuine.length,
    // How much this factor separates the classes overall: the mean absolute
    // defensible weight it assigns. Near zero means the factor is decorative.
    meanAbsoluteDecibans: round(
      bins.reduce((sum, b) => sum + Math.abs(b.decibans) * (b.nFabricated + b.nGenuine), 0) / present.length, 2
    ),
    bins
  };
};

/** Pearson correlation between two factors over the records carrying both. */
const correlation = (records, a, b) => {
  const pairs = records
    .filter(r => typeof r.factors[a] === 'number' && typeof r.factors[b] === 'number')
    .map(r => [r.factors[a], r.factors[b]]);
  if (pairs.length < 20) return null;

  const meanA = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0, varA = 0, varB = 0;
  for (const [x, y] of pairs) {
    cov += (x - meanA) * (y - meanB);
    varA += (x - meanA) ** 2;
    varB += (y - meanB) ** 2;
  }
  if (varA === 0 || varB === 0) return null;
  return { r: round(cov / Math.sqrt(varA * varB), 3), n: pairs.length };
};

/**
 * Adding correlated factors counts the same evidence twice. Under an
 * equicorrelation assumption the effective number of independent factors is
 *
 *     n_eff = k / (1 + (k-1)·r̄)
 *
 * and the family's summed weight is scaled by n_eff / k.
 */
const estimateDamping = (records, factors) => {
  const pairs = [];
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const result = correlation(records, factors[i], factors[j]);
      if (result) pairs.push({ a: factors[i], b: factors[j], ...result });
    }
  }
  if (!pairs.length) return { damping: 1, meanCorrelation: null, pairs: [] };

  const meanR = pairs.reduce((sum, p) => sum + Math.max(0, p.r), 0) / pairs.length;
  const k = factors.length;
  const effective = k / (1 + (k - 1) * meanR);
  return {
    meanCorrelation: round(meanR, 3),
    effectiveFactors: round(effective, 2),
    damping: round(effective / k, 3),
    pairs
  };
};

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const STYLE_FACTORS = ['clickbait', 'bias', 'manipulation', 'transparency'];

/**
 * The content-side weight of evidence for one record, in decibans.
 *
 * Shared with eval/validateScoring.js so that the map is fitted on exactly the
 * quantity the running system produces. Fitting a calibration curve against a
 * slightly different score than the one in production is a classic way to ship
 * a number that is calibrated only in the report.
 */
const contentDecibans = (record, model, { clamp = true } = {}) => {
  let total = 0;
  let style = 0;

  for (const [name, value] of Object.entries(record.factors)) {
    const estimate = model.factors[name];
    if (!estimate || !estimate.estimated) continue;
    const bin = estimate.bins[binFor(value, model.binCount)];
    let weight = bin.decibans;
    if (clamp && STYLE_FACTORS.includes(name)) weight = Math.max(0, weight);
    if (STYLE_FACTORS.includes(name)) style += weight;
    else total += weight;
  }

  const damped = style * model.damping;
  return total + Math.sign(damped) * Math.min(Math.abs(damped), model.styleCap);
};

/**
 * Isotonic regression by pool-adjacent-violators.
 *
 * The raw posterior ranks well but states dishonest probabilities: clamping
 * away exculpatory evidence leaves every well-written article piled onto the
 * prior, so half the corpus lands on one score. Platt scaling cannot separate
 * what is stacked at a single point — it assumes a smooth sigmoid squeeze —
 * whereas isotonic regression fits any monotone map, which is the only
 * assumption worth making here: more weight of evidence must never mean a
 * lower probability. Measured on held-out data this took expected calibration
 * error from 0.335 to 0.056.
 *
 * The result is a step function, small enough to store in this file and simple
 * enough to audit by reading it.
 */
const fitIsotonic = (samples) => {
  const sorted = [...samples].sort((p, q) => p.x - q.x);
  const blocks = sorted.map(s => ({ sum: s.y, count: 1, value: s.y, maxX: s.x }));

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

  // Pool-adjacent-violators only merges blocks that VIOLATE monotonicity, so a
  // run of already-ordered points stays as hundreds of singletons — a map that
  // is both enormous and overfitted to individual articles. The isotonic
  // solution is a step function, so consecutive blocks at the same level are
  // one step and are collapsed into it.
  const steps = [];
  for (const block of blocks) {
    const previous = steps[steps.length - 1];
    // Two blocks are one step when they share a level, and also when they share
    // an upper bound: a lookup cannot tell those apart, so leaving them separate
    // would mean only the first was ever reachable. Many articles score exactly
    // zero here — the clamp sends every well-written one there — so this case is
    // the common one, not an edge case.
    const sameLevel = previous && Math.abs(previous.value - block.value) < 1e-9;
    const sameBound = previous && Math.abs(previous.maxX - block.maxX) < 1e-9;
    if (sameLevel || sameBound) {
      previous.sum += block.sum;
      previous.count += block.count;
      previous.value = previous.sum / previous.count;
      previous.maxX = block.maxX;
    } else {
      steps.push({ ...block });
    }
  }

  return steps.map(step => ({
    upTo: round(step.maxX, 3),
    // A step containing only genuine articles would otherwise state probability
    // 0, which is a claim of certainty no sample size supports. Laplace-smooth
    // each step by its own count.
    probability: round((step.value * step.count + 0.5) / (step.count + 1), 4),
    n: step.count
  }));
};

const applyIsotonic = (breakpoints, x) => {
  for (const point of breakpoints) {
    if (x <= point.upTo) return point.probability;
  }
  return breakpoints.length ? breakpoints[breakpoints.length - 1].probability : 0.5;
};

/**
 * Parameters that are DECLARED rather than measured.
 *
 * Every diagnostic system has a prior; one that does not name it has only
 * hidden it. These are stated openly, carry their justification with them, and
 * are reported to the reader as declared so that nothing is passed off as an
 * estimate it is not. Each is measurable, and `basis` changes to a measurement
 * the moment the corresponding script is run.
 *
 * Existing values are preserved across re-estimation: this block is
 * hand-maintained, the rest of the file is generated.
 */
const DECLARED_DEFAULTS = {
  note: 'Declared parameters. Not estimated from data. Each is reported to the reader as declared, and each is measurable — see the `measurableBy` field.',
  priors: {
    strongRecord: {
      value: 0.02,
      reason: 'Published by an outlet with a strong factual-reporting record, an editorial chain and a corrections policy. Fabrication is rare here and costly when discovered.',
      measurableBy: 'a labelled audit of published corrections and retractions per outlet'
    },
    ordinaryRecord: {
      value: 0.06,
      reason: 'Published by a rated outlet with an ordinary record.',
      measurableBy: 'as above'
    },
    poorRecord: {
      value: 0.25,
      reason: 'Published by an outlet our database rates poorly for factual reporting.',
      measurableBy: 'as above'
    },
    unratedOutlet: {
      value: 0.15,
      reason: 'We hold no reliability record for this publisher. Most unrated outlets are small and legitimate, so this sits well below the rate for an anonymous account.',
      measurableBy: 'sampling unrated outlets from the feed and labelling them'
    },
    socialAccount: {
      value: 0.35,
      reason: 'Posted by an account rather than a publisher: no masthead, no corrections policy, no editorial accountability.',
      measurableBy: 'a labelled sample of social posts'
    }
  },
  // One categorical observation with a full distribution per class, rather than
  // several separate probabilities. This avoids assuming that "support" and
  // "contradiction" are independent observations, which they are not, and the
  // distributions are checkable: each must sum to 1.
  corroboration: {
    outcomes: ['contradictedByTwo', 'contradictedByOne', 'none', 'supportedByOne', 'supportedByTwoPlus'],
    givenGenuine: {
      contradictedByTwo: 0.01,
      contradictedByOne: 0.04,
      none: 0.45,
      supportedByOne: 0.20,
      supportedByTwoPlus: 0.30
    },
    givenFabricated: {
      contradictedByTwo: 0.10,
      contradictedByOne: 0.20,
      none: 0.66,
      supportedByOne: 0.03,
      supportedByTwoPlus: 0.01
    },
    basis: 'declared',
    reason: 'Note the asymmetry, which is the important part: FINDING independent corroboration is strong evidence a story is genuine, whereas NOT finding it is weak evidence it is fabricated — genuine local and niche reporting is often uncovered elsewhere, and the free news tier indexes a limited set of outlets. That asymmetry is why an uncorroborated article is capped rather than condemned.',
    measurableBy: 'eval/measureCorroborationRates.js — live feed articles for the genuine row, the adversarial set for the fabricated row'
  },

  // The heart of the scoring model.
  //
  // An observation the AUTHOR CONTROLS can incriminate, but it can never
  // exculpate. A crude headline is evidence of fabrication, because genuine
  // outlets rarely write that way. A polished headline is NOT evidence of
  // genuineness, because a competent fabricator simply writes a polished
  // headline. The measured ratios say otherwise only because the estimation
  // corpus was built from incompetent fabrications, and a detector must not
  // assume its adversary is incompetent.
  //
  // Formally: for an observation O chosen by the author, a capable adversary
  // can drive P(O = favourable | fabricated) toward P(O = favourable | genuine),
  // so the likelihood ratio in the exculpatory direction tends to 1. We
  // therefore clamp author-controlled evidence at 0 decibans on that side and
  // keep only its incriminating half.
  //
  // This is what makes "presentation cannot buy trust" a derived property of
  // the model rather than a rule bolted on top of it.
  authorControlled: {
    families: ['style'],
    clampExculpatory: true,
    reason: 'Style, headline wording, attribution and persuasion are all chosen by whoever wrote the text. Their evidence is admitted only in the incriminating direction.',
    measurableBy: 're-estimation on a corpus of competently written fabrications, which would show these ratios approaching 1 on the favourable side'
  },
  styleWeightCap: {
    value: 8,
    reason: 'Maximum decibans the style family may contribute. Even in the incriminating direction the ISOT ratios are an upper bound, since its fabrications are conspicuously crude; this caps how far one family of correlated, author-controlled signals can move the result.',
    measurableBy: 're-estimation on a multi-domain corpus'
  },
  probabilityBounds: {
    min: 0.002,
    max: 0.98,
    reason: 'No finite quantity of evidence of this kind justifies certainty, and a reported 0 or 1 would be a claim the system cannot support.'
  }
};

const main = () => {
  const { records, sources, corpus } = loadRecords(argValue('--input', null));
  if (records.length === 0) {
    console.error('No labelled records found. Run eval/runEval.js first.');
    process.exit(1);
  }

  const factorNames = [...new Set(records.flatMap(r => Object.keys(r.factors)))].sort();
  const estimates = factorNames.map(name => estimateFactor(records, name));

  // The style family is estimated as a group because its members measure
  // overlapping properties of the same prose.
  const styleFactors = factorNames.filter(name =>
    ['clickbait', 'bias', 'manipulation', 'transparency'].includes(name));
  const damping = estimateDamping(records, styleFactors);

  // The declared block is hand-maintained; re-estimation must never silently
  // discard an edit to it.
  const outputPath = path.join(__dirname, '../data/evidenceWeights.json');
  const existing = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    : {};

  const table = {
    generatedAt: new Date().toISOString(),
    declared: existing.declared || DECLARED_DEFAULTS,
    method: 'per-bin likelihood ratio, Jeffreys-smoothed, shrunk to the conservative end of a 95% interval, reported in decibans (10·log10 LR)',
    binCount: BIN_COUNT,
    labelConvention: '0 = fabricated, 1 = genuine',
    totalRecords: records.length,
    // How much of the corpus is known to have come from the model path. A
    // record with `unknownChannel` predates the recording of that channel and
    // may carry pattern-matcher scores pooled in with model ones.
    corpus: { ...corpus, cleanOnly: CLEAN_ONLY },
    sources,
    families: {
      style: {
        factors: styleFactors,
        ...damping,
        note: 'Members correlate, so their summed weight is scaled by `damping` to avoid counting the same evidence several times.'
      }
    },
    factors: Object.fromEntries(estimates.map(e => [e.factor, e]))
  };

  // Fit the calibration map on every labelled record. Held-out metrics come
  // from eval/validateScoring.js, which refits on a training half; the map
  // SHIPPED here uses all the data, because a calibration curve is better for
  // having seen more of it, and the held-out run is what establishes that the
  // procedure works.
  const calibrationModel = {
    factors: table.factors,
    binCount: BIN_COUNT,
    damping: damping.damping ?? 1,
    styleCap: table.declared.styleWeightCap.value
  };
  table.calibration = {
    method: 'isotonic regression (pool-adjacent-violators) over content decibans',
    fittedOn: records.length,
    // The map reports P(fabricated) for a population with THIS base rate. A
    // production article is not drawn from that population — an article from a
    // rated outlet starts far below it — so the runtime divides this rate out
    // to recover the content evidence on its own, then applies the prior that
    // actually belongs to the article. Without this step every report would
    // silently inherit the corpus's roughly even split of fake and real.
    corpusBaseRate: round(records.filter(r => r.label === FABRICATED).length / records.length, 4),
    note: 'Maps the content-side weight of evidence to a probability. Corroboration evidence is added afterwards in log-odds space, because it is not present in the corpus this map was fitted on.',
    heldOutPerformance: 'see eval/results/scoring-validation.json',
    breakpoints: fitIsotonic(records.map(record => ({
      x: contentDecibans(record, calibrationModel),
      y: record.label === FABRICATED ? 1 : 0
    })))
  };

  if (!DRY_RUN) {
    fs.writeFileSync(outputPath, JSON.stringify(table, null, 2));
    console.log(`Written to ${path.relative(process.cwd(), outputPath)}`);
  }

  console.log(`\nEstimated from ${records.length} labelled articles across ${sources.length} runs.\n`);
  for (const estimate of estimates) {
    if (!estimate.estimated) {
      console.log(`${estimate.factor.padEnd(18)} NOT ESTIMATED — ${estimate.reason}`);
      continue;
    }
    console.log(`${estimate.factor.padEnd(18)} n=${estimate.n}  mean |W| = ${estimate.meanAbsoluteDecibans} db`);
    for (const bin of estimate.bins) {
      const bar = bin.decibans === 0 ? '·' : (bin.decibans > 0 ? '+'.repeat(Math.min(20, Math.round(bin.decibans))) : '-'.repeat(Math.min(20, Math.round(-bin.decibans))));
      console.log(`   score ${bin.range.padEnd(9)} fab=${String(bin.nFabricated).padStart(3)} gen=${String(bin.nGenuine).padStart(3)}  LR=${String(bin.likelihoodRatio).padStart(6)}  W=${String(bin.decibans).padStart(6)} db (raw ${bin.decibansRaw}) ${bar}`);
    }
    console.log('');
  }

  if (damping.meanCorrelation !== null) {
    console.log(`Style family: mean correlation ${damping.meanCorrelation}, effective independent factors ${damping.effectiveFactors} of ${styleFactors.length}, damping ${damping.damping}`);
    for (const pair of damping.pairs) console.log(`   r(${pair.a}, ${pair.b}) = ${pair.r}  (n=${pair.n})`);
  }
};

module.exports = { binFor, binLabel, estimateFactor, estimateDamping, contentDecibans, fitIsotonic, applyIsotonic, STYLE_FACTORS, BIN_COUNT };

if (require.main === module) main();
