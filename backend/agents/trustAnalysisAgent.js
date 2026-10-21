// backend/agents/trustAnalysisAgent.js
// Orchestrator: runs the analysis factors in parallel and combines them into a
// verdict plus an explainable trust score.
//
// The factors fall into two channels, and the distinction is the point of the
// design. Five factors describe how an article PRESENTS itself — publisher,
// headline, wording, attribution, persuasion. One asks whether independent
// reporting supports what it says. Presentation is cheap to fake, so it may
// only lower trust; evidence is what raises it. See agents/verdictEngine.js for
// why the earlier weighted sum produced high scores for fabricated articles.
const { getSourceReputation } = require('./sourceReputationAgent');
const { domainAge } = require('../utils/domainAge');
const { analyzeClickbait } = require('./clickbaitAgent');
const { analyzeBias } = require('./biasAgent');
const { verifyClaims, extractClaims } = require('./claimVerificationAgent');
const { detectManipulation } = require('./manipulationAgent');
const { assessTransparency } = require('./transparencyAgent');
const { checkPremises } = require('./referenceCheck');
const { checkFactCheckers } = require('./factCheckSearch');
const { factCheckDeskOf } = require('../utils/factCheckDesks');
const { checkCurrentCoverage } = require('./currentCoverage');
const { buildEvidenceLedger, decideVerdict, applyCeiling, compactLedgerInput } = require('./verdictEngine');
const { assessProbability } = require('./weightOfEvidence');
const { detectLanguage } = require('../utils/language');

// A note on professional fact-check matching
// ------------------------------------------
// A seventh factor matched an article's claims against verdicts published by
// professional fact-checkers. It is no longer part of the pipeline. Both routes
// to that evidence proved impractical here:
//
//   - Google's Fact Check Tools API requires a billing-enabled account.
//   - Reading ClaimReview markup off fact-checkers' own pages works, but the
//     only way to find the right page is the news search, and the free news tier
//     allows 100 requests a day in total — a budget the article feed and
//     cross-source verification already depend on.
//
// Searching the fact-checkers directly was tested and does not work: their
// search pages render results in JavaScript, so there is nothing to read.
//
// agents/factCheckAgent.js and utils/claimReviewReader.js are kept, working and
// unwired, for anyone who has a Fact Check Tools key — re-adding the import, a
// weight below, and the factor entry is all it takes. See the README.

// Factor weights.
//
// Only the five presentation factors are combined by weight; they are
// renormalised among themselves at the point of use. `verification` keeps a
// weight here because the evaluation harness and the archived results refer to
// it, but the running pipeline no longer adds it to the sum: evidence sets the
// ceiling instead of contributing a term. See the channel split below.
//
// Bumped whenever the shape of a report changes — a new factor, a renamed
// field, a different scale. Cached reports below the current version are
// re-analysed instead of served, so an upgrade can never leave a reader
// looking at a report built by an older pipeline. Cache entries written before
// versioning existed have no version at all and are treated as stale.
const REPORT_SCHEMA_VERSION = 5;

// The reader-facing name of each step, used for progress updates while the
// analysis runs. These match the factor names in the finished report.
const FACTOR_LABELS = {
  sourceReputation: 'Who published it',
  clickbait: 'Is the headline honest?',
  bias: 'Is the writing fair?',
  transparency: 'Can you check it yourself?',
  manipulation: 'Is it using persuasion tricks?',
  verification: 'Do other outlets agree?'
};

// Only the scored checks are announced. Claim extraction is timed like the
// rest, but it is a sub-step of verification rather than a check of its own —
// announcing it made the page count "7 of 6".
const REPORTED_STEPS = new Set(Object.keys(FACTOR_LABELS));

// The evidence channels, announced to a caller watching the check live (the
// Check Anything page). Each reports what it found in one line, the moment it
// lands, so the reader watches the evidence arrive rather than a spinner.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const CHANNELS = {
  claimExtraction: {
    name: 'Reading out the claims',
    summary: ({ claims = [], failed }) => (failed ? 'The claims could not be read out.'
      : claims.length ? `${plural(claims.length, 'checkable claim', 'checkable claims')}: “${claims[0].claim}”`
      : 'No specific factual claim found.')
  },
  verification: {
    name: 'Searching news coverage',
    summary: (r) => {
      const claims = r.claims || [];
      const count = (key) => claims.reduce((n, c) => n + (c[key] || []).length, 0);
      if (r.status === 'error') return 'The news search could not run.';
      if (r.status === 'contradicted') return `${plural(count('contradictingEvidence'), 'report', 'reports')} found that say otherwise.`;
      if (r.status === 'corroborated') return `${plural(count('supportingEvidence'), 'report', 'reports')} found that say the same.`;
      return 'No outlet reports this event.';
    }
  },
  factChecks: { name: 'Asking the fact-checkers', summary: (r) => r.explanation },
  currentCoverage: { name: 'Reading this week’s news on the subject', summary: (r) => r.explanation },
  premises: { name: 'Checking reference facts', summary: (r) => r.explanation },
  clickbait: { name: 'Reading how it is written', group: 'writing' },
  bias: { name: 'Reading how it is written', group: 'writing' },
  manipulation: {
    name: 'Reading how it is written',
    group: 'writing',
    summary: (r) => (r.unread ? 'Could not be finished in time.'
      : r.techniques?.length ? `${plural(r.techniques.length, 'persuasion trick', 'persuasion tricks')} detected.`
      : 'No persuasion techniques detected.')
  },
  transparency: { name: 'Reading how it is written', group: 'writing' }
};

const WEIGHTS = {
  sourceReputation: 0.15,
  clickbait: 0.10,
  bias: 0.15,
  manipulation: 0.15,
  transparency: 0.18,
  verification: 0.27
};

// Verdicts are written the way a reader would say them out loud, not as
// technical grades. `advice` tells the reader what to actually do.
const verdictFromScore = (score) => {
  if (score >= 7.5) return {
    label: 'Looks trustworthy',
    level: 'high',
    advice: 'Nothing concerning stood out in our checks.'
  };
  if (score >= 5.5) return {
    label: 'Mostly fine',
    level: 'medium-high',
    advice: 'Broadly reliable, with a few things worth noticing.'
  };
  if (score >= 4) return {
    label: 'Read carefully',
    level: 'medium-low',
    advice: 'Some parts of this article need a second look.'
  };
  return {
    label: 'Be skeptical',
    level: 'low',
    advice: 'We found several warning signs. Check another source before believing this.'
  };
};

/**
 * Turn the factor results into short plain-English points a non-technical
 * reader understands. Built from the results themselves — no extra AI call.
 * @returns {{goodPoints: string[], concernPoints: string[], summary: string}}
 */
const buildPlainLanguage = ({
  sourceResult, clickbaitResult, biasResult, manipulationResult,
  transparencyResult, verificationResult, verdict, excerptOnly = false
}) => {
  const goodPoints = [];
  const concernPoints = [];

  // Who published it
  if (sourceResult.matched && sourceResult.score >= 7.5) {
    goodPoints.push(`Published by ${sourceResult.matchedName}, an outlet with a strong record for accuracy.`);
  } else if (sourceResult.matched && sourceResult.score < 5) {
    concernPoints.push(`${sourceResult.matchedName} has a weak record for factual reporting.`);
  } else if (!sourceResult.matched) {
    concernPoints.push('We do not have a reliability record for this news outlet.');
  }

  // Headline
  if (clickbaitResult.isClickbait) {
    concernPoints.push('The headline uses clickbait techniques to attract clicks.');
  } else if (clickbaitResult.score >= 7.5) {
    goodPoints.push('The headline describes the story plainly, without exaggeration.');
  }

  // Language
  const flagged = (biasResult.flaggedSentences || []).length;
  if (flagged > 0) {
    concernPoints.push(
      `${flagged} sentence${flagged > 1 ? 's use' : ' uses'} biased or emotional wording (highlighted below).`
    );
  } else if (biasResult.score >= 7.5) {
    goodPoints.push('The article is written in neutral language.');
  }
  // 'not-assessed' means the pattern check ran and cannot judge direction —
  // saying "leans not-assessed" would be nonsense, so stay silent instead.
  if (biasResult.politicalLean && !['none-detected', 'none', 'neutral', 'not-assessed'].includes(biasResult.politicalLean)) {
    concernPoints.push(`The article leans ${biasResult.politicalLean} in how it presents the story.`);
  }

  // Can the reader check any of this themselves?
  //
  // Only if we have the article. When the page could not be fetched we hold
  // roughly two hundred characters of publisher summary, in which no article
  // names its sources - so "the article names no sources you could go and
  // verify" would be a statement about our own reach, dressed up as a finding
  // about the reporting. Measured on an Associated Press report, the excerpt
  // scored 0 here and pulled the writing score from 9.3 to 7.0 for sourcing
  // that was present in the article we never read.
  const vague = (transparencyResult?.vagueAttributions) || [];
  // A check with no score did not finish, and says nothing about sourcing:
  // `null < 4` is true in JavaScript, which would report "names no sources".
  const transparencyScored = typeof transparencyResult?.score === 'number';
  if (excerptOnly) {
    concernPoints.push('Only the publisher’s summary was available, so the article’s own sourcing could not be checked.');
  } else if (transparencyScored && transparencyResult.score < 4) {
    concernPoints.push(
      vague.length > 0
        ? `Little you can check: the article leans on unnamed authority such as “${vague[0]}”.`
        : 'The article names no sources you could go and verify.'
    );
  } else if (transparencyScored && transparencyResult.score >= 7.5) {
    goodPoints.push('Names its sources and gives detail you can check independently.');
  }

  // Persuasion techniques — named, so the reader learns to spot them
  const techniques = (manipulationResult?.techniques) || [];
  if (techniques.length > 0) {
    const names = [...new Set(techniques.map(t => t.technique))];
    concernPoints.push(
      `Uses persuasion techniques on the reader: ${names.slice(0, 3).join(', ')}.`
    );
  } else if (manipulationResult && manipulationResult.score >= 9) {
    goodPoints.push('Written as plain information, without persuasion techniques.');
  }

  // What other outlets say — the part readers care about most
  const claims = verificationResult.claims || [];
  const supported = claims.filter(c => c.verdict === 'supported').length;
  const contradicted = claims.filter(c => c.verdict === 'contradicted').length;
  if (contradicted > 0) {
    concernPoints.unshift(`Other news outlets report something different about ${contradicted} key claim${contradicted > 1 ? 's' : ''}.`);
  }
  if (supported > 0) {
    goodPoints.unshift(`${supported} key claim${supported > 1 ? 's are' : ' is'} also reported by other news outlets.`);
  }
  if (verificationResult.status === 'error') {
    // The search did not run. "We could not find other outlets covering this"
    // would be a claim about the world made out of our own outage.
    concernPoints.push('The check against other outlets could not be completed, so nothing here has been confirmed or denied.');
  } else if (supported === 0 && contradicted === 0 && claims.length > 0) {
    concernPoints.push('We could not find other outlets covering this story, so its claims are unconfirmed.');
  }

  // One-sentence takeaway
  let summary;
  if (contradicted > 0) {
    summary = 'Other outlets contradict part of this story — treat it with caution.';
  } else if (concernPoints.length === 0) {
    summary = 'Everything we checked looks fine.';
  } else if (goodPoints.length === 0) {
    summary = `We found ${concernPoints.length} thing${concernPoints.length > 1 ? 's' : ''} to be careful about in this article.`;
  } else {
    // The verdict's stock advice is only used when there is genuinely nothing
    // flagged — otherwise it contradicts the concerns listed right below it.
    const concernText = `${concernPoints.length} thing${concernPoints.length > 1 ? 's' : ''} worth a look`;
    const goodText = `${goodPoints.length} good sign${goodPoints.length > 1 ? 's' : ''}`;
    summary = `Broadly holds up, but check the detail: ${goodText}, and ${concernText}.`;
  }

  return { goodPoints, concernPoints, summary };
};

// NewsAPI ends a truncated body with "… [+8026 chars]". That marker is not
// part of the article, and a model that echoes it back puts a stray "["
// ahead of its own JSON. Drop it before any factor sees the text.
const cleanText = (content) => String(content || '').replace(/\[\+\d+\s*chars\]/gi, '').trim();

/**
 * What a channel that could not be read in time contributes: nothing.
 *
 * Each value has the shape the verdict engine already reads as "this did not
 * run" — never the shape of a finding. A news search that timed out is an
 * unrun search ('error', so the verdict says it could not check), not a search
 * that found no coverage, which the rules may read as a warning sign; a
 * writing check that timed out has no score, not a score of 0, which would
 * read as "names no sources". test/channelDeadline.test.js holds every value
 * here to that.
 */
const UNREAD = {
  writing: () => ({ score: null, unread: true, techniques: [], intensity: 'none', explanation: 'This check could not be finished in time.', summary: 'This check could not be finished in time.' }),
  claimExtraction: () => ({ claims: [], failed: true, unread: true }),
  verification: (claims = []) => ({
    score: 5,
    status: 'error',
    claims: claims.map(c => ({
      claim: c.claim, time: c.time || null, kind: c.kind || null,
      verdict: 'undetermined', failed: true, supportingEvidence: [], contradictingEvidence: [],
      explanation: 'Other outlets could not be searched in time for this claim.'
    })),
    explanation: 'The news search could not be finished in time, so nothing was confirmed or denied.',
    failed: true,
    unread: true
  }),
  premises: () => ({ status: 'error', checked: [], contradictions: [], explanation: 'The reference check could not be finished in time.', unread: true }),
  factChecks: () => ({ status: 'error', matches: [], considered: 0, explanation: 'The fact-check search could not be finished in time.', unread: true }),
  currentCoverage: () => ({ status: 'error', presupposingFalse: [], reporting: [], explanation: 'This week\'s coverage could not be read in time.', unread: true })
};

/**
 * Start the checks that read only the message, before its claims are known.
 *
 * How a message is written, and for English text what a reference work says
 * about the names in it, do not depend on what the message is read as
 * claiming. Measured on 12 Oct, they waited for the input-understanding call
 * (1.5-3.1 s) before starting, and then were the last to land: the four
 * writing checks queue on the one local GPU (5.5 s together) and the
 * reference check goes to NVIDIA NIM (5-9 s). Started here, at the same time
 * as the understanding call, they are no longer on the critical path. The
 * inputs are exactly those analyzeTrust would give them, so the judgements are
 * the same; analyzeTrust uses these only for the same title and text, and the
 * reference check only when no English rendering replaces the text.
 *
 * @returns {Object} the started work, to pass to analyzeTrust as `early`
 */
const startMessageChecks = ({ title, content }) => {
  const text = cleanText(content);
  const language = detectLanguage(`${title} ${text}`);
  const tasks = {
    clickbait: analyzeClickbait(title, language),
    bias: analyzeBias(title, text, language),
    manipulation: detectManipulation(title, text, language),
    transparency: assessTransparency(title, text, language),
    premises: checkPremises(title, text).catch(() => ({ status: 'error', checked: [], contradictions: [], explanation: 'The reference check could not run.' }))
  };
  // A message refused after it is read never collects these; a failure among
  // them must not surface as an unhandled rejection.
  for (const task of Object.values(tasks)) task.catch(() => {});
  return { title, content, startedAt: Date.now(), tasks };
};

/**
 * Run the full trust analysis pipeline for an article.
 * @param {Object} article - { title, content, source, url }
 * @returns {Promise<Object>} structured trust report
 */
const analyzeTrust = async ({
  title, content, source, url, textCoverage, onProgress, onChannel, provenance, modality, publishedAt,
  // From the input-understanding step (Check Anything): the claims already
  // read out of the message in English, the message in English for the
  // reference check, and the reading itself for the report.
  preparedClaims = null, evidenceText = null, understanding = null,
  // Called with the exact inputs the verdict was reached from, so the check can
  // be stored as a record that replays to the same verdict (services/claimMemory.js).
  onLedgerInput = null,
  // Work already started by startMessageChecks for this same title and text.
  early = null,
  // How long, from now, the evidence channels have to land. A channel still
  // out after that is reported as not read in time and counts as absent (see
  // UNREAD), so one slow provider cannot hold a reader's answer. Null waits
  // for everything, as the re-checks and the article analyses do.
  deadlineMs = null
}) => {
  // Whether we are reading the article or the feed's two-line summary of it.
  // Checks that need the body of the piece cannot be reported as findings
  // about the piece when all we have is the summary.
  const excerptOnly = textCoverage !== undefined && textCoverage !== 'full';
  const startedAt = Date.now();
  const timings = {};
  const deadlineAt = Number.isFinite(deadlineMs) && deadlineMs > 0 ? startedAt + deadlineMs : null;
  const unreadChannels = [];
  const usable = early && early.title === title && early.content === content ? early : null;
  const fromEarly = (name, start) => (usable && usable.tasks[name]) || start();
  const since = (name) => (usable && usable.tasks[name] ? usable.startedAt : null);

  // Settles with the channel's result, or with its unread value once the
  // deadline passes. The work itself cannot be cancelled and is left to finish;
  // only the answer stops waiting for it.
  // The news search is the evidence most verdicts rest on, so it waits much
  // longer than the other channels: three times their deadline. Measured on
  // 13 Oct, with Gemini timing out and the stance judgements falling back to
  // slower providers, a 15-second limit cut the search off in 26 of 51
  // held-out checks and each came back "we could not complete the search".
  // A reader would rather wait than get no answer.
  // This week's coverage is the evidence that an invented event about a
  // well-covered person is false ("MS Dhoni passed away" against a week of
  // reports of him alive and active); cut off, the same message came back
  // CANNOT VERIFY on one run in four.
  const PRIMARY = new Set(['verification', 'currentCoverage']);
  const beforeDeadline = (name, promise, unread) => {
    if (!deadlineAt || !unread) return promise;
    const until = PRIMARY.has(name) ? startedAt + 3 * (deadlineAt - startedAt) : deadlineAt;
    let timer;
    const late = new Promise(resolve => {
      timer = setTimeout(() => {
        unreadChannels.push(name);
        resolve(unread());
      }, Math.max(0, until - Date.now()));
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  };

  // Every factor passes through here, so this is also where a caller watching
  // the analysis is told that one has landed. A reader should see the checks
  // arrive one by one rather than staring at a spinner until all six finish.
  const timed = async (name, task, { from = null, unread = null } = {}) => {
    const started = from || Date.now();
    try {
      const result = await beforeDeadline(name, Promise.resolve().then(task), unread);
      if (typeof onProgress === 'function' && REPORTED_STEPS.has(name)) {
        try {
          onProgress({ id: name, name: FACTOR_LABELS[name], ms: Date.now() - started });
        } catch (_) { /* a broken listener must never fail the analysis */ }
      }
      if (typeof onChannel === 'function' && CHANNELS[name]) {
        try {
          const channel = CHANNELS[name];
          onChannel({
            id: name,
            name: channel.name,
            group: channel.group || null,
            ms: Date.now() - started,
            unread: Boolean(result?.unread),
            summary: result?.unread ? 'Could not be read in time.'
              : channel.summary ? String(channel.summary(result) || '') : null
          });
        } catch (_) { /* a broken listener must never fail the analysis */ }
      }
      return result;
    } finally {
      timings[name] = Date.now() - started;
    }
  };
  const text = cleanText(content);

  // Which language is this? Everything downstream depends on the answer: the
  // prompts, the language flagged sentences are quoted back in, and — the one
  // that decides whether verification works at all — which language coverage is
  // searched in. Detection is local and deterministic; see utils/language.js.
  const language = detectLanguage(`${title} ${text}`);

  // Source lookup is synchronous and free.
  const sourceResult = await timed('sourceReputation', () => {
    const outlet = getSourceReputation(source, url);

    // A social account is not a publisher. Left to the outlet lookup, an
    // anonymous Instagram account falls through to the "unrated" default of
    // 5/10 — the same score an unlisted local newspaper gets — which credits it
    // with an editorial process it does not have. Where the account belongs to a
    // known newsroom, buildProvenance has already resolved the outlet's real
    // record and that is used unchanged.
    if (provenance && !provenance.knownOutletChannel && !outlet.matched) {
      return {
        score: provenance.reliability,
        bias: 'unknown',
        type: `${provenance.platform} account`,
        matched: false,
        matchedName: provenance.account || null,
        notes: provenance.note
      };
    }
    return outlet;
  });

  // How old the site's domain is, asked only of sites we hold no record for —
  // a rated outlet's age tells us nothing its record does not. Started now so
  // the registry lookup overlaps the checks below instead of adding to them.
  const domainAgePromise = url && !provenance && !sourceResult.matched
    ? domainAge(url).catch(() => null)
    : Promise.resolve(null);

  // Claim extraction feeds only verification; the four content checks never use
  // it. Starting it alongside them keeps it off the critical path.
  //
  // This was tried once before and made things markedly worse (63s -> 116s).
  // The cause was the gate, not the idea: at two slots, extraction queued behind
  // the content checks and delayed the verification waiting on it. The gate is
  // now sized to the provider (six for Gemini), so the five checks plus this
  // extraction fit at once. Measured A/B over identical articles:
  //
  //     overlapped   7.4s / 10.4s / 39.7s   -> 19.2s average
  //     sequential  11.2s / 16.4s / 42.9s   -> 23.5s average
  // A failure here is carried, not swallowed. Returning a bare [] would be
  // indistinguishable from "this article makes no checkable claim", which is a
  // finding rather than an outage.
  const claimsPromise = timed('claimExtraction', () => (Array.isArray(preparedClaims)
    ? Promise.resolve({ claims: preparedClaims, failed: false })
    : extractClaims(title, text, 2, language).then(
      claims => ({ claims, failed: false }),
      () => ({ claims: [], failed: true })
    )), { unread: UNREAD.claimExtraction });

  // The reference check started early read the message's own title and text;
  // a non-English message is checked on its English rendering instead.
  const earlyPremises = !evidenceText && usable && usable.tasks.premises;

  const [
    clickbaitResult, biasResult, manipulationResult,
    transparencyResult, verificationResult, premiseResult, factCheckResult, currentCoverageResult
  ] = await Promise.all([
    timed('clickbait', () => fromEarly('clickbait', () => analyzeClickbait(title, language)), { from: since('clickbait'), unread: UNREAD.writing }),
    timed('bias', () => fromEarly('bias', () => analyzeBias(title, text, language)), { from: since('bias'), unread: UNREAD.writing }),
    timed('manipulation', () => fromEarly('manipulation', () => detectManipulation(title, text, language)), { from: since('manipulation'), unread: UNREAD.writing }),
    timed('transparency', () => fromEarly('transparency', () => assessTransparency(title, text, language)), { from: since('transparency'), unread: UNREAD.writing }),
    claimsPromise.then(({ claims, failed }) =>
      timed('verification', () => verifyClaims(title, text, source, claims, failed, language), { unread: () => UNREAD.verification(claims) })),
    // Runs beside the news search because it answers a question the news search
    // structurally cannot. "Prime Minister Rahul Gandhi announced X" describes
    // an event no outlet reports, so the news channel correctly returns nothing
    // — while a reference work settles the premise in one lookup.
    // The subjects the message-reading step found: a general fact ("Giraffe is
    // a fish") names none in capitals, and the early check finds nothing to
    // look up, so it is asked again with them.
    timed('premises', async () => {
      const subjects = understanding ? (understanding.checkableClaims || []).map(c => c.subject).filter(Boolean) : [];
      const early = earlyPremises ? await earlyPremises : null;
      if (early && !(early.status === 'no-entities' && subjects.length)) return early;
      return checkPremises(evidenceText ? evidenceText.slice(0, 140) : title, evidenceText || text, subjects)
        .catch(() => ({ status: 'error', checked: [], contradictions: [], explanation: 'The reference check could not run.' }));
    }, { from: earlyPremises ? usable.startedAt : null, unread: UNREAD.premises }),
    // The third channel, beside the news search and the reference check: has a
    // professional fact-checking desk already ruled on this claim? A viral
    // rumour is never reported as news, so the news channel can only say
    // "cannot verify" about it — while a desk may have investigated it days ago.
    // It reuses the extracted claims, so it starts as soon as they exist.
    // FACT_CHECK_CHANNEL=off is for evaluation on claims labelled from fact-checkers' own rulings
    // (eval/buildRulingSuite.js), where the channel would find the very ruling a case is labelled from.
    claimsPromise.then(({ claims }) => timed('factChecks', () => (process.env.FACT_CHECK_CHANNEL === 'off'
      ? Promise.resolve({ status: 'not-run', matches: [], considered: 0, explanation: 'The fact-check channel was switched off for this evaluation.' })
      : checkFactCheckers(claims, { title, text })), { unread: UNREAD.factChecks }))
      .catch(() => ({ status: 'error', matches: [], considered: 0, explanation: 'The fact-check search could not run.' })),
    // The fourth: what this week's coverage of the claim's subject takes for
    // granted. An invented event about a heavily covered subject is
    // contradicted, implicitly, by everything else reported about it.
    claimsPromise.then(({ claims }) => timed('currentCoverage', () => checkCurrentCoverage(claims), { unread: UNREAD.currentCoverage }))
      .catch(() => ({ status: 'error', presupposingFalse: [], reporting: [], explanation: 'This week\'s coverage could not be read.' }))
  ]);

  // A true claim can carry an invented one: "Modi launched ₹13,000 crore of
  // projects in Chennai and announced free petrol for all students" was
  // confirmed by nine outlets on the strength of its first half. When a
  // message's claims split into confirmed and unreported, the unreported one
  // gets its own reading of this week's coverage, so the verdict can tell an
  // added fabrication from a detail nobody bothered to report.
  let unconfirmedClaimResult = null;
  if (Array.isArray(preparedClaims) && preparedClaims.length > 1) {
    const judged = verificationResult.claims || [];
    // Any outlet reporting the other claim is enough, even if others dispute
    // it, and so is a fact-checker's "true": the unreported claim is read
    // either way. Read only beside a confirmed claim, a ruled-out claim was
    // forgotten once fresh contradiction evened the confirmed one out, and the
    // message could come out milder for the extra evidence against it
    // (eval/counterfactualFaithfulness.js).
    const confirmed = [
      ...judged.filter(c => c.verdict === 'supported'),
      ...judged.filter(c => c.verdict !== 'supported' && (c.supportingEvidence || []).length > 0)
    ];
    if (!confirmed.length && factCheckResult?.status === 'confirmed') {
      confirmed.push(...judged.filter(c => !['no-coverage', 'unverified'].includes(c.verdict)).slice(0, 1));
    }
    const unreported = preparedClaims.filter(p => judged.some(c => c.claim === p.claim && ['no-coverage', 'unverified'].includes(c.verdict)));
    if (confirmed.length > 0 && unreported.length > 0) {
      const target = unreported[0];
      const week = await timed('unconfirmedClaim', () => checkCurrentCoverage([target]), { unread: UNREAD.currentCoverage })
        .catch(() => null);
      unconfirmedClaimResult = { claim: target.claim, confirmedClaim: confirmed[0].claim, week };
    }
  }

  const verificationInformative = ['corroborated', 'contradicted'].includes(verificationResult.status);

  // When a factor stands down, say precisely why — "not counted" alone leaves
  // the reader guessing whether the check failed or simply found nothing.
  const VERIFICATION_REASONS = {
    'no-claims': 'Not counted — this article makes no specific factual claim we could look up.',
    'unverified': 'Not counted — no other outlet has covered this story yet.',
    'error': 'Not counted — this check could not run just now.'
  };

  const verificationNote = verificationInformative ? null
    : (VERIFICATION_REASONS[verificationResult.status] || VERIFICATION_REASONS.unverified);

  // -------------------------------------------------------------------------
  // How likely is this to be fake news?
  //
  // Not a weighted average of scores. Each observation contributes a measured
  // likelihood ratio, the ratios accumulate as log-odds, and the result is a
  // probability — a quantity with a referent outside this code, which can
  // therefore be checked against reality. See agents/weightOfEvidence.js for
  // why the old `0.15·source + 0.10·headline + ...` was indefensible, and
  // eval/estimateWeights.js for where these ratios were measured.
  //
  // The one-sided rule lives in there too: style, headline and attribution are
  // chosen by whoever wrote the text, so they may incriminate an article but
  // never speak in its favour.
  // -------------------------------------------------------------------------
  // The evidence ledger first: it counts INDEPENDENT sources rather than
  // articles (see agents/independence.js), and both the probability and the
  // verdict read from it.
  const ledgerInput = {
    claims: verificationResult.claims || [],
    verificationStatus: verificationResult.status,
    premiseResult,
    factCheckResult,
    currentCoverageResult,
    unconfirmedClaimResult,
    sourceResult,
    transparencyResult,
    manipulationResult,
    title,
    // The page's own address: a fact-checking desk's ruling, submitted as a
    // link, is found in the fact-check record at this same address.
    pageUrl: url || null,
    pageDesk: factCheckDeskOf(url),
    // So the ledger can tell "no outlet reports this" apart from "the index we
    // search does not carry anything this recent". See verdictEngine R3a.
    publishedAt,
    // An age the registry did not give in time is unknown, as when it does
    // not answer at all — never "old".
    domainAge: await beforeDeadline('domainAge', domainAgePromise, () => null),
    asOf: Date.now()
  };
  const evidenceLedger = buildEvidenceLedger(ledgerInput);
  if (typeof onLedgerInput === 'function') {
    try { onLedgerInput(compactLedgerInput(ledgerInput)); } catch (_) { /* recording must never fail the analysis */ }
  }

  const assessment = assessProbability({
    // Source reputation is deliberately absent. Provenance already sets the
    // prior — that is what the prior IS — so passing it again as a factor would
    // count the publisher twice, and put two rows about the same thing in front
    // of the reader. It measured 0 decibans anyway, because the corpus hides
    // source identity, but the double-count would have been wrong even if it
    // had not.
    factorScores: {
      clickbait: clickbaitResult.score,
      bias: biasResult.score,
      manipulation: manipulationResult.score,
      transparency: transparencyResult.score
    },
    sourceResult,
    provenance,
    evidence: {
      independentSupport: evidenceLedger.independentSupport,
      independentContradiction: evidenceLedger.independentContradiction,
      verificationRan: evidenceLedger.verificationRan
    },
    factCheck: factCheckResult,
    currentCoverage: evidenceLedger.currentCoverageOutcome
  });

  // -------------------------------------------------------------------------
  // From probability to advice.
  //
  // Two different questions, so two different answers, and conflating them was
  // the old design's mistake:
  //
  //   P(fake news)  — how likely is this to be fabricated, weighing every
  //                   measured observation against stated base rates.
  //   The verdict   — what has actually been ESTABLISHED about the claims.
  //
  // They come apart precisely where it matters. An uncorroborated story from an
  // unknown outlet may carry a low P(fake) simply because most articles are not
  // fabricated — but nothing about it has been established, and telling a reader
  // it "looks trustworthy" on the strength of a base rate would be exactly the
  // failure this system exists to prevent. Absence of evidence is not evidence
  // of absence, so the verdict caps what may be reported.
  // -------------------------------------------------------------------------
  const decision = decideVerdict(evidenceLedger);
  const scoreFromProbability = 10 * (1 - assessment.probabilityFabricated);
  const ceilingOutcome = applyCeiling(scoreFromProbability, decision);
  const overallScore = ceilingOutcome.score;
  const scoreBand = verdictFromScore(overallScore);

  const plain = buildPlainLanguage({
    sourceResult, clickbaitResult, biasResult, manipulationResult,
    transparencyResult, verificationResult, verdict: scoreBand, excerptOnly
  });

  // A factor that fell back to the pattern check produced a real result, but a
  // weaker one. Say so on the report rather than letting a degraded run pass
  // for a full one — the reader is entitled to know how the score was reached.
  const degradedFactors = [
    ['clickbait', clickbaitResult], ['bias', biasResult],
    ['manipulation', manipulationResult], ['transparency', transparencyResult]
  ].filter(([, r]) => r.degraded).map(([id]) => id);

  // -------------------------------------------------------------------------
  // Craft, kept apart from truth.
  //
  // "Is this true?" and "is this well written?" are different questions with
  // different answers, and blending them into one number answers neither. That
  // blend is what made a fabricated article come back with a rating at all — a
  // reader sees a score out of ten and reads it as a mark for truthfulness,
  // which it never was.
  //
  // So the writing checks are reported on their own, as a description of craft,
  // with no claim about whether the events happened. A propaganda piece can be
  // beautifully written and false; a true local report can be scrappy. Showing
  // both, separately, is more honest than averaging them into a number that
  // means neither.
  //
  // A plain mean is right here precisely BECAUSE this is not evidence
  // accumulation. Nothing is being inferred from it, so there is nothing to
  // weigh — it is a summary of four checks, and it says so.
  const craftChecks = [
    { id: 'clickbait', name: 'Headline is honest', result: clickbaitResult },
    { id: 'bias', name: 'Language is fair', result: biasResult },
    { id: 'transparency', name: 'Sources you can check', result: transparencyResult, needsFullText: true },
    { id: 'manipulation', name: 'No persuasion tricks', result: manipulationResult }
  ].filter(check => typeof check.result?.score === 'number')
   .filter(check => !(check.needsFullText && excerptOnly));

  const craftScore = craftChecks.length
    ? Math.round((craftChecks.reduce((sum, c) => sum + c.result.score, 0) / craftChecks.length) * 10) / 10
    : null;

  const quality = craftScore === null ? null : {
    score: craftScore,
    level: craftScore >= 7.5 ? 'high' : craftScore >= 5 ? 'medium' : 'low',
    label: craftScore >= 7.5 ? 'Well written'
      : craftScore >= 5 ? 'Mixed'
      : 'Poorly written',
    note: 'This describes how the article is written — not whether it is true. Anyone can write neatly, so good writing on its own is not a reason to believe a story.',
    checks: craftChecks.map(check => ({
      id: check.id,
      name: check.name,
      score: check.result.score,
      degraded: Boolean(check.result.degraded)
    }))
  };

  // What each check actually did to the answer, in decibans. This replaces the
  // old "counts for 18% of the score": a percentage was an assignment, this is
  // a measurement, and a check that changed nothing now says so.
  const contribution = Object.fromEntries(
    assessment.ledger.filter(entry => entry.step === 'factor').map(entry => [entry.label, entry])
  );
  const contributionOf = (id) => {
    const unmeasured = assessment.unmeasured.find(u => u.factor === id);
    if (unmeasured) return { decibans: 0, measured: false, note: unmeasured.reason };
    const entry = contribution[id];
    if (!entry) return { decibans: 0, measured: false, note: 'this check contributed no evidence' };
    return {
      decibans: entry.decibans,
      likelihoodRatio: entry.likelihoodRatio,
      band: entry.band,
      measured: true,
      note: entry.basis
    };
  };

  const unreadReason = (result) => (result?.unread ? 'Not counted — this check could not be finished in time.' : undefined);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    overallScore,
    // The headline answer is now the verdict, not the number. A score alone
    // cannot say "other outlets contradict this"; the verdict can, and it
    // carries the rule that produced it so the reader can check the reasoning.
    // The answer in one word, and the reason in one sentence. A reader who
    // reads nothing else gets both, and is correctly informed by them.
    call: decision.call,
    oneLine: decision.oneLine,
    verdict: decision.label,
    verdictLevel: decision.level,
    verdictClass: decision.verdict,
    advice: decision.advice,
    decision: {
      verdict: decision.verdict,
      call: decision.call,
      oneLine: decision.oneLine,
      label: decision.label,
      rule: decision.rule,
      grounds: decision.grounds,
      confidence: decision.confidence,
      ceiling: decision.ceiling
    },
    // The absolute quantity: how likely this is to be fake news, given every
    // measured observation and the stated base rate. Unlike a 0-10 score it
    // refers to something outside this code, so it can be checked — across a
    // hundred articles scored 0.7, about seventy should be fabricated.
    probabilityFake: assessment.probabilityFabricated,
    probabilityPercent: Math.round(assessment.probabilityFabricated * 100),
    // Craft, reported separately and making no claim about truth.
    quality,
    // The full derivation, in decibans. These ADD, so a reader can check the
    // arithmetic: prior + every factor + corroboration = total.
    evidenceLedger: assessment.ledger,
    totalDecibans: assessment.totalDecibans,
    priorProbability: assessment.priorProbability,
    priorBand: assessment.priorBand,
    // Checks that ran but could contribute nothing, because no likelihood ratio
    // has been measured for them yet. Named rather than silently folded in.
    unmeasuredFactors: assessment.unmeasured,
    // Parameters that are declared rather than estimated. The reader is told
    // which parts of this rest on a stated assumption.
    declaredParameters: assessment.declaredParameters,
    scoreBeforeCeiling: Math.round(scoreFromProbability * 10) / 10,
    scoreCapped: ceilingOutcome.capped,
    ceilingReason: ceilingOutcome.ceilingReason,
    scoreBand: scoreBand.label,
    evidence: {
      checkableClaims: evidenceLedger.checkableClaimCount,
      independentSupport: evidenceLedger.independentSupport,
      independentContradiction: evidenceLedger.independentContradiction,
      articlesRetrieved: evidenceLedger.rawSupportingArticles,
      hasHighQualitySource: evidenceLedger.hasHighQualitySource,
      stateOnlySupport: evidenceLedger.stateOnlySupport,
      // Why several retrieved articles counted as one source.
      independenceNotes: evidenceLedger.mergeNotes,
      // A claim nothing reports, carried by one that is confirmed.
      unconfirmedClaim: evidenceLedger.unconfirmedClaim,
      perClaim: evidenceLedger.perClaim.map(c => ({
        claim: c.claim,
        verdict: c.verdict,
        independentSupport: c.independentSupport,
        independentContradiction: c.independentContradiction,
        // The facts each side reports, in the outlets' own words.
        reportedFor: c.reportedFor,
        reportedAgainst: c.reportedAgainst,
        sources: c.support.clusters.map(cluster => ({
          label: cluster.label,
          collapsedFrom: cluster.collapsedFrom,
          reliability: cluster.reliability,
          members: cluster.members
        })),
        contradictingSources: c.contradiction.clusters.map(cluster => ({
          label: cluster.label,
          collapsedFrom: cluster.collapsedFrom,
          reliability: cluster.reliability,
          members: cluster.members
        }))
      }))
    },
    // How the message was read: language, what kind of message it is, and the
    // claims checked. Absent for articles, which go through the extractor.
    understanding: understanding ? {
      language: understanding.language,
      languageName: understanding.languageName,
      romanized: understanding.romanized,
      speechAct: understanding.speechAct,
      tone: understanding.tone,
      english: understanding.english,
      claims: understanding.claims.map(c => ({ claim: c.claim, time: c.time, kind: c.kind, checkable: c.checkable }))
    } : null,
    // This week's coverage of the subject, and what of it bears on the claim.
    currentCoverage: {
      status: currentCoverageResult.status,
      subject: currentCoverageResult.subject || null,
      explanation: currentCoverageResult.explanation,
      headlinesRead: currentCoverageResult.headlinesRead || 0,
      outletsRead: currentCoverageResult.outletsRead || 0,
      counted: evidenceLedger.currentCoverageOutcome,
      presupposingFalse: (currentCoverageResult.presupposingFalse || []).slice(0, 6),
      reporting: (currentCoverageResult.reporting || []).slice(0, 6)
    },
    // The encyclopedia check of the claim's named subjects.
    premiseCheck: {
      status: premiseResult.status,
      explanation: premiseResult.explanation,
      checked: (premiseResult.checked || []).map(c => ({ entity: c.entity, reference: c.reference || null })),
      contradictions: (premiseResult.contradictions || []).map(c => ({
        entity: c.entity, articleStates: c.articleStates, referenceStates: c.referenceStates, reference: c.reference || null
      })),
      confirmations: (premiseResult.confirmations || []).map(c => ({
        entity: c.entity, referenceStates: c.referenceStates, reference: c.reference || null
      }))
    },
    // What the fact-checking desks said, review by review, so the reader can
    // open each ruling rather than take the verdict on trust.
    factChecks: {
      status: factCheckResult.status,
      explanation: factCheckResult.explanation,
      considered: factCheckResult.considered || 0,
      matches: (factCheckResult.matches || []).map(m => ({
        publisher: m.publisher, url: m.url, reviewedAt: m.reviewedAt,
        claimReviewed: m.claimReviewed, rating: m.rating, finding: m.finding, why: m.why, via: m.via
      }))
    },
    degradedFactors,
    // Channels still out when the answer was due: reported as not read, never
    // as having found nothing (see UNREAD).
    unreadChannels,
    degradedNote: degradedFactors.length
      ? `${degradedFactors.length} of these checks ran without the language model and used word-pattern matching instead. They catch less than a full check would.`
      : null,
    // Plain-English layer shown first; the factor breakdown below is for
    // readers who want the detail.
    plainSummary: plain.summary,
    goodPoints: plain.goodPoints,
    concernPoints: plain.concernPoints,
    factors: [
      {
        id: 'sourceReputation',
        name: 'Who published it',
        score: sourceResult.score,
        contribution: contributionOf('sourceReputation'),
        detail: {
          matched: sourceResult.matched,
          matchedName: sourceResult.matchedName,
          bias: sourceResult.bias,
          type: sourceResult.type,
          // What the page says about an unrecognised source depends on why it
          // is unrecognised: an impersonator, an unverified account and a small
          // unrated paper are three different things to tell a reader.
          notes: sourceResult.notes || null,
          impersonates: sourceResult.impersonates || null,
          ratingSource: sourceResult.ratingSource || null
        },
        explanation: sourceResult.matched
          ? `${sourceResult.matchedName} (${sourceResult.type}) — ${sourceResult.notes}`
          : sourceResult.notes
      },
      {
        id: 'clickbait',
        name: 'Is the headline honest?',
        score: clickbaitResult.score,
        contribution: contributionOf('clickbait'),
        degraded: Boolean(clickbaitResult.degraded),
        standDownReason: unreadReason(clickbaitResult),
        detail: {
          isClickbait: clickbaitResult.isClickbait,
          signals: clickbaitResult.signals
        },
        explanation: clickbaitResult.explanation
      },
      {
        id: 'bias',
        name: 'Is the writing fair?',
        score: biasResult.score,
        contribution: contributionOf('bias'),
        degraded: Boolean(biasResult.degraded),
        standDownReason: unreadReason(biasResult),
        detail: {
          biasLevel: biasResult.biasLevel,
          politicalLean: biasResult.politicalLean,
          flaggedSentences: biasResult.flaggedSentences
        },
        explanation: biasResult.explanation
      },
      {
        id: 'transparency',
        name: 'Can you check it yourself?',
        // An excerpt has no sourcing to find, so there is no score to report.
        score: excerptOnly ? null : transparencyResult.score,
        contribution: contributionOf('transparency'),
        degraded: Boolean(transparencyResult.degraded),
        counted: !excerptOnly && !transparencyResult.unread,
        standDownReason: excerptOnly
          ? 'Not checked — only the publisher’s summary was available, not the article itself.'
          : unreadReason(transparencyResult),
        detail: {
          level: transparencyResult.level,
          checks: transparencyResult.checks,
          passedCount: transparencyResult.passedCount,
          totalChecks: transparencyResult.totalChecks,
          namedExamples: transparencyResult.namedExamples,
          vagueAttributions: transparencyResult.vagueAttributions
        },
        explanation: transparencyResult.summary
      },
      {
        id: 'manipulation',
        name: 'Is it using persuasion tricks?',
        score: manipulationResult.score,
        contribution: contributionOf('manipulation'),
        degraded: Boolean(manipulationResult.degraded),
        standDownReason: unreadReason(manipulationResult),
        detail: {
          intensity: manipulationResult.intensity,
          techniques: manipulationResult.techniques,
          summary: manipulationResult.summary
        },
        explanation: manipulationResult.summary || 'No persuasion techniques were detected.'
      },
      {
        id: 'verification',
        name: 'Do other outlets agree?',
        score: verificationResult.score,
        // This factor no longer carries a share of the weighted sum. It decides
        // the ceiling instead, which is a stronger role: it can hold the score
        // down however well the article is written.
        weight: null,
        role: 'evidence',
        setsCeiling: decision.ceiling,
        counted: verificationInformative,
        standDownReason: verificationNote,
        detail: {
          status: verificationResult.status,
          claims: verificationResult.claims,
          independentSupport: evidenceLedger.independentSupport,
          independentContradiction: evidenceLedger.independentContradiction,
          articlesRetrieved: evidenceLedger.rawSupportingArticles,
          independenceNotes: evidenceLedger.mergeNotes
        },
        explanation: verificationInformative ? verificationResult.explanation : verificationNote
      }
    ],
    analyzedAt: new Date().toISOString(),
    // Operational metadata, not part of the score. It lets us optimise using
    // measured bottlenecks instead of guessing and is useful in development.
    // Which text the factors actually judged: the publisher's page, or the
    // feed's short excerpt when the page could not be read.
    modality: modality || 'article',
    provenance: provenance || null,
    ingestNotes: [],
    language: { code: language.code, name: language.name, script: language.script, confidence: language.confidence, reliable: language.reliable },
    textCoverage: textCoverage === 'full' ? 'article-text' : 'publisher-excerpt',
    analysedChars: text.length,
    timings: { total: Date.now() - startedAt, ...timings }
  };
};

module.exports = { analyzeTrust, startMessageChecks, UNREAD, WEIGHTS, verdictFromScore, REPORT_SCHEMA_VERSION, FACTOR_LABELS };
