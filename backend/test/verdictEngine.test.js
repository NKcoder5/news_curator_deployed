const test = require('node:test');
const assert = require('node:assert');
const { buildEvidenceLedger, decideVerdict, applyCeiling } = require('../agents/verdictEngine');

const evidence = (source, title, reliability = 8) => ({ source, title, description: '', url: `https://${source}.test/x`, reliability });

const ledgerFor = (overrides = {}) => buildEvidenceLedger({
  claims: [],
  sourceResult: { matched: true, score: 7, type: 'newspaper' },
  transparencyResult: { score: 7 },
  manipulationResult: { techniques: [] },
  title: 'Council approves new cycle lane',
  ...overrides
});

test('two independent outlets reporting the same claim yields Corroborated', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The council approved the cycle lane.',
      verdict: 'supported',
      supportingEvidence: [evidence('BBC News', 'Council approves cycle lane', 9), evidence('The Guardian', 'Cycle lane gets green light', 8.5)],
      contradictingEvidence: []
    }]
  });
  assert.strictEqual(ledger.independentSupport, 2);
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'corroborated');
  assert.strictEqual(decision.ceiling, 10);
});

test('eight articles that are really one wire story do not corroborate', () => {
  const wire = (source) => ({
    source,
    title: 'LONDON (Reuters) - Central bank holds rates steady',
    description: '',
    url: `https://${source}.test/x`,
    reliability: 8
  });
  const ledger = ledgerFor({
    claims: [{
      claim: 'The central bank held rates steady.',
      verdict: 'supported',
      supportingEvidence: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(wire),
      contradictingEvidence: []
    }]
  });
  assert.strictEqual(ledger.rawSupportingArticles, 8);
  assert.strictEqual(ledger.independentSupport, 1, 'one agency story, however many reprints');
  assert.strictEqual(decideVerdict(ledger).verdict, 'likely-true');
});

test('one outlet read by our own model is not enough for Likely true', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The council approved the cycle lane.',
      verdict: 'supported',
      ownJudged: true,
      supportingEvidence: [evidence('BBC News', 'Council approves cycle lane', 9)],
      contradictingEvidence: []
    }]
  });
  assert.strictEqual(ledger.independentSupport, 1);
  assert.strictEqual(ledger.ownJudgedSupport, true);
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'unverified');
  assert.strictEqual(decision.rule, 'one-source-read-by-own-model');
});

test('one outlet read by the hosted model is still Likely true', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The council approved the cycle lane.',
      verdict: 'supported',
      supportingEvidence: [evidence('BBC News', 'Council approves cycle lane', 9)],
      contradictingEvidence: []
    }]
  });
  assert.strictEqual(ledger.ownJudgedSupport, false);
  assert.strictEqual(decideVerdict(ledger).verdict, 'likely-true');
});

test('two independent contradictions yield False', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The minister resigned yesterday.',
      verdict: 'contradicted',
      supportingEvidence: [],
      contradictingEvidence: [evidence('Reuters', 'Minister remains in post, says office', 9.5), evidence('BBC News', 'No resignation, ministry confirms', 9)]
    }]
  });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'false');
  assert.strictEqual(decision.ceiling, 2.0);
  assert.ok(decision.confidence >= 0.7);
});

test('a single contradiction is Likely false, not False', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The factory has closed.',
      verdict: 'contradicted',
      supportingEvidence: [],
      contradictingEvidence: [evidence('Reuters', 'Factory still operating, company says', 9.5)]
    }]
  });
  assert.strictEqual(decideVerdict(ledger).verdict, 'likely-false');
});

// The defect this whole layer exists to fix.
test('a well-written fabrication cannot score as trustworthy', () => {
  const ledger = buildEvidenceLedger({
    claims: [{ claim: 'A new drug cured 94% of patients in a secret trial.', verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    // Everything a fabricator controls is set to its best value:
    sourceResult: { matched: false, score: 5, type: 'unrated' },
    transparencyResult: { score: 9 },      // invented but plausible named sources
    manipulationResult: { techniques: [] },// calm, neutral prose
    title: 'New drug cured 94% of patients in secret trial'
  });
  const decision = decideVerdict(ledger);
  assert.ok(['unverified', 'likely-false'].includes(decision.verdict));

  // Presentation score of 9.0 — the article reads beautifully.
  const outcome = applyCeiling(9.0, decision);
  assert.ok(outcome.score <= 4.9, `expected a capped score, got ${outcome.score}`);
  assert.strictEqual(outcome.capped, true);
  assert.match(outcome.ceilingReason, /presentation is not evidence/);
});

test('an uncorroborated high-impact story with several warning signs is Likely false', () => {
  const ledger = buildEvidenceLedger({
    claims: [{ claim: 'Millions of people were secretly evacuated after a nuclear leak.', verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    sourceResult: { matched: false, score: 5, type: 'unrated' },
    transparencyResult: { score: 2 },
    manipulationResult: { techniques: [{ technique: 'appeal to fear' }, { technique: 'loaded language' }] },
    title: 'Secret nuclear leak: millions evacuated overnight'
  });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'likely-false');
  assert.strictEqual(decision.rule, 'uncorroborated-high-impact-with-risk-signals');
});

test('an established outlet with an exclusive is not treated as a fabrication', () => {
  const ledger = buildEvidenceLedger({
    claims: [{ claim: 'The regulator has opened an inquiry into the bank.', verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    sourceResult: { matched: true, score: 9.5, type: 'news agency' },
    transparencyResult: { score: 8 },
    manipulationResult: { techniques: [] },
    title: 'Regulator opens inquiry into bank'
  });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'unverified');
  assert.strictEqual(decision.rule, 'no-independent-coverage-established-publisher');
  assert.strictEqual(decision.ceiling, 6.4, 'a scoop is capped higher than an anonymous claim');
});

test('commentary is not judged as a false report', () => {
  const ledger = ledgerFor({ claims: [] });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'opinion');
  assert.strictEqual(applyCeiling(9.5, decision).score, 6.4);
});

// Being too vague to check must not be a route to a better outcome. Commentary
// carries the highest ceiling an uncorroborated article can reach, and writing
// unfalsifiable assertions is the standard method of a publisher with a poor
// record — so the two must not be confused.
test('a poor-record publisher making unfalsifiable claims is not "commentary"', () => {
  const ledger = ledgerFor({
    claims: [],
    sourceResult: { matched: true, score: 2, type: 'conspiracy' }
  });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'unverified');
  assert.strictEqual(decision.rule, 'no-checkable-claims-poor-record-publisher');
  assert.ok(decision.ceiling < 6.4, 'must not reach the commentary ceiling');
});

test('an ordinary outlet writing an opinion column still gets "commentary"', () => {
  const ledger = ledgerFor({ claims: [], sourceResult: { matched: true, score: 8, type: 'newspaper' } });
  assert.strictEqual(decideVerdict(ledger).verdict, 'opinion');
});

test('satire is identified from the publisher, not from its content', () => {
  const ledger = ledgerFor({
    sourceResult: { matched: true, score: 6, type: 'satire' },
    claims: [{ claim: 'Congress passes bill nobody read.', verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }]
  });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.verdict, 'satire');
  assert.strictEqual(decision.rule, 'satirical-publisher');
});

test('corroboration that is entirely state media is downgraded', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The operation was a complete success.',
      verdict: 'supported',
      supportingEvidence: [evidence('RT', 'Operation succeeds, ministry says', 3), evidence('Xinhua', 'Successful operation reported', 4)],
      contradictingEvidence: []
    }]
  });
  const decision = decideVerdict(ledger);
  // Two different states are two sources, but neither has a strong record.
  assert.ok(['corroborated', 'likely-true'].includes(decision.verdict));
  assert.strictEqual(ledger.hasHighQualitySource, false);
});

test('the ceiling never raises a low presentation score', () => {
  const ledger = ledgerFor({
    claims: [{
      claim: 'The council approved the cycle lane.',
      verdict: 'supported',
      supportingEvidence: [evidence('BBC News', 'Council approves cycle lane', 9), evidence('NPR', 'Cycle lane approved by council', 8.5)],
      contradictingEvidence: []
    }]
  });
  const decision = decideVerdict(ledger);
  const outcome = applyCeiling(3.2, decision);
  assert.strictEqual(outcome.score, 3.2, 'evidence lifts the ceiling, not the score itself');
  assert.strictEqual(outcome.capped, false);
});

test('every verdict states the rule that produced it', () => {
  const ledger = ledgerFor({ claims: [] });
  const decision = decideVerdict(ledger);
  assert.ok(decision.rule && decision.rule.length > 0);
  assert.ok(Array.isArray(decision.grounds) && decision.grounds.length > 0);
  assert.ok(decision.confidence > 0 && decision.confidence < 1, 'the system never claims certainty');
});

// A fact-checking desk's article quotes a rumour in order to rule on it. The
// rumour is not what the page asserts, so it must never be held against it.
const RUMOUR = 'Water consumption can kill the coronavirus.';
const FC_PAGE = 'https://www.factcheck.org/2020/03/viral-social-media-posts-offer-false-coronavirus-tips/';
const fcRuling = { publisher: 'FactCheck.org', finding: 'false', rating: 'False', claimReviewed: 'Drinking water washes the virus into the stomach.', url: FC_PAGE, via: 'claimreview' };
const rumourClaim = { claim: RUMOUR, verdict: 'contradicted', supportingEvidence: [],
  contradictingEvidence: [evidence('alpha', 'Drinking water does not prevent coronavirus'), evidence('beta', 'No, water does not kill the virus'), evidence('gamma', 'Water will not flush out coronavirus')] };

test('a ruling found at the submitted page\'s own address is the page, not evidence against it', () => {
  const decision = decideVerdict(ledgerFor({
    claims: [{ claim: RUMOUR, verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    factCheckResult: { status: 'debunked', matches: [fcRuling] },
    pageUrl: `${FC_PAGE}?utm_source=chatgpt.com`
  }));
  assert.strictEqual(decision.call, 'REAL');
  assert.strictEqual(decision.rule, 'page-is-a-published-fact-check');
});

test('a recognised desk\'s page counts when outlets also reject the claim it examines', () => {
  const decision = decideVerdict(ledgerFor({ claims: [rumourClaim], pageDesk: 'FactCheck.org', pageUrl: FC_PAGE }));
  assert.strictEqual(decision.call, 'REAL');
  assert.strictEqual(decision.rule, 'page-is-a-published-fact-check');
});

test('a desk\'s page with nothing agreeing with it is judged by the ordinary rules', () => {
  const decision = decideVerdict(ledgerFor({
    claims: [{ claim: RUMOUR, verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    pageDesk: 'FactCheck.org', pageUrl: FC_PAGE
  }));
  assert.notStrictEqual(decision.rule, 'page-is-a-published-fact-check');
});

test('the same rumour forwarded as a message is still false', () => {
  const ruled = decideVerdict(ledgerFor({ claims: [{ claim: RUMOUR, verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    factCheckResult: { status: 'debunked', matches: [fcRuling] } }));
  assert.strictEqual(ruled.call, 'FAKE');
  assert.strictEqual(decideVerdict(ledgerFor({ claims: [rumourClaim] })).call, 'FAKE');
});

test('on a desk\'s debunking page, another desk\'s "false" on the same claim agrees with it', () => {
  const afp = { publisher: 'AFP Fact Check', finding: 'false', rating: 'False', claimReviewed: 'Drinking water prevents coronavirus.', url: 'https://factcheck.afp.com/x', via: 'claimreview' };
  const page = { claims: [{ claim: 'Posts falsely suggest that water consumption can kill the virus.', verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    factCheckResult: { status: 'debunked', matches: [afp] }, pageUrl: FC_PAGE };
  const onDesk = decideVerdict(ledgerFor({ ...page, pageDesk: 'FactCheck.org', title: 'Viral Social Media Posts Offer False Coronavirus Tips' }));
  assert.strictEqual(onDesk.call, 'REAL');
  assert.strictEqual(onDesk.rule, 'page-is-a-published-fact-check');
  // The same ruling against an ordinary page is still a ruling against it.
  assert.strictEqual(decideVerdict(ledgerFor({ ...page, title: 'Water kills the virus, posts say' })).call, 'FAKE');
});

test('a desk\'s page whose own denial is contradicted is not vouched for', () => {
  const decision = decideVerdict(ledgerFor({
    claims: [{ ...rumourClaim, claim: 'Walmart has not adopted a staggered shopping schedule.' }],
    pageDesk: 'FactCheck.org', pageUrl: FC_PAGE, title: "Walmart Hasn't Adopted 'Staggered Shopping'"
  }));
  assert.notStrictEqual(decision.rule, 'page-is-a-published-fact-check');
});

test('debunk headlines misclassified into supportingEvidence do not corroborate positive claims and are treated as contradiction', () => {
  const debunkHeadline = (source, title) => ({
    source, title, description: '', url: `https://${source.replace(/\s/g, '').toLowerCase()}.test/x`,
    reliability: 8, publishedAt: '2026-10-07T08:00:00Z'
  });
  const decision = decideVerdict(ledgerFor({
    claims: [{
      claim: 'A video shows the Army chief dancing with a major\'s wife.',
      verdict: 'supported',
      supportingEvidence: [
        debunkHeadline('NDTV', 'Video of Army chief dancing with major\'s wife is AI-generated'),
        debunkHeadline('India Today', 'Fact Check: viral video of Army chief dancing is a deepfake'),
        debunkHeadline('The Hindu', 'Army chief dance video morphed, says PIB')
      ],
      contradictingEvidence: []
    }],
    factCheckResult: { status: 'none', matches: [] }
  }));
  assert.strictEqual(decision.call, 'FAKE');
  assert.strictEqual(decision.rule, 'contradicted-by-multiple-independent-sources');
});


test('the stored record keeps a print of the submitted page, never its address, and replays the same', () => {
  const { compactLedgerInput, replayVerdict } = require('../agents/verdictEngine');
  const input = {
    claims: [{ claim: RUMOUR, verdict: 'no-coverage', supportingEvidence: [], contradictingEvidence: [] }],
    sourceResult: { matched: true, score: 7, type: 'newspaper' }, transparencyResult: { score: 7 }, manipulationResult: { techniques: [] },
    title: 'Viral Social Media Posts Offer False Coronavirus Tips',
    factCheckResult: { status: 'debunked', matches: [fcRuling] },
    pageUrl: `${FC_PAGE}?utm_source=chatgpt.com`
  };
  const live = decideVerdict(buildEvidenceLedger(input));
  const stored = compactLedgerInput(input);
  const json = JSON.stringify(stored);
  // The desk's own article link stays, as the evidence it is (public, from the fact-check index); the
  // address the reader submitted, with whatever it carried, does not.
  assert.ok(!('pageUrl' in stored) && !json.includes('utm_source'), 'the submitted address is not stored');
  assert.strictEqual(stored.pageHost, 'factcheck.org');
  assert.match(stored.pagePrint, /^[0-9a-f]{32}$/);
  const replayed = replayVerdict(JSON.parse(json));
  assert.strictEqual(replayed.call, live.call);
  assert.strictEqual(replayed.rule, 'page-is-a-published-fact-check');
});

// Reports of an event do not say that a given video or picture shows it.
const threeOutlets = [evidence('alpha', 'Nepal floods: houses swept away in Sunsari'), evidence('beta', 'Floods in Nepal leave thousands homeless'), evidence('gamma', 'Nepal flood toll rises')];
const supported = (claim) => ({ claim, verdict: 'supported', supportingEvidence: threeOutlets, contradictingEvidence: [] });

test('a claim about what a video or picture shows is not confirmed by reports of the event', () => {
  for (const claim of ['An image shows a house that survived flooding in Nepal.', 'A video showing PM Modi interacting with Congress leaders at the meeting.',
    'Actual footage of a Nepal flood survivor.', 'The video shows the Gandak Barrage protecting Bihar from the Nepal floods.', 'Visuals of the protest at Shivaji Park.']) {
    const d = decideVerdict(ledgerFor({ claims: [supported(claim)] }));
    assert.strictEqual(d.call, 'CANNOT VERIFY', claim);
    assert.strictEqual(d.rule, 'media-not-confirmed-by-reports', claim);
  }
});

test('the same support confirms a plain claim, and a media claim the outlets contradict is still false', () => {
  assert.strictEqual(decideVerdict(ledgerFor({ claims: [supported('Floods in Nepal left thousands homeless in Sunsari.')] })).call, 'REAL');
  assert.strictEqual(decideVerdict(ledgerFor({ claims: [supported('The photo of the minister went viral after the floods.')] })).call, 'CANNOT VERIFY',
    'the photo itself is the claim');
  const contradicted = { claim: 'A video shows the Army chief dancing at a wedding.', verdict: 'contradicted', supportingEvidence: [],
    contradictingEvidence: [evidence('alpha', 'Video of Army chief dancing is AI-generated'), evidence('beta', 'Army chief dance video is a deepfake'), evidence('gamma', 'No, that is not the Army chief dancing')] };
  assert.strictEqual(decideVerdict(ledgerFor({ claims: [contradicted] })).call, 'FAKE');
});

test('a before-and-after comparison is a claim about pictures, said or not', () => {
  const d = decideVerdict(ledgerFor({ claims: [supported('Genuine comparison of a Nepalese town before and after the August 2026 floods.')] }));
  assert.strictEqual(d.rule, 'media-not-confirmed-by-reports');
});

test('a before-and-after claim with no pictures in it is an ordinary claim', () => {
  assert.strictEqual(decideVerdict(ledgerFor({ claims: [supported('India GDP grew faster after demonetisation than before and after the budget.')] })).call, 'REAL');
});
