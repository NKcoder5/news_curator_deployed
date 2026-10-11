// backend/agents/weightOfEvidence.js
//
// What the score is, and why it is that and not something else.
//
// THE PROBLEM WITH THE OLD SCORE
//
// The previous rule was `0.15·source + 0.10·headline + 0.15·bias + ...`, which
// has two defects that no amount of tuning repairs.
//
//   1. The constants were chosen by hand. "Why 0.18 for transparency?" has no
//      answer. A system that tells a reader whether to believe a news story
//      should not rest on numbers that somebody liked the look of.
//
//   2. The output meant nothing. What IS 6.4 out of 10? Not a probability, not
//      a frequency, not a rate. It had no referent outside our own code, so it
//      could be neither verified nor falsified.
//
// WHAT REPLACES IT
//
// The output is P(fabricated | evidence): a probability, which is checkable
// against reality. If the system says 0.7 on a hundred articles, about seventy
// of them should be fabricated, and that is measurable.
//
// It is reached by accumulating evidence, not by averaging scores. Each
// observation contributes a likelihood ratio,
//
//     LR = P(observation | fabricated) / P(observation | genuine)
//
// estimated from labelled data by eval/estimateWeights.js — measured, not
// chosen. Ratios combine as log-odds, reported in decibans (10·log10 LR) after
// I. J. Good, because decibans ADD: the final number is an auditable sum whose
// terms can each be printed, argued with, and traced to the articles that
// produced them.
//
// Three properties fall out of this that the weighted mean could not provide:
//
//   * An uninformative factor contributes EXACTLY nothing. LR = 1 is 0 decibans.
//     Abstention stops being a special case in the code and becomes arithmetic.
//   * A factor nobody has measured contributes nothing, rather than a number
//     someone invented. Absence of evidence produces absence of weight.
//   * Evidence is non-compensatory in the right way: a factor that genuinely
//     separates the classes swamps one that does not, because that is what its
//     measured ratio says, not because we told it to.
//
// WHAT IS STILL DECLARED RATHER THAN MEASURED
//
// Honesty about this matters more than the appearance of rigour. The priors and
// the corroboration rates in data/evidenceWeights.json are DECLARED parameters:
// stated openly, with justification, and marked as such in every report. They
// are measurable, and the scripts to measure them exist; until they are run,
// the system says so rather than implying an estimate it does not have.
const fs = require('fs');
const path = require('path');

let table = null;

const loadTable = () => {
  if (!table) {
    table = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/evidenceWeights.json'), 'utf8'));
  }
  return table;
};

/** Testing seam: swap the estimated table without touching the file. */
const _setTable = (replacement) => { table = replacement; };

const probabilityToDecibans = (probability) => 10 * Math.log10(probability / (1 - probability));
const decibansToProbability = (decibans) => {
  const odds = 10 ** (decibans / 10);
  return odds / (1 + odds);
};

/**
 * The starting point, before any of the article's own content is considered.
 *
 * A prior is unavoidable — every diagnostic system has one, and a system that
 * refuses to name it has merely hidden it. Ours is conditioned on provenance,
 * because that is the one thing known before reading a word: a report from an
 * outlet with a masthead and a corrections policy begins in a different place
 * from an anonymous forward, and pretending otherwise would be a choice too.
 */
const priorFor = ({ sourceResult = {}, provenance = null }) => {
  const { declared } = loadTable();
  const priors = declared.priors;

  if (provenance && !provenance.knownOutletChannel) {
    return {
      probability: priors.socialAccount.value,
      band: 'socialAccount',
      reason: priors.socialAccount.reason,
      basis: 'declared'
    };
  }

  // A page passing itself off as a known newsroom starts where a publisher
  // with a poor record starts. No new number is introduced for it: the band
  // and its declared value already exist, and impersonation is a stronger
  // reason for that starting point than a poor rating is.
  if (sourceResult.impersonates) {
    return {
      probability: priors.poorRecord.value,
      band: 'poorRecord',
      reason: `The page presents itself as ${sourceResult.impersonates} but is not published on any address ${sourceResult.impersonates} uses, so it starts where a publisher with a poor record starts.`,
      basis: 'declared'
    };
  }

  const reliability = Number(sourceResult.score) || 0;
  const matched = Boolean(sourceResult.matched);

  let band;
  if (!matched) band = 'unratedOutlet';
  else if (reliability >= 8.5) band = 'strongRecord';
  else if (reliability >= 6.5) band = 'ordinaryRecord';
  else band = 'poorRecord';

  return {
    probability: priors[band].value,
    band,
    reason: priors[band].reason,
    basis: 'declared'
  };
};

/** Which measured bin does this factor score fall in? */
const binFor = (score, binCount) => {
  const clamped = Math.max(0, Math.min(10, Number(score)));
  return Math.min(binCount - 1, Math.floor((clamped / 10) * binCount));
};

/**
 * Weigh the content factors against the measured table.
 *
 * Correlation damping is applied to the style family as a whole: its members
 * measure overlapping properties of the same prose, and eval/estimateWeights.js
 * found them to be 1.2 effective independent factors out of four. Adding their
 * weights unmodified would count one piece of evidence four times.
 */
const weighContentFactors = (factorScores = {}) => {
  const { factors, families, binCount, declared } = loadTable();
  const styleFamily = new Set(families.style.factors);
  const authorControlled = new Set(declared.authorControlled.families);

  const entries = [];
  const unmeasured = [];

  for (const [name, score] of Object.entries(factorScores)) {
    if (typeof score !== 'number') continue;
    const estimate = factors[name];

    if (!estimate || !estimate.estimated) {
      unmeasured.push({
        factor: name,
        observation: score,
        decibans: 0,
        reason: estimate?.reason || 'no likelihood ratio has been estimated for this factor'
      });
      continue;
    }

    const family = styleFamily.has(name) ? 'style' : 'other';
    const bin = estimate.bins[binFor(score, binCount)];

    // The one-sided rule. A negative weight here would mean "this article reads
    // well, so it is more likely genuine" — a conclusion a competent fabricator
    // can manufacture at will. Author-controlled evidence is admitted only in
    // the incriminating direction.
    const clamped = authorControlled.has(family) && declared.authorControlled.clampExculpatory
      ? Math.max(0, bin.decibans)
      : bin.decibans;

    entries.push({
      factor: name,
      family,
      observation: score,
      band: bin.range,
      likelihoodRatio: bin.likelihoodRatio,
      decibans: clamped,
      measuredDecibans: bin.decibans,
      clamped: clamped !== bin.decibans,
      basis: clamped !== bin.decibans
        ? `measured at ${bin.decibans} db on ${estimate.n} labelled articles, but admitted as 0: this is an author-controlled observation and cannot count in favour of the article`
        : `measured on ${estimate.n} labelled articles (${bin.nFabricated} fabricated, ${bin.nGenuine} genuine in this band)`
    });
  }

  // Damp the style family, then cap it. The cap exists because the estimation
  // corpus (ISOT) contains fabrications that are badly written, so its style
  // ratios are an upper bound that we do not assume transfers to a competent
  // fabrication. The adversarial set shows style carrying almost no weight
  // there; capping is conservative in the direction of not over-trusting style.
  const styleEntries = entries.filter(e => e.family === 'style');
  const rawStyle = styleEntries.reduce((sum, e) => sum + e.decibans, 0);
  const damped = rawStyle * families.style.damping;
  const cap = declared.styleWeightCap.value;
  const capped = Math.sign(damped) * Math.min(Math.abs(damped), cap);

  const adjustments = [];
  if (styleEntries.length > 1 && rawStyle !== 0) {
    adjustments.push({
      adjustment: 'style-correlation-damping',
      decibans: Math.round((damped - rawStyle) * 100) / 100,
      reason: `The ${styleEntries.length} content checks correlate at r=${families.style.meanCorrelation}; they are ${families.style.effectiveFactors} effective independent factors, so their summed weight is scaled by ${families.style.damping}.`
    });
  }
  if (Math.abs(damped) > cap) {
    adjustments.push({
      adjustment: 'style-weight-cap',
      decibans: Math.round((capped - damped) * 100) / 100,
      reason: declared.styleWeightCap.reason
    });
  }

  const otherTotal = entries.filter(e => e.family !== 'style').reduce((sum, e) => sum + e.decibans, 0);
  const rawTotal = capped + otherTotal;

  // Calibrate. The raw sum ranks articles well but states dishonest
  // probabilities — clamping away exculpatory evidence piles every well-written
  // article onto zero — so a monotone map fitted on labelled data corrects the
  // ranking-to-probability step. Held out, this took expected calibration error
  // from 0.335 to 0.056.
  const calibrated = calibrateContentWeight(rawTotal);
  if (Math.abs(calibrated - rawTotal) > 0.01) {
    adjustments.push({
      adjustment: 'calibration',
      decibans: round(calibrated - rawTotal),
      reason: `Measured correction from the ${loadTable().calibration.fittedOn}-article calibration map, which maps this weight of evidence onto the rate at which articles scoring here actually turn out to be fabricated.`
    });
  }

  return {
    entries,
    adjustments,
    unmeasured,
    rawDecibans: round(rawTotal),
    totalDecibans: round(calibrated)
  };
};

/**
 * Map a raw content weight of evidence onto its calibrated value.
 *
 * The stored map answers "of the articles that scored here, what fraction were
 * fabricated?" — but for the corpus it was fitted on, which is roughly half
 * fabricated. A production article is not drawn from that population, so the
 * corpus base rate is divided out in log-odds space to leave the evidence
 * alone; the prior that belongs to this particular article is applied
 * separately. Transporting a likelihood between populations this way is the
 * standard move, and skipping it would make every report quietly assume its
 * article came from a corpus where half of everything is fake.
 */
const calibrateContentWeight = (rawDecibans) => {
  const { calibration, declared } = loadTable();
  if (!calibration?.breakpoints?.length) return rawDecibans;

  let probability = calibration.breakpoints[calibration.breakpoints.length - 1].probability;
  for (const point of calibration.breakpoints) {
    if (rawDecibans <= point.upTo) { probability = point.probability; break; }
  }

  const corpusDecibans = probabilityToDecibans(calibration.corpusBaseRate ?? 0.5);
  const calibrated = probabilityToDecibans(probability) - corpusDecibans;

  // The clamp and the cap apply to the calibrated value too, and this is not a
  // detail. Calibrating alone silently undoes the clamp: the map is fitted on a
  // corpus where scoring zero really does mean "probably genuine", so it hands
  // back a large exculpatory weight for exactly the profile a competent
  // fabricator produces. The adversarial argument does not care whether a number
  // was measured before or after calibration — an author-controlled observation
  // cannot speak in the article's favour at any stage.
  if (!declared.authorControlled.clampExculpatory) return calibrated;
  return Math.min(declared.styleWeightCap.value, Math.max(0, calibrated));
};

/**
 * Evidence from the corroboration search.
 *
 * The rates are declared rather than measured, and the report says so. They are
 * measurable — eval/measureCorroborationRates.js does it — and the asymmetry
 * between them is the important part: FINDING corroboration is strong evidence
 * that a story is genuine, while NOT finding it is weak evidence that it is
 * fabricated, because coverage gaps are ordinary. That asymmetry is exactly why
 * the verdict gate exists alongside this probability: an uncorroborated story
 * should not be condemned, but nor should it be called trustworthy.
 */
const corroborationOutcome = ({ independentSupport = 0, independentContradiction = 0 }) => {
  if (independentContradiction >= 2) return 'contradictedByTwo';
  if (independentContradiction === 1) return 'contradictedByOne';
  if (independentSupport >= 2) return 'supportedByTwoPlus';
  if (independentSupport === 1) return 'supportedByOne';
  return 'none';
};

const OUTCOME_NOTES = {
  contradictedByTwo: 'Two or more independent sources report conflicting facts.',
  contradictedByOne: 'One independent source reports conflicting facts.',
  none: 'No independent coverage was found. This is weak evidence only — genuine local and niche reporting is often uncovered elsewhere, which is why it caps the conclusion rather than condemning the article.',
  supportedByOne: 'One independent source reports the same facts.',
  supportedByTwoPlus: 'Two or more independent sources report the same facts.'
};

const weighCorroboration = ({ independentSupport = 0, independentContradiction = 0, verificationRan = true }) => {
  const { declared } = loadTable();
  const rates = declared.corroboration;

  if (!verificationRan) {
    return {
      decibans: 0,
      outcome: 'not-run',
      basis: 'declared',
      note: 'The corroboration check did not run, so it contributes no evidence either way.'
    };
  }

  const outcome = corroborationOutcome({ independentSupport, independentContradiction });
  const lr = rates.givenFabricated[outcome] / rates.givenGenuine[outcome];

  return {
    decibans: round(10 * Math.log10(lr)),
    likelihoodRatio: round(lr, 4),
    outcome,
    basis: rates.basis,
    note: OUTCOME_NOTES[outcome]
  };
};

/**
 * Evidence from a fact-checking desk's published ruling on the same claim.
 *
 * Declared, like the corroboration rates, and only ever entered when a desk
 * actually ruled. Finding NO ruling is not entered at all: the desks cover a
 * small, viral-skewed share of claims, so their silence about a claim says
 * almost nothing about it, and counting it would quietly reward obscurity.
 */
const weighFactCheck = (factCheck) => {
  const outcome = {
    debunked: 'ratedFalse', misleading: 'ratedMisleading', confirmed: 'ratedTrue'
  }[factCheck?.status];
  if (!outcome) return null;
  const { declared } = loadTable();
  const rates = declared.factCheck;
  if (!rates) return null;
  const lr = rates.givenFabricated[outcome] / rates.givenGenuine[outcome];
  return {
    decibans: round(10 * Math.log10(lr)),
    likelihoodRatio: round(lr, 4),
    outcome,
    basis: rates.basis,
    note: {
      ratedFalse: 'A professional fact-checking desk examined this same claim and rated it false.',
      ratedMisleading: 'A professional fact-checking desk examined this same claim and rated it misleading.',
      ratedTrue: 'A professional fact-checking desk examined this same claim and rated it true.'
    }[outcome]
  };
};

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Assemble the full ledger and the posterior probability.
 *
 * @returns {{probabilityFabricated: number, priorProbability: number,
 *            totalDecibans: number, ledger: Array, unmeasured: Array,
 *            declaredParameters: string[]}}
 */
const assessProbability = ({ factorScores, sourceResult, provenance, evidence, factCheck }) => {
  const prior = priorFor({ sourceResult, provenance });
  const content = weighContentFactors(factorScores);
  const corroboration = weighCorroboration(evidence || {});
  const ruling = weighFactCheck(factCheck);

  const { declared } = loadTable();
  const priorDecibans = probabilityToDecibans(prior.probability);
  const totalDecibans = priorDecibans + content.totalDecibans + corroboration.decibans + (ruling ? ruling.decibans : 0);

  // No finite quantity of evidence of this kind justifies certainty, so the
  // reported probability is bounded. A system that prints 0.00 is claiming
  // something it cannot support.
  const bounds = declared.probabilityBounds;
  const probability = Math.min(bounds.max, Math.max(bounds.min, decibansToProbability(totalDecibans)));

  const ledger = [
    {
      step: 'prior',
      label: 'Before reading the article',
      decibans: round(priorDecibans),
      detail: prior.reason,
      basis: 'declared'
    },
    ...content.entries.map(entry => ({
      step: 'factor',
      label: entry.factor,
      observation: entry.observation,
      band: entry.band,
      likelihoodRatio: entry.likelihoodRatio,
      decibans: entry.decibans,
      basis: entry.basis
    })),
    ...content.adjustments.map(adjustment => ({
      step: 'adjustment',
      label: adjustment.adjustment,
      decibans: adjustment.decibans,
      detail: adjustment.reason,
      basis: 'measured'
    })),
    {
      step: 'corroboration',
      label: 'Independent corroboration',
      decibans: corroboration.decibans,
      likelihoodRatio: corroboration.likelihoodRatio,
      detail: corroboration.note,
      basis: corroboration.basis
    },
    ...(ruling ? [{
      step: 'fact-check',
      label: 'Fact-checkers’ ruling',
      decibans: ruling.decibans,
      likelihoodRatio: ruling.likelihoodRatio,
      detail: ruling.note,
      basis: ruling.basis
    }] : [])
  ];

  return {
    probabilityFabricated: round(probability, 4),
    priorProbability: prior.probability,
    priorBand: prior.band,
    totalDecibans: round(totalDecibans),
    ledger,
    // Factors that measured nothing. Listing them is the point: the reader is
    // told which checks ran but could not contribute, rather than being given a
    // number that quietly includes a guess.
    unmeasured: content.unmeasured,
    declaredParameters: ledger.filter(e => e.basis === 'declared').map(e => e.label)
  };
};

module.exports = {
  assessProbability,
  priorFor,
  weighContentFactors,
  weighCorroboration,
  weighFactCheck,
  probabilityToDecibans,
  decibansToProbability,
  _setTable
};
