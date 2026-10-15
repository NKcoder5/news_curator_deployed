// backend/agents/verdictEngine.js
//
// The decision layer: turns evidence into a stated verdict, and stops a
// well-written fabrication from scoring as trustworthy.
//
// WHY THIS EXISTS
//
// Five of the six factors measure how an article PRESENTS itself — who
// published it, headline style, neutral wording, whether it names sources,
// whether it leans on persuasion. All five are cheap to fake. Inventing a
// quote from a named professor raises the transparency factor; writing calmly
// raises the language factor. Only cross-source verification asks whether the
// events described actually happened.
//
// The earlier design combined all six in a weighted sum and, when verification
// found nothing, redistributed its weight across the other five. That inverted
// the meaning of the evidence: a fabricated story has no corroborating coverage
// precisely BECAUSE it is fabricated, and the pipeline read that absence as a
// reason to trust the remaining factors more. A competent fabrication scored
// 7-8/10.
//
// The rule applied here instead:
//
//     presentation can only LOWER trust; evidence is what RAISES it.
//
// Final score = min(presentation score, evidence ceiling). An article nobody
// else reports cannot exceed the "unverified" ceiling however well written it
// is. Separately, a discrete verdict is derived from the evidence by rules
// stated below, so the reader is told what the system concluded and which rule
// concluded it — not only a number.
//
// Every decision in this file is deterministic. No model is called. Given the
// same evidence it returns the same verdict, and the rule that fired is named
// in the output.

const { INDEX_LAG_HOURS } = require('../utils/newsFetcher');
const { analyseIndependence } = require('./independence');


/** "two hours", "three days" — enough for the reader to judge the abstention. */
const describeAge = (hours) => {
  if (hours === null || !Number.isFinite(hours)) return 'less than a day';
  if (hours < 1) return 'less than an hour';
  if (hours < 2) return 'about an hour';
  if (hours < 36) return `about ${Math.round(hours)} hours`;
  return `about ${Math.round(hours / 24)} days`;
};

/**
 * Verdict classes. `ceiling` is the highest trust score an article in this
 * class may receive, whatever the presentation factors say.
 *
 * The ceilings are set against the reader-facing bands (>=7.5 trustworthy,
 * >=5.5 mostly fine, >=4.0 read carefully): "unverified" sits at 4.9 so that an
 * uncorroborated story can never be described as fine, and "opinion" at 6.4 so
 * that commentary is not punished as though it were a false report.
 */
const VERDICT_CLASSES = {
  false: {
    label: 'False',
    call: 'FAKE',
    level: 'false',
    ceiling: 2.0,
    advice: 'Independent reporting contradicts this. Do not share it.'
  },
  'likely-false': {
    label: 'Probably false',
    call: 'FAKE',
    level: 'likely-false',
    ceiling: 3.5,
    advice: 'The evidence points against this story. Treat it as false unless it is confirmed elsewhere.'
  },
  // Several claims, and the evidence splits: at least one confirmed, at least
  // one contradicted. One verdict for the whole message would be wrong either
  // way, and "true" would be the dangerous one.
  mixed: {
    label: 'Partly true, partly false',
    call: 'PARTLY FALSE',
    level: 'likely-false',
    ceiling: 3.5,
    advice: 'Part of this is true and part is not. Do not share it as it stands.'
  },
  // It happened — but not now. The coverage that confirms it is weeks or
  // years old, and the message presents it as today's news.
  outdated: {
    label: 'Old news, shared as new',
    call: 'FAKE',
    level: 'likely-false',
    ceiling: 3.0,
    advice: 'This is old news being passed off as new. Check the date before sharing.'
  },
  unverified: {
    label: 'Not confirmed',
    call: 'CANNOT VERIFY',
    level: 'unverified',
    ceiling: 4.9,
    advice: 'No independent outlet reports this. That is not proof it is false — it means nothing yet supports it.'
  },
  opinion: {
    label: 'Opinion, not reporting',
    call: 'NOT A FACTUAL CLAIM',
    level: 'opinion',
    ceiling: 6.4,
    advice: 'This is argument rather than reporting. There is no factual claim here to verify.'
  },
  satire: {
    label: 'Satire',
    call: 'SATIRE',
    level: 'satire',
    ceiling: 4.0,
    advice: 'This is a satirical publication. It is not intended as factual reporting.'
  },
  'likely-true': {
    label: 'Probably true',
    call: 'REAL',
    level: 'likely-true',
    ceiling: 8.0,
    advice: 'One independent source reports the same facts. A second would settle it.'
  },
  corroborated: {
    label: 'Confirmed by other outlets',
    call: 'REAL',
    level: 'corroborated',
    ceiling: 10,
    advice: 'Independent outlets report the same facts.'
  }
};

// Wording that marks a claim as consequential enough that silence from every
// other outlet is itself meaningful. A local council decision going unreported
// elsewhere is ordinary; a cure, a coup or a mass casualty event going
// unreported everywhere is not.
const HIGH_IMPACT_PATTERNS = [
  /\bcure[sd]?\b/i, /\bbreakthrough\b/i, /\bfirst[- ]ever\b/i, /\bbanned\b/i,
  /\bdeath toll\b/i, /\bkilled\b/i, /\bmassacre\b/i, /\bcoup\b/i, /\bresign(s|ed|ation)\b/i,
  /\barrest(s|ed)\b/i, /\bimpeach/i, /\bdeclares? war\b/i, /\bnuclear\b/i,
  /\bsecret(ly)?\b/i, /\bleaked\b/i, /\bexposed\b/i, /\bcover[- ]up\b/i,
  /\bmillions? (of )?(people|deaths|dollars)\b/i, /\bemergency\b/i, /\bevacuat/i,
  /\bpandemic\b/i, /\boutbreak\b/i, /\brecall(s|ed)?\b/i, /\bcollapse[sd]?\b/i
];

/** How old the newest confirming report may be before "now" reads as old news. */
const STALE_AFTER_DAYS = 21;

// Words that make a headline a report OF a debunk, not a report of the claim:
// "Video of Army chief dancing is AI-generated" mentions the claim and refutes it.
const DEBUNK_WORDS = /\b(?:fake|false|falsely|hoax|morphed|doctored|edited|deep\s?fake|ai[\s-]generated|ai[\s-]manipulated|fact[\s-]?check|misleading|debunk\w*|not true|baseless|rumou?r|viral claim|old video|old photo)\b/i;

const looksHighImpact = (text) => HIGH_IMPACT_PATTERNS.some(pattern => pattern.test(String(text || '')));

/**
 * Reduce the verification factor's per-claim results to an evidence ledger,
 * counting INDEPENDENT sources rather than articles.
 *
 * @param {Object} input
 * @param {Array}  input.claims - per-claim results from the verification factor
 * @param {Object} input.sourceResult - source reputation factor result
 * @param {Object} [input.transparencyResult]
 * @param {Object} [input.manipulationResult]
 * @param {string} [input.title]
 * @returns {Object} the ledger the verdict rules read
 */
/** A page's address without scheme, "www.", query or trailing slash. */
const pageKey = (u) => {
  try {
    const x = new URL(String(u || ''));
    return x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '').toLowerCase();
  } catch (_) { return null; }
};
const pageRulingOf = (pageUrl, matches = []) => {
  const key = pageUrl && pageKey(pageUrl);
  return (key && (matches || []).find(m => m.via !== 'news-search' && pageKey(m.url) === key)) || null;
};

const { denies } = require('../utils/factCheckDesks');

const buildEvidenceLedger = ({
  claims = [], sourceResult = {}, transparencyResult = {}, manipulationResult = {}, title = '',
  verificationStatus = 'unverified', premiseResult = null, factCheckResult = null, currentCoverageResult = null,
  unconfirmedClaimResult = null,
  publishedAt = null, indexLagHours = INDEX_LAG_HOURS, domainAge = null, pageUrl = null, pageDesk = null,
  // The moment the verdict is reached. Everything time-dependent below (how
  // old the story is, whether a report is recent enough to contradict a claim
  // about now, whether confirming coverage is old news) is measured from it,
  // never from the clock, so a stored verdict replays as it was reached: what
  // was known then, not what is known now.
  asOf = Date.now()
}) => {
  // How old the story is, when the page told us. An unknown date is left
  // unknown: guessing "now" would make every undated article look too recent
  // to check, which is a worse error than the one being fixed.
  const ageMs = publishedAt ? asOf - new Date(publishedAt).getTime() : NaN;
  const articleAgeHours = Number.isFinite(ageMs) && ageMs >= 0 ? ageMs / 3600000 : null;
  const perClaim = claims.map(claim => {
    // A claim about something happening now can only be contradicted by
    // reports from now. "A week-long power cut in Madurai from tomorrow" was
    // "contradicted" by a February report of a one-day shutdown: a different
    // occurrence, which a judge model let through as the same event.
    const recentEnough = (e) => !e.publishedAt || !Number.isFinite(Date.parse(e.publishedAt))
      || asOf - Date.parse(e.publishedAt) <= STALE_AFTER_DAYS * 86400000;
    const contradicting = claim.time === 'now'
      ? (claim.contradictingEvidence || []).filter(recentEnough)
      : (claim.contradictingEvidence || []);
    claim = { ...claim, contradictingEvidence: contradicting };
    const isDebunk = (e) => DEBUNK_WORDS.test(`${e.title || ''} ${e.reported || ''}`);
    const claimIsDenial = denies(claim.claim);
    let supportingEvidence = claim.supportingEvidence || [];
    let contradictingEvidence = contradicting;
    if (!claimIsDenial) {
      const misclassifiedDebunks = supportingEvidence.filter(isDebunk);
      if (misclassifiedDebunks.length > 0) {
        supportingEvidence = supportingEvidence.filter(e => !isDebunk(e));
        contradictingEvidence = [...contradictingEvidence, ...misclassifiedDebunks];
      }
    }
    const support = analyseIndependence(supportingEvidence);
    const contradiction = analyseIndependence(contradictingEvidence);
    // Evidence for and against one claim is weighed against itself. One outlet
    // read as disagreeing used to outrank four confirming the same claim,
    // because contradiction is checked first. The side with more independent
    // outlets counts; an even split counts for neither and stays unconfirmed.
    const againstCount = contradiction.independentCount;
    // Old news passed off as new. The reader's message presents the claim as
    // happening now, and every dated report confirming it is weeks old: the
    // event is real and the framing is false. "Modi announces 500 and 1000
    // notes invalid from midnight tonight" is confirmed by the coverage of
    // November 2016, which is exactly why it must not count as confirmation.
    //
    // Old coverage is not support for a claim about now at all: it shows the
    // event happened then. It used to count as support until it outnumbered
    // the contradiction, so two fresh reports contradicting a "now" claim
    // confirmed by two old ones made an even split and cancelled both — more
    // evidence against turned FAKE into CANNOT VERIFY (found by the
    // monotonicity sweep in test/verdictMonotonicity.test.js).
    const supportDates = supportingEvidence
      .map(e => Date.parse(e.publishedAt)).filter(Number.isFinite);
    const newestSupport = supportDates.length ? Math.max(...supportDates) : null;
    const stale = claim.time === 'now' && support.independentCount > 0 && newestSupport !== null
      && asOf - newestSupport > STALE_AFTER_DAYS * 86400000;
    const forCount = stale ? 0 : support.independentCount;
    return {
      claim: claim.claim,
      verdict: claim.verdict,
      time: claim.time || null,
      kind: claim.kind || null,
      fromTitle: Boolean(claim.fromTitle),
      stale,
      newestSupport: newestSupport ? new Date(newestSupport).toISOString() : null,
      independentSupport: forCount > againstCount ? forCount : 0,
      independentContradiction: againstCount > forCount ? againstCount : 0,
      // What the outlets actually say, in their own words ("85 medals"), so the
      // verdict can quote the conflicting fact instead of only counting it.
      reportedAgainst: [...new Set(contradictingEvidence.map(e => String(e.reported || '').trim()).filter(Boolean))],
      reportedFor: [...new Set(supportingEvidence.map(e => String(e.reported || '').trim()).filter(Boolean))],
      support,
      contradiction,
      highImpact: looksHighImpact(claim.claim)
    };
  });

  // The article's support level is the best-evidenced single claim, not the sum
  // across claims: two outlets confirming two DIFFERENT claims is weaker
  // evidence than two outlets confirming the same one.
  const best = (key) => perClaim.reduce((max, c) => Math.max(max, c[key]), 0);

  const supportingClusters = perClaim.flatMap(c => c.support.clusters);
  const strongestSupport = perClaim.reduce(
    (bestClaim, c) => (c.independentSupport > (bestClaim?.independentSupport ?? -1) ? c : bestClaim),
    null
  );

  const independentSupport = best('independentSupport');
  const independentContradiction = best('independentContradiction');

  // This week's coverage of the subject. Only consulted when the news search
  // found nothing either way: when outlets report or contradict the event
  // itself, that is the better evidence and this is not needed.
  const presupposition = analyseIndependence(currentCoverageResult?.presupposingFalse || []);
  const newsSilent = independentSupport === 0 && independentContradiction === 0;
  const currentCoverageOutcome = !newsSilent ? null
    : currentCoverageResult?.status === 'presupposed-false' && presupposition.independentCount >= 2 ? 'presupposedFalse'
    : currentCoverageResult?.status === 'absent'
      && currentCoverageResult.headlinesRead >= 12 && currentCoverageResult.outletsRead >= 5 ? 'absentFromHeavyCoverage'
    : null;

  // The index cannot have seen this story yet, and it found nothing. Those two
  // facts together mean the corroboration check has no information to give,
  // which is the same position as a check that could not run at all.
  const tooRecentToCorroborate = articleAgeHours !== null
    && articleAgeHours < indexLagHours
    && independentSupport === 0
    && independentContradiction === 0;

  return {
    checkableClaimCount: claims.length,
    // "We found no claim worth checking" and "the check could not run" look
    // identical in the claim list and mean opposite things. Without this flag a
    // model outage would silently reclassify every article as commentary, which
    // carries a far higher ceiling than an unverified report.
    verificationRan: verificationStatus !== 'error' && !tooRecentToCorroborate,
    // The search itself failed or was not read in time (not merely too
    // recent for the index): nothing was observed, either way.
    searchFailed: verificationStatus === 'error',
    tooRecentToCorroborate,
    articleAgeHours,
    indexLagHours,
    // A reference work contradicting something the article states about a named
    // subject. Distinct from a news contradiction, and not merged with it: an
    // encyclopedia is not an independent newsroom reporting an event, it is a
    // record of stable facts, so it speaks to the article's premises rather
    // than to what happened.
    premiseContradictions: premiseResult?.contradictions || [],
    // A reference entry stating the same standing fact. Used only for claims
    // about standing or past facts, where an encyclopedia is the right witness
    // — never for today's events, which it cannot have recorded.
    premiseConfirmations: premiseResult?.confirmations || [],
    referenceCanConfirm: perClaim.some(c => c.kind === 'standing_fact' || c.time === 'timeless' || c.time === 'past'),
    staleClaims: perClaim.filter(c => c.stale).map(c => ({ claim: c.claim, newestSupport: c.newestSupport })),
    confirmedClaims: perClaim.filter(c => c.independentSupport > 0).map(c => c.claim),
    contradictedClaims: perClaim.filter(c => c.independentContradiction > 0)
      .map(c => ({ claim: c.claim, fromTitle: c.fromTitle, reported: c.reportedAgainst.filter(q => q.length <= 80).sort((x, y) => y.length - x.length)[0] || null })),
    premiseStatus: premiseResult?.status || 'not-run',
    // A professional fact-checking desk's published ruling on this same claim.
    // Kept apart from the news count for the same reason as the premise check:
    // a desk that investigated a viral rumour is not a newsroom reporting an
    // event, and the rumours it rules on are the ones newsrooms never cover.
    factCheckStatus: factCheckResult?.status || 'not-run',
    factChecks: factCheckResult?.matches || [],
    // The desk's review published at the submitted page's own address: the
    // page is that ruling, not a message repeating the claim it rules on.
    pageRuling: pageRulingOf(pageUrl, factCheckResult?.matches),
    // The recognised desk that published the submitted page, if one did.
    pageDesk: pageDesk || null,
    // Whether that page's title denies what it examines, as a debunk does.
    pageDenies: Boolean(pageDesk) && denies(title),
    currentCoverageOutcome,
    // An unreported claim riding with a confirmed one, and what this week's
    // coverage of its subject says about it.
    unconfirmedClaim: unconfirmedClaimResult ? (() => {
      const week = unconfirmedClaimResult.week || {};
      const ruledOut = analyseIndependence(week.presupposingFalse || []).independentCount;
      const outcome = ruledOut >= 2 ? 'presupposedFalse'
        : week.status === 'absent' && week.headlinesRead >= 12 && week.outletsRead >= 5 ? 'absentFromHeavyCoverage'
        : 'unreported';
      return {
        claim: unconfirmedClaimResult.claim,
        confirmedClaim: unconfirmedClaimResult.confirmedClaim,
        outcome,
        subject: week.subject || null,
        headlinesRead: week.headlinesRead || 0,
        outletsRead: week.outletsRead || 0,
        evidence: (week.presupposingFalse || []).slice(0, 3)
      };
    })() : null,
    currentCoverageSubject: currentCoverageResult?.subject || null,
    currentCoverageRead: { headlines: currentCoverageResult?.headlinesRead || 0, outlets: currentCoverageResult?.outletsRead || 0 },
    presupposedAgainst: presupposition.independentCount,
    presupposingFalse: currentCoverageResult?.presupposingFalse || [],
    independentSupport,
    independentContradiction,
    // Support that could overtake a fact-check ruling: outlets reporting the
    // claim as fact, with the headlines that report the debunk itself removed.
    // Measured: on the Army-chief deepfake, eleven outlets reporting "the video
    // is AI-generated" were judged as supporting the claim, and the ruling of
    // seven fact-checkers was set aside as overtaken.
    // Old coverage cannot overtake a ruling either: found by the decision
    // explainer, a fact-checker's "false" added to old news passed off as new
    // turned FAKE into CANNOT VERIFY, because the 2022 reports of the event
    // were counted as reporting that had overtaken the ruling.
    // And only where it outnumbers the outlets contradicting that claim: an
    // even split used to overtake a ruling, so adding contradicting outlets
    // turned the ruling's FAKE into CANNOT VERIFY (eval/counterfactualFaithfulness.js).
    supportBeyondDebunks: Math.max(0, ...perClaim.filter(c => !c.stale).map(c => {
      const beyond = analyseIndependence(
        (claims.find(x => x.claim === c.claim)?.supportingEvidence || []).filter(e => !DEBUNK_WORDS.test(`${e.title || ''} ${e.reported || ''}`))
      ).independentCount;
      return beyond > c.contradiction.independentCount ? beyond : 0;
    })),
    // The contradicted claim's conflicting facts, as the outlets worded them.
    reportedAgainst: (perClaim.reduce(
      (most, c) => (c.independentContradiction > (most?.independentContradiction ?? 0) ? c : most), null
    )?.reportedAgainst) || [],
    perClaim,
    mergeNotes: [...new Set(perClaim.flatMap(c => [...c.support.mergeNotes, ...c.contradiction.mergeNotes]))],
    rawSupportingArticles: perClaim.reduce((sum, c) => sum + c.support.itemCount, 0),
    hasHighQualitySource: perClaim.some(c => c.support.hasHighQualitySource),
    stateOnlySupport: Boolean(strongestSupport && strongestSupport.independentSupport > 0 && strongestSupport.support.stateOnly),
    supportingClusters,
    // Presentation-side risk signals, used only to separate "we found nothing"
    // from "we found nothing and the article looks engineered".
    sourceKnown: Boolean(sourceResult.matched),
    sourceReliability: Number(sourceResult.score) || 0,
    // The known outlet this page claims to be while publishing from an address
    // that outlet does not use. See agents/sourceReputationAgent.js.
    impersonates: sourceResult.impersonates || null,
    // A domain registered weeks ago (utils/domainAge.js). Null when the
    // registry was not asked or did not answer — not "old".
    domainAge: domainAge || null,
    sourceIsSatire: String(sourceResult.type || '').toLowerCase() === 'satire',
    sourceIsConspiracy: String(sourceResult.type || '').toLowerCase() === 'conspiracy',
    transparencyScore: Number(transparencyResult.score) || 0,
    persuasionTechniqueCount: (manipulationResult.techniques || []).length,
    highImpact: looksHighImpact(title) || perClaim.some(c => c.highImpact)
  };
};

/**
 * Decide the verdict from the ledger.
 *
 * Rules are evaluated in order and the first match wins. Each returns the rule
 * id that fired and the grounds in plain language, so the report can show its
 * working rather than asserting a conclusion.
 *
 * @param {Object} ledger - from buildEvidenceLedger
 * @returns {{verdict: string, label: string, level: string, ceiling: number, advice: string,
 *            rule: string, grounds: string[], confidence: number}}
 */
const decideVerdict = (ledger) => {
  const grounds = [];
  const decide = (verdict, rule, reasons, adviceOverride) => {
    const spec = VERDICT_CLASSES[verdict];
    return {
      verdict,
      label: spec.label,
      level: spec.level,
      ceiling: spec.ceiling,
      // Most verdicts want their class's stock advice, but a couple of rules
      // reach the same verdict for a different reason and must not tell the
      // reader we searched when we could not.
      advice: adviceOverride || spec.advice,
      // The call is the answer in one word — FAKE, REAL, CANNOT VERIFY — and
      // `oneLine` is the whole reason for it in a single sentence. A reader who
      // reads nothing else should still have both, and be correctly informed.
      // Everything below is for the reader who wants to see the working.
      call: spec.call,
      oneLine: summarise(verdict, ledger, rule),
      rule,
      grounds: reasons,
      confidence: confidenceFor(verdict, ledger, rule)
    };
  };

  // R0 — A satirical publication is not making a truth claim at all, so
  // corroboration and contradiction are both meaningless for it.
  if (ledger.sourceIsSatire) {
    return decide('satire', 'satirical-publisher', [
      'The publisher is a satirical outlet in our source database.'
    ]);
  }

  const describeReview = (m) => {
    const when = m.reviewedAt ? ` on ${m.reviewedAt}` : '';
    // Found through the news search: a headline, not a structured ruling.
    if (m.via === 'news-search') {
      return `${m.publisher || 'A fact-checker'} reported${when}: "${String(m.claimReviewed || '').slice(0, 160)}".`;
    }
    const checked = m.claimReviewed ? ` "${String(m.claimReviewed).slice(0, 160)}"` : ' this claim';
    const rating = m.rating && m.rating.length <= 40 ? m.rating : m.finding;
    return `${m.publisher || m.site || 'A fact-checker'} reviewed${checked}${when} and rated it ${rating}.`;
  };

  // R0a — The page is itself a desk's published ruling. "Viral Social Media
  // Posts Offer False Coronavirus Tips", submitted as a FactCheck.org link,
  // came back FAKE: the rumour it quotes was extracted as its claim, and its
  // own ruling on that rumour was then held against it. A review the
  // fact-check record lists at this very address is the page; what it
  // asserts is the ruling. It stands unless another desk rules the other way.
  //
  // Without a ruling at this address (the record lookup can fail or miss), a
  // page a recognised desk published counts only when independent evidence
  // agrees with it: outlets or the encyclopedia reject the claim it examines.
  // On such a page evidence against the quoted claim is evidence for the
  // page, which is why this rule sits before every rule that reads it the
  // other way.
  const own = ledger.pageRuling;
  const desk = (own && (own.publisher || own.site)) || ledger.pageDesk;
  // Only the quoted claim agrees by being rejected: the page's own denial,
  // rejected, would mean the page is wrong. And on a page whose title denies
  // what it examines, another desk's "false" on the same claim agrees with it.
  const examined = (ledger.contradictedClaims || []).find(c => !denies(c.claim)) || null;
  const otherDesks = ledger.pageDenies && ['debunked', 'misleading'].includes(ledger.factCheckStatus)
    ? ledger.factChecks.filter(m => m !== own && m.finding !== 'true') : [];
  const rejectedElsewhere = Boolean(examined) || otherDesks.length > 0
    || (ledger.premiseContradictions || []).some(p => !denies(p.articleStates));
  if (desk && (own || rejectedElsewhere)) {
    const opposed = Boolean(own) && ledger.factChecks.some(m => m !== own && m.finding && own.finding
      && ((m.finding === 'true') !== (own.finding === 'true')));
    if (!opposed) {
      return decide('likely-true', 'page-is-a-published-fact-check', [
        own ? `This page is ${desk}'s own fact-check, listed at this address in the fact-checking record.`
          : `This page is a fact-check published by ${desk}, a recognised fact-checking desk.`,
        ...(own ? [describeReview(own)] : []),
        ...(examined ? [`The claim it examines — ${examined.claim} — is reported otherwise by independent outlets${examined.reported ? `: "${examined.reported}"` : ''}, which agrees with its finding.`] : []),
        ...otherDesks.slice(0, 2).map(m => `Another desk agrees: ${describeReview(m)}`),
        'A fact-check reports what was examined and what was found; the claim it quotes is not what it asserts.'
      ], 'This is a genuine published fact-check. Share its finding, not the claim it examines.');
    }
  }

  // R0b — A professional fact-checking desk has already ruled on this claim.
  //
  // This comes before the news rules because it answers what they cannot. A
  // viral rumour — "all Saturdays are now bank holidays", "this video shows the
  // Army chief dancing" — is never reported as news, so the news search finds
  // nothing and could only say "cannot verify". The desks exist to investigate
  // exactly these, and a desk's published ruling, matched to the same assertion
  // the reader typed, is the strongest evidence this system has access to.
  //
  // One exception: a ruling can be overtaken by events. A rumour rated false in
  // March can come true in June, and three or more independent outlets now
  // reporting it as fact is a disagreement the reader should see rather than
  // one this code should settle by picking a side.
  //
  // Three, not two: a stance judgement on news retrieved for a popular topic
  // can produce one or two false positives — "Vijay launches TVK party" read
  // as confirming "Vijay is the Chief Minister" is a real example. Two
  // independent outlets is within the noise; three is the minimum before
  // setting a professional desk's ruling aside.
  const factCheckOvertaken = ledger.supportBeyondDebunks >= 3
    && ledger.supportBeyondDebunks > ledger.independentContradiction;
  if (['debunked', 'misleading'].includes(ledger.factCheckStatus) && ledger.factChecks.length > 0) {
    if (factCheckOvertaken) {
      // The ruling is set aside, not reversed: the verdict is what the other
      // evidence says, held at CANNOT VERIFY only when that would be REAL. A
      // ruling of "false" can therefore never make a verdict less false. It
      // used to return CANNOT VERIFY outright, so adding a fact-checker's
      // "false" to a claim the encyclopedia already contradicted turned FAKE
      // into CANNOT VERIFY (found by the decision explainer, and 84 such cases
      // by test/verdictMonotonicity.test.js).
      const withoutRuling = decideVerdict({ ...ledger, factCheckStatus: 'none', factChecks: [] });
      if (withoutRuling.call !== 'REAL' && withoutRuling.call !== 'CANNOT VERIFY') {
        return { ...withoutRuling, grounds: [...withoutRuling.grounds, ...ledger.factChecks.slice(0, 2).map(describeReview)] };
      }
      return decide('unverified', 'fact-checkers-and-reporting-disagree', [
        ...ledger.factChecks.slice(0, 2).map(describeReview),
        `But ${ledger.independentSupport} independent outlets now report it as fact. A ruling can be overtaken by events, so this is left for the reader to weigh.`
      ], 'Fact-checkers and current reporting disagree on this. Read both before sharing.');
    }
    const against = ledger.factChecks.filter(m => m.finding !== 'true');
    const reasons = against.slice(0, 4).map(describeReview);
    if (against.length > 4) reasons.push(`${against.length - 4} more ${against.length - 4 === 1 ? 'desk reached' : 'desks reached'} the same finding.`);
    if (ledger.independentContradiction > 0) {
      reasons.push(`Separately, ${ledger.independentContradiction} independent news ${ledger.independentContradiction === 1 ? 'outlet reports' : 'outlets report'} facts that conflict with it.`);
    }
    return ledger.factCheckStatus === 'debunked'
      ? decide('false', 'rated-false-by-fact-checkers', reasons,
        'Professional fact-checkers have investigated this and found it false. Do not share it.')
      : decide('likely-false', 'rated-misleading-by-fact-checkers', reasons,
        'Fact-checkers found this misleading: it twists or strips the context from something real. Do not share it as stated.');
  }

  // R0c — Several claims, and the evidence splits between them: one confirmed
  // by independent outlets, another contradicted. Neither "true" nor "false"
  // describes the message, and calling it true would be the harmful error.
  // A message whose title is contradicted is false, whatever its body
  // confirms: the title is what it asserts, and true details under a false
  // title are how such forwards are made believable. "Punjab Anti-Drug
  // Activist Saved: Following the killing of ..." came back PARTLY FALSE.
  const falseTitle = ledger.contradictedClaims.find(c => c.fromTitle);
  if (falseTitle) {
    return decide('false', 'title-contradicted', [
      `The message's title says: ${falseTitle.claim}`,
      falseTitle.reported ? `Independent outlets report: "${falseTitle.reported}".` : 'Independent outlets report otherwise.',
      ...ledger.confirmedClaims.slice(0, 2).map(c => `The details beneath it are confirmed: ${c}`)
    ], 'The headline of this message is false. Do not share it.');
  }

  if (ledger.confirmedClaims.length > 0 && ledger.contradictedClaims.length > 0) {
    return decide('mixed', 'claims-partly-false', [
      ...ledger.confirmedClaims.slice(0, 2).map(c => `Confirmed by independent outlets: ${c}`),
      ...ledger.contradictedClaims.slice(0, 2).map(c => `Contradicted by independent outlets: ${c.claim}${c.reported ? ` They report: "${c.reported}".` : ''}`)
    ]);
  }

  // R0d — Part of the message is confirmed, but it rests on a premise a
  // reference work contradicts. Partly false, like R0c. It used to fall to
  // R2b and come out FAKE, while the same message with a second claim also
  // contradicted came out PARTLY FALSE by R0c: more evidence against made the
  // verdict milder (257 of 20,000 random ledgers in
  // eval/counterfactualFaithfulness.js). The confirmed part is real and the
  // premise is probably not; neither "true" nor "false" describes the message.
  if (ledger.confirmedClaims.length > 0 && ledger.premiseContradictions.length > 0) {
    const first = ledger.premiseContradictions[0];
    return decide('mixed', 'confirmed-claim-on-a-false-premise', [
      ...ledger.confirmedClaims.slice(0, 2).map(c => `Confirmed by independent outlets: ${c}`),
      `But the message states: ${first.articleStates}`,
      `A reference entry on ${first.entity} says otherwise: "${first.referenceStates}"`
    ], 'Part of this is confirmed, but it rests on something a reference work contradicts. Do not share it as stated.');
  }

  // R1 — Contradicted by two or more independent sources. This is the only
  // route to a flat "False": one outlet disagreeing can be the outlet that is
  // wrong, two independent ones rarely are.
  if (ledger.independentContradiction >= 2) {
    return decide('false', 'contradicted-by-multiple-independent-sources', [
      `${ledger.independentContradiction} independent sources report facts that conflict with this article's central claim.`
    ]);
  }

  // R2 — One independent contradiction: strong evidence against, short of proof.
  if (ledger.independentContradiction === 1) {
    return decide('likely-false', 'contradicted-by-one-independent-source', [
      'An independent outlet reports facts that conflict with this article.',
      'One contradiction is not conclusive, so this is stated as likely rather than certain.'
    ]);
  }

  // R2b — A reference work contradicts something the article states about a
  // named subject. This catches what the news channel structurally cannot: an
  // article built on a false premise describes an event nobody reports, so the
  // news search correctly finds nothing and the real finding — that the premise
  // is wrong — would otherwise be missed entirely.
  //
  // Stated as "probably false" rather than "false". The encyclopedia entry may
  // be out of date, or may be about a different person of the same name, and
  // neither is visible from here. It is strong evidence, not proof.
  //
  // Only when the news search ran. The rule's reasoning is that nobody reports
  // an event built on a false premise; when the search could not run, that
  // silence was never observed, and a model's reading of an encyclopedia entry
  // is all that is left. Measured on 13 Oct, with the search failing and the
  // reading done by fallback models, it called three true claims FAKE: "Nana
  // Patekar died in Goa" against an entry that gives his death date.
  if (ledger.premiseContradictions.length > 0 && !ledger.searchFailed) {
    const first = ledger.premiseContradictions[0];
    return decide('likely-false', 'premise-contradicted-by-reference', [
      `This article states: ${first.articleStates}`,
      `A reference entry on ${first.entity} says otherwise: "${first.referenceStates}"`,
      'A story built on a premise that is wrong does not become true because no one has reported it.'
    ]);
  }

  // R2d — A claim this week's news rules out stands against the message,
  // whatever confirms the claim beside it. R4c, below, used to be the only
  // rule that looked at it, and only while news outlets confirmed the other
  // claim: a fact-checker's "true" (R2c) or a reference entry (R6a) could
  // make the message REAL first, lending the ruled-out claim the true one's
  // credit, and fresh contradiction that evened the other claim out made the
  // verdict milder (eval/counterfactualFaithfulness.js). Partly false while
  // anything confirms the other claim; probably false once nothing does.
  // An unreported claim (nothing rules it out either) keeps the message at
  // "only partly confirmed" by the same token: a fact-checker's "true" for
  // the other claim used to make the whole message REAL, until outlets also
  // confirmed it and R4c took over — more evidence for, a milder verdict.
  const u = ledger.unconfirmedClaim;
  const otherConfirmed = Boolean(u) && (ledger.independentSupport > 0
    || (ledger.factCheckStatus === 'confirmed' && ledger.factChecks.length > 0)
    || (ledger.referenceCanConfirm && ledger.premiseConfirmations.length > 0));
  if (u && u.outcome === 'unreported' && otherConfirmed) {
    return decide('unverified', 'only-partly-confirmed', [
      `Confirmed: ${u.confirmedClaim}`,
      `Not reported by any outlet found: ${u.claim}`,
      'The confirmed part does not vouch for the rest of the message.'
    ], 'Part of this is confirmed and part is not. Share only what is confirmed.');
  }
  if (u && u.outcome !== 'unreported') {
    if (otherConfirmed) {
      return decide('mixed', 'true-claim-carrying-a-false-one', [
        `Confirmed: ${u.confirmedClaim}`,
        u.outcome === 'presupposedFalse'
          ? `Not reported anywhere, and this week's news rules it out: ${u.claim}`
          : `Not reported anywhere: ${u.claim} — though ${u.outletsRead} outlets covered ${u.subject} this week.`,
        ...(u.evidence || []).map(h => `${h.source}: "${h.title}"`)
      ], 'A true claim is being used to carry a false one. Do not share this message.');
    }
    return decide('likely-false', 'claim-ruled-out-by-current-coverage', [
      u.outcome === 'presupposedFalse'
        ? `This week's news rules it out: ${u.claim}`
        : `Not reported anywhere: ${u.claim} — though ${u.outletsRead} outlets covered ${u.subject} this week.`,
      ...(u.evidence || []).map(h => `${h.source}: "${h.title}"`),
      'Nothing independent confirms the rest of the message either.'
    ]);
  }

  // R2c — A fact-checking desk rated this same claim true, and no outlet
  // contradicts it. Short of two independent newsrooms (R5 still applies when
  // they exist), so stated as probably true.
  // Not against an encyclopedia entry that contradicts it: with the news search
  // failed (R2b stands aside), the two disagree and nothing settles it.
  if (ledger.factCheckStatus === 'confirmed' && ledger.factChecks.length > 0 && ledger.independentSupport < 2
    && !(ledger.searchFailed && ledger.premiseContradictions.length > 0)) {
    return decide('likely-true', 'rated-true-by-fact-checkers', [
      ...ledger.factChecks.slice(0, 3).map(describeReview),
      ledger.independentSupport === 1
        ? 'One independent outlet also reports the same facts.'
        : 'No news outlet was found reporting it, which is common for claims that circulate only on social media.'
    ], 'A fact-checking desk has examined this and found it true.');
  }
  if (ledger.factCheckStatus === 'confirmed' && ledger.factChecks.length > 0) {
    grounds.push(...ledger.factChecks.slice(0, 2).map(describeReview));
  }

  // R3 — The verification check itself could not run. This must never be read
  // as "nothing to verify": an unrun check is an absence of knowledge, and the
  // report says so rather than quietly reclassifying the article as commentary.
  if (!ledger.verificationRan) {
    // R3a — The story is newer than anything the index we search carries, so
    // its silence is not a finding.
    //
    // Measured: a BBC report of five terrorism arrests near RAF Fairford, two
    // hours old and carried by every outlet in the country, drew no
    // corroboration at all, because the index serves nothing published in the
    // last day. The rules below then read that absence as evidence and said
    // "No other outlet is reporting this — and a story this big would normally
    // be everywhere", at three per cent. Every word of that was wrong, and it
    // is the most damaging thing this system can say about a true story.
    //
    // This sits below R5 and R6: corroboration that WAS found still counts,
    // and only a search that could not have succeeded abstains.
    if (ledger.tooRecentToCorroborate) {
      return decide('unverified', 'too-recent-to-corroborate', [
        `This story is ${describeAge(ledger.articleAgeHours)} old, and the news index we search runs about ${Math.round(ledger.indexLagHours)} hours behind live.`,
        'Nothing was found reporting it elsewhere, but that is the limit of what we can see rather than evidence about the story.',
        'The writing checks below still ran. Checking again tomorrow will give a real answer.'
      ], 'Published too recently for us to check it against other outlets yet.');
    }
    return decide('unverified', 'verification-unavailable', [
      'We could not search other outlets just now, so nothing about this story has been confirmed either way.',
      'The writing checks below still ran, but how an article is written says nothing about whether it happened.'
    ], 'We could not complete the check. Treat this as unconfirmed rather than as either true or false.');
  }

  // R4 — Nothing checkable was asserted. Commentary is not false; it is simply
  // outside what verification can speak to.
  //
  // The exception matters. "Commentary" carries the highest ceiling available
  // to an uncorroborated article, and making unfalsifiable claims is the normal
  // working method of a publisher with a poor factual record — so without this
  // guard, being too vague to check becomes a way of scoring better. A known
  // conspiracy outlet writing untestable assertions is not a columnist.
  if (ledger.checkableClaimCount === 0) {
    if (ledger.sourceIsConspiracy || (ledger.sourceKnown && ledger.sourceReliability <= 3)) {
      return decide('unverified', 'no-checkable-claims-poor-record-publisher', [
        'The article makes no claim specific enough for another outlet to confirm or deny.',
        'Its publisher has a poor factual-reporting record, so this is treated as unverifiable rather than as commentary — being too vague to check is not a mark in an article’s favour.'
      ]);
    }
    return decide('opinion', 'no-checkable-claims', [
      'The article makes no specific factual claim that another outlet could confirm or deny.',
      'It is argument or analysis, so there is nothing here to verify.'
    ]);
  }

  // A copy of a true story on an impersonating site is still a true story, so
  // corroboration below stands — but the reader is told this page is not the
  // outlet it claims to be, since that is what they will want to share.
  if (ledger.impersonates && ledger.independentSupport >= 1) {
    grounds.push(`This page presents itself as ${ledger.impersonates} but is not published on any address ${ledger.impersonates} uses. The events are confirmed elsewhere; this copy of them is not from ${ledger.impersonates}.`);
  }

  // R4b — The event is real, but it is not news: the message presents it as
  // happening now, and the reports confirming it are weeks or years old.
  if (ledger.staleClaims.length > 0 && ledger.independentSupport === 0 && ledger.independentContradiction === 0) {
    const first = ledger.staleClaims[0];
    const when = first.newestSupport ? first.newestSupport.slice(0, 10) : 'long ago';
    return decide('outdated', 'old-news-presented-as-new', [
      `Outlets did report this — but the most recent report found is from ${when}.`,
      'The message presents it as happening now. Old news shared as new is one of the commonest forms of misinformation.'
    ]);
  }

  // R4c — A confirmed claim carrying an unreported one. The confirmation is
  // real, but it is for part of the message only, and the message is what
  // gets shared. If this week's coverage of the unreported claim's subject
  // rules it out, or never mentions an event that would have dominated it,
  // the message is partly false; otherwise it is only partly confirmed.
  // Never plain REAL: that would lend the added claim the true one's credit.
  if (ledger.unconfirmedClaim && ledger.independentSupport > 0 && ledger.independentContradiction === 0) {
    const u = ledger.unconfirmedClaim;
    if (u.outcome !== 'unreported') {
      return decide('mixed', 'true-claim-carrying-a-false-one', [
        `Confirmed by independent outlets: ${u.confirmedClaim}`,
        u.outcome === 'presupposedFalse'
          ? `Not reported anywhere, and this week's news rules it out: ${u.claim}`
          : `Not reported anywhere: ${u.claim} — though ${u.outletsRead} outlets covered ${u.subject} this week.`,
        ...u.evidence.map(h => `${h.source}: "${h.title}"`)
      ], 'A true claim is being used to carry a false one. Do not share this message.');
    }
    return decide('unverified', 'only-partly-confirmed', [
      `Confirmed by independent outlets: ${u.confirmedClaim}`,
      `Not reported by any outlet found: ${u.claim}`,
      'The confirmed part does not vouch for the rest of the message.'
    ], 'Part of this is confirmed and part is not. Share only what is confirmed.');
  }

  // R5 — Corroborated by two or more independent sources.
  if (ledger.independentSupport >= 2) {
    grounds.push(`${ledger.independentSupport} independent sources report the same facts.`);
    if (ledger.rawSupportingArticles > ledger.independentSupport) {
      grounds.push(`${ledger.rawSupportingArticles} articles were retrieved, but only ${ledger.independentSupport} represent genuinely separate sources — the rest share an owner or run the same agency copy.`);
    }
    if (ledger.stateOnlySupport) {
      // Two state outlets from one state are one source; analyseIndependence
      // already merges those, so this is a different case: corroboration that
      // is entirely state-controlled, which the reader should be told.
      grounds.push('All corroboration comes from state-controlled media.');
      return decide('likely-true', 'corroborated-state-media-only', grounds);
    }
    return decide('corroborated', 'corroborated-by-multiple-independent-sources', grounds);
  }

  // R6 — A single independent source.
  if (ledger.independentSupport === 1) {
    grounds.push('One independent source reports the same facts.');
    if (!ledger.hasHighQualitySource) {
      grounds.push('That source does not have a strong factual-reporting record, so the confirmation is weak.');
    }
    return decide('likely-true', 'corroborated-by-one-independent-source', grounds);
  }

  // R6a — A standing or past fact, which no newsroom reports this week
  // because it is not news, and which a reference entry states. "Bengaluru is
  // the capital of Karnataka" has no corroborating coverage and needs none.
  if (ledger.independentSupport === 0 && ledger.independentContradiction === 0
    && ledger.referenceCanConfirm && ledger.premiseConfirmations.length > 0) {
    const first = ledger.premiseConfirmations[0];
    return decide('likely-true', 'confirmed-by-reference', [
      `A reference entry on ${first.entity} states it: "${first.referenceStates}"`,
      'This is a standing fact rather than news, so a reference work, not a newsroom, is the right witness.'
    ], 'A reference work confirms this standing fact.');
  }

  // R6b — The news search found nothing about the event, but this week's
  // coverage of its subject carries on in a way that could not be true if the
  // event had happened: "PM Modi launches projects in Chennai" on the day he
  // supposedly resigned. Each such headline is quoted and dated, and two
  // independent outlets are required, as for any contradiction.
  //
  // Probably false rather than false: the contradiction is inferred from what
  // a headline takes for granted, not stated by it.
  if (ledger.currentCoverageOutcome === 'presupposedFalse') {
    const shown = ledger.presupposingFalse.slice(0, 3)
      .map(h => `${h.source}${h.publishedAt ? ` (${h.publishedAt.slice(0, 10)})` : ''}: "${h.title}"`);
    return decide('likely-false', 'contradicted-by-current-coverage', [
      'No outlet reports this event.',
      `Meanwhile ${ledger.presupposedAgainst} independent outlets report things this week that could not be happening if it were true:`,
      ...shown,
      'A real event of this kind would have changed that coverage; it has not.'
    ], 'Current reporting about this subject is incompatible with the claim. Treat it as false.');
  }

  // R6c — The weaker form: an event that would have dominated a week's
  // coverage of a subject covered every day, and a week of that coverage does
  // not mention it. Tightly guarded — the event must be one that would have
  // been the biggest story about its subject, claimed within the window read,
  // and the subject must have drawn at least twelve headlines from five
  // outlets — because an ordinary event going unmentioned means nothing.
  if (ledger.currentCoverageOutcome === 'absentFromHeavyCoverage') {
    return decide('likely-false', 'absent-from-heavy-coverage', [
      'No outlet reports this event.',
      `${ledger.currentCoverageRead.outlets} outlets published ${ledger.currentCoverageRead.headlines} headlines about ${ledger.currentCoverageSubject} this week, and none mentions it.`,
      'Had it happened, it would have been the biggest story about this subject. Its absence from all of them is strong evidence it did not.'
    ], 'A story this big would be everywhere. It is nowhere, so treat it as false unless an outlet confirms it.');
  }

  // R7 — Nothing corroborates it, and the article carries the marks of
  // engineered content. Stated as likely false rather than merely unverified:
  // a consequential event that no other outlet reports, published by an outlet
  // with no record and written to persuade, is not a neutral situation.
  const risk = [];
  if (ledger.highImpact) risk.push('the claim is consequential enough that other outlets would be expected to report it');
  // Impersonation replaces "no record" rather than adding to it: the page has
  // no record because it is not who it claims to be, and counting both would
  // count one fact twice.
  if (ledger.impersonates) risk.push(`the page presents itself as ${ledger.impersonates} but is not published on any address ${ledger.impersonates} uses`);
  else if (!ledger.sourceKnown) risk.push('the publisher has no reliability record');
  if (ledger.sourceIsConspiracy || ledger.sourceReliability <= 3) risk.push('the publisher has a poor factual-reporting record');
  // Young only ever counts against: an old domain can be bought, a young one
  // cannot have built a record. See utils/domainAge.js.
  if (ledger.domainAge && ledger.domainAge.young) risk.push(`the site's domain was registered only ${ledger.domainAge.ageDays} days ago`);
  if (ledger.persuasionTechniqueCount >= 2) risk.push(`the article uses ${ledger.persuasionTechniqueCount} persuasion techniques on the reader`);
  if (ledger.transparencyScore > 0 && ledger.transparencyScore < 4) risk.push('its claims cannot be traced to any nameable source');

  if (ledger.highImpact && risk.length >= 3) {
    return decide('likely-false', 'uncorroborated-high-impact-with-risk-signals', [
      'No independent outlet reports this story.',
      `It also shows ${risk.length} warning signs: ${risk.join('; ')}.`,
      'Taken together, that pattern is more consistent with a fabricated story than with an unreported true one.'
    ]);
  }

  // R8 — The honest default. We looked and found nothing either way.
  const reasons = ['No independent outlet was found reporting these claims.'];
  if (ledger.highImpact) {
    reasons.push('For a story of this significance, an absence of other coverage is itself a warning sign.');
  }
  reasons.push('This is not a finding that the story is false. It means nothing independent supports it yet.');
  if (risk.length) reasons.push(`Also noted: ${risk.join('; ')}.`);
  return applyProvenanceRelief(decide('unverified', 'no-independent-coverage', reasons), ledger);
};

/**
 * A genuine exclusive by an established newsroom is not the same object as an
 * anonymous site's uncorroborated claim, though both are "unverified". Without
 * this adjustment the system would rate a Reuters scoop that no one has matched
 * yet at the same ceiling as a fabricated story, which is wrong and would be the
 * first thing an examiner attacked.
 *
 * The relief is deliberately narrow: it requires an outlet we hold a strong
 * factual-reporting record for, and it still cannot reach "looks trustworthy"
 * (>=7.5), because the claim remains unconfirmed.
 */
const PROVENANCE_RELIEF_THRESHOLD = 8.5;

const applyProvenanceRelief = (decision, ledger) => {
  if (decision.verdict !== 'unverified') return decision;
  if (!ledger.sourceKnown || ledger.sourceReliability < PROVENANCE_RELIEF_THRESHOLD) return decision;

  return {
    ...decision,
    ceiling: VERDICT_CLASSES.opinion.ceiling,
    rule: 'no-independent-coverage-established-publisher',
    grounds: [
      ...decision.grounds,
      `Reported by an outlet with a strong factual record (${ledger.sourceReliability}/10), so this is treated as an exclusive that others have not yet matched rather than as an unsourced claim. It still cannot be called confirmed.`
    ]
  };
};

/**
 * The whole reason, in one sentence.
 *
 * Not a summary of the analysis — the single fact that decided it. If the
 * reader takes away one line, this is the line, so it names the evidence rather
 * than describing the process.
 */
const summarise = (verdict, ledger, rule = '') => {
  const sources = (n) => `${n} independent ${n === 1 ? 'outlet' : 'outlets'}`;
  // "India Today, AFP Fact Check and PTI" — the desks by name, since a reader
  // can look a named desk up and cannot look up "fact-checkers".
  const desks = (list) => {
    const names = [...new Set(list.map(m => m.publisher || m.site).filter(Boolean))];
    if (names.length === 0) return 'a fact-checking desk';
    const shown = names.slice(0, 3);
    const rest = names.length - shown.length;
    if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
    return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  };
  // The conflicting fact as the outlets worded it, when the judge quoted one.
  // The fullest one wins: "TVK sweeps both seats" says more than "TVK rises".
  const quote = (ledger.reportedAgainst || []).filter(q => q.length <= 80).sort((x, y) => y.length - x.length)[0];

  if (rule === 'rated-false-by-fact-checkers') {
    return `Rated false by ${desks(ledger.factChecks.filter(m => m.finding === 'false'))} after checking this exact claim.`;
  }
  if (rule === 'rated-misleading-by-fact-checkers') {
    return `Fact-checkers (${desks(ledger.factChecks.filter(m => m.finding !== 'true'))}) found this misleading.`;
  }
  if (rule === 'page-is-a-published-fact-check') {
    const own = ledger.pageRuling;
    const desk = (own && (own.publisher || own.site)) || ledger.pageDesk || 'a fact-checking desk';
    if (own) {
      const rating = own.rating && own.rating.length <= 40 ? own.rating : own.finding;
      // Desks quote the rumour with its own quotation marks; cut at a word.
      const reviewed = String(own.claimReviewed || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
      const shortened = reviewed.length > 110 ? `${reviewed.slice(0, 110).replace(/\s+\S*$/, '')}…` : reviewed;
      const rates = shortened ? ` It rates the claim “${shortened}” ${rating}.` : '';
      return `A genuine fact-check by ${desk}, found in the fact-checking record at this address.${rates}`;
    }
    const ex = (ledger.contradictedClaims || []).find(c => !denies(c.claim));
    const others = ledger.pageDenies ? ledger.factChecks.filter(m => m.finding !== 'true') : [];
    if (!ex && others.length > 0) return `A fact-check by ${desk}, and ${desks(others)} reached the same finding on the claim it examines.`;
    return ex
      ? `A fact-check by ${desk}, and independent outlets agree with it: the claim it examines, “${ex.claim.replace(/\.$/, '')}”, is reported otherwise.`
      : `A fact-check by ${desk}, and the reference record agrees with its finding.`;
  }
  if (rule === 'rated-true-by-fact-checkers') {
    return `Checked and rated true by ${desks(ledger.factChecks)}.`;
  }
  if (rule === 'true-claim-carrying-a-false-one') {
    const u = ledger.unconfirmedClaim;
    return `Partly false: “${u.confirmedClaim.replace(/\.$/, '')}” is confirmed, but “${u.claim.replace(/\.$/, '')}” appears nowhere in this week's news.`;
  }
  if (rule === 'only-partly-confirmed') {
    const u = ledger.unconfirmedClaim;
    return `Only partly confirmed: “${u.confirmedClaim.replace(/\.$/, '')}” is reported, but nothing supports “${u.claim.replace(/\.$/, '')}”.`;
  }
  if (rule === 'title-contradicted') {
    const t = (ledger.contradictedClaims || []).find(c => c.fromTitle);
    return t && t.reported
      ? `False: the title says “${t.claim.replace(/\.$/, '')}”, but outlets report “${t.reported}”.`
      : 'False: the title of this message is contradicted by independent reporting.';
  }
  if (rule === 'claims-partly-false') {
    const wrong = (ledger.contradictedClaims || [])[0];
    return wrong?.reported
      ? `Partly false: some of this is confirmed, but on “${wrong.claim.replace(/\.$/, '')}” outlets report “${wrong.reported}”.`
      : 'Partly false: some of this is confirmed by independent outlets and some is contradicted.';
  }
  if (rule === 'claim-ruled-out-by-current-coverage') {
    const u = ledger.unconfirmedClaim;
    return u ? `Probably false: this week's coverage of ${u.subject} rules out “${u.claim.replace(/\.$/, '')}”, and nothing confirms the rest.`
      : 'Probably false: this week\'s coverage rules out part of it, and nothing confirms the rest.';
  }
  if (rule === 'confirmed-claim-on-a-false-premise') {
    const first = (ledger.premiseContradictions || [])[0];
    return first
      ? `Partly false: some of this is confirmed, but a reference entry on ${first.entity} contradicts what it takes for granted.`
      : 'Partly false: some of this is confirmed, but it rests on a premise a reference work contradicts.';
  }
  if (rule === 'old-news-presented-as-new') {
    const first = (ledger.staleClaims || [])[0];
    return `This is old news: the latest report of it found is from ${first?.newestSupport ? first.newestSupport.slice(0, 10) : 'long ago'}, not now.`;
  }
  if (rule === 'confirmed-by-reference') {
    const first = (ledger.premiseConfirmations || [])[0];
    const says = String(first?.referenceStates || '');
    return `The encyclopedia entry on ${first?.entity} confirms it: “${says.length > 140 ? `${says.slice(0, 137)}…` : says}”`;
  }
  if (rule === 'contradicted-by-current-coverage') {
    // Quote the newest headline, and one that names no earlier year: "MS Dhoni
    // passed away" was answered with "MS Dhoni Auction Price & Team - IPL 2025",
    // a page that reads as old news even when it was this week's.
    const list = ledger.presupposingFalse || [];
    const at = (x) => Date.parse(x.publishedAt) || 0;
    const ref = new Date(Math.max(0, ...list.map(at))).getUTCFullYear();
    const dated = (x) => ((`${x.title || ''} ${x.reported || ''}`).match(/\b(?:19|20)\d{2}\b/g) || []).some(y => Number(y) < ref);
    const h = [...list].sort((a, b) => (dated(a) - dated(b)) || (at(b) - at(a)))[0];
    // The short quote must be the outlet's own words: a model shortening a
    // headline once turned "IPL 2025" into "IPL 2026". When it is not in the
    // headline, the headline itself is quoted.
    const squash = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const quote = h && h.title && !squash(h.title).includes(squash(h.reported)) ? h.title : h && h.reported;
    return h
      ? `No outlet reports this, and this week's news says otherwise: “${quote}” (${h.source}).`
      : 'No outlet reports this, and this week\'s news about the subject says otherwise.';
  }
  if (rule === 'absent-from-heavy-coverage') {
    return `${ledger.currentCoverageRead.outlets} outlets covered ${ledger.currentCoverageSubject} this week, and none reports this.`;
  }
  if (rule === 'fact-checkers-and-reporting-disagree') {
    return `Fact-checkers rated this false, but ${sources(ledger.independentSupport)} now report it.`;
  }

  switch (verdict) {
    case 'false':
      return quote
        ? `${sources(ledger.independentContradiction)} report otherwise: “${quote}”.`
        : `${sources(ledger.independentContradiction)} report the opposite of what this says.`;
    case 'likely-false':
      if (ledger.premiseContradictions?.length > 0) {
        const premise = ledger.premiseContradictions[0];
        const says = String(premise.referenceStates || '').trim();
        const source = premise.reference?.title ? `The encyclopedia entry “${premise.reference.title}”` : `The encyclopedia entry on ${premise.entity}`;
        return says
          ? `${source} says otherwise: “${says.length > 140 ? `${says.slice(0, 137)}…` : says}”`
          : `${source} contradicts what this says.`;
      }
      if (ledger.independentContradiction > 0) {
        return quote
          ? `An independent outlet reports otherwise: “${quote}”.`
          : 'An independent outlet reports the opposite of what this says.';
      }
      return 'No outlet is reporting this, and it carries several marks of a fabricated story.';
    case 'corroborated':
      return `Confirmed by ${sources(ledger.independentSupport)} reporting the same facts.`;
    case 'likely-true':
      return ledger.stateOnlySupport
        ? 'Reported elsewhere, but only by state-controlled media.'
        : 'One independent outlet reports the same facts.';
    case 'satire':
      return 'This comes from a satirical publication, so it was never meant as news.';
    case 'opinion':
      return 'This argues a position rather than reporting events, so there is nothing to check.';
    case 'unverified':
    default:
      // The search did run for a too-recent story; it simply could not have
      // found anything. Saying it failed would be a different untruth.
      if (ledger.tooRecentToCorroborate) return 'Too recent to check against other outlets yet — our news index runs about a day behind.';
      if (!ledger.verificationRan) return 'We could not complete the search, so nothing has been checked.';
      return ledger.highImpact
        ? 'No other outlet is reporting this — and a story this big would normally be everywhere.'
        : 'No other outlet is reporting this, so nothing supports it either way.';
  }
};

/**
 * Confidence in the verdict, on 0-1.
 *
 * Derived only from how much independent evidence exists and how good it is —
 * never from the language model's own certainty, which is not measurable. The
 * value is deliberately capped below 1: the system does not claim certainty.
 */
const confidenceFor = (verdict, ledger, rule = '') => {
  const cap = (value) => Math.max(0.3, Math.min(0.95, Math.round(value * 100) / 100));
  // A desk's investigation of the very claim is worth more than a headline
  // count, and each further desk reaching the same finding adds to it.
  if (rule === 'rated-false-by-fact-checkers' || rule === 'rated-misleading-by-fact-checkers') {
    const desks = ledger.factChecks.filter(m => m.finding !== 'true').length;
    const base = rule === 'rated-false-by-fact-checkers' ? 0.82 : 0.68;
    return cap(base + 0.04 * Math.min(desks - 1, 3) + (ledger.independentContradiction > 0 ? 0.03 : 0));
  }
  if (rule === 'page-is-a-published-fact-check') return cap(0.82);
  if (rule === 'rated-true-by-fact-checkers') return cap(0.65 + 0.05 * Math.min(ledger.factChecks.length - 1, 2));
  if (rule === 'contradicted-by-current-coverage') return cap(0.62 + 0.05 * Math.min(ledger.presupposedAgainst - 2, 3));
  if (rule === 'claims-partly-false') return cap(0.75);
  if (rule === 'title-contradicted') return cap(0.8);
  if (rule === 'true-claim-carrying-a-false-one') return cap(0.65);
  if (rule === 'confirmed-claim-on-a-false-premise') return cap(0.65);
  if (rule === 'claim-ruled-out-by-current-coverage') return cap(0.6);
  if (rule === 'only-partly-confirmed') return cap(0.5);
  if (rule === 'old-news-presented-as-new') return cap(0.7);
  if (rule === 'confirmed-by-reference') return cap(0.7);
  if (rule === 'absent-from-heavy-coverage') return cap(0.58);
  switch (verdict) {
    case 'false':
      return cap(0.7 + 0.07 * Math.min(ledger.independentContradiction - 2, 3));
    case 'likely-false':
      return cap(ledger.independentContradiction === 1 ? 0.62 : 0.55);
    case 'corroborated': {
      const base = 0.7 + 0.06 * Math.min(ledger.independentSupport - 2, 3);
      return cap(ledger.hasHighQualitySource ? base + 0.08 : base);
    }
    case 'likely-true':
      return cap(ledger.hasHighQualitySource ? 0.6 : 0.5);
    case 'satire':
      return cap(0.9);
    case 'opinion':
      return cap(0.65);
    case 'unverified':
    default:
      // Confidence that the situation is "unestablished", which searching
      // harder could change at any time.
      return cap(0.5);
  }
};

/**
 * Apply the evidence ceiling to a presentation score.
 * @param {number} presentationScore - weighted score of the content factors, 0-10
 * @param {Object} verdict - from decideVerdict
 * @returns {{score: number, capped: boolean, ceilingReason: string|null}}
 */
const applyCeiling = (presentationScore, verdict) => {
  const score = Math.round(Math.min(presentationScore, verdict.ceiling) * 10) / 10;
  const capped = presentationScore > verdict.ceiling + 0.05;
  return {
    score,
    capped,
    ceilingReason: capped
      ? `The article reads well (${presentationScore.toFixed(1)}/10 on presentation), but presentation is not evidence. Verdict "${verdict.label}" limits the trust score to ${verdict.ceiling}.`
      : null
  };
};


// ---------------------------------------------------------------------------
// The verdict as a record.
//
// buildEvidenceLedger and decideVerdict are pure functions of their inputs and
// asOf, so a verdict can be stored as the inputs that produced it and replayed
// later to the identical result. compactLedgerInput keeps exactly the fields
// the ledger reads — the evidence items, the channel results, the four facts
// it uses about the publisher and the writing — and drops the rest, so the
// record is small and contains nothing the verdict did not depend on.
// ---------------------------------------------------------------------------
const pickEvidence = (e) => ({
  source: e.source, title: e.title, description: e.description || '', url: e.url,
  publishedAt: e.publishedAt || null, reported: e.reported || '', reliability: e.reliability
});

const compactLedgerInput = (input) => ({
  claims: (input.claims || []).map(c => ({
    claim: c.claim, verdict: c.verdict, time: c.time || null, kind: c.kind || null, fromTitle: Boolean(c.fromTitle),
    supportingEvidence: (c.supportingEvidence || []).map(pickEvidence),
    contradictingEvidence: (c.contradictingEvidence || []).map(pickEvidence)
  })),
  verificationStatus: input.verificationStatus,
  premiseResult: input.premiseResult ? {
    status: input.premiseResult.status,
    contradictions: input.premiseResult.contradictions || [],
    confirmations: input.premiseResult.confirmations || []
  } : null,
  factCheckResult: input.factCheckResult ? {
    status: input.factCheckResult.status, matches: input.factCheckResult.matches || []
  } : null,
  currentCoverageResult: input.currentCoverageResult ? {
    status: input.currentCoverageResult.status, subject: input.currentCoverageResult.subject || null,
    headlinesRead: input.currentCoverageResult.headlinesRead || 0, outletsRead: input.currentCoverageResult.outletsRead || 0,
    presupposingFalse: input.currentCoverageResult.presupposingFalse || []
  } : null,
  unconfirmedClaimResult: input.unconfirmedClaimResult || null,
  sourceResult: {
    matched: Boolean(input.sourceResult?.matched), score: input.sourceResult?.score ?? null,
    impersonates: input.sourceResult?.impersonates || null, type: input.sourceResult?.type || null
  },
  transparencyResult: { score: input.transparencyResult?.score ?? null },
  manipulationResult: { techniques: (input.manipulationResult?.techniques || []).map(t => ({ technique: t.technique || t })) },
  title: input.title || '',
  publishedAt: input.publishedAt || null,
  pageUrl: input.pageUrl || null,
  pageDesk: input.pageDesk || null,
  indexLagHours: input.indexLagHours ?? INDEX_LAG_HOURS,
  domainAge: input.domainAge || null,
  asOf: input.asOf ?? Date.now()
});

/** Re-reach a stored verdict from its recorded inputs. */
const replayVerdict = (ledgerInput) => decideVerdict(buildEvidenceLedger(ledgerInput));

module.exports = {
  buildEvidenceLedger,
  decideVerdict,
  applyCeiling,
  VERDICT_CLASSES,
  looksHighImpact,
  compactLedgerInput,
  replayVerdict
};
