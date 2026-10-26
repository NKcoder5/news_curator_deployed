const test = require('node:test');
const assert = require('node:assert');
const { ratingClass, parseExplorer, queriesFor, shortQuery, mediaScopeCompatible } = require('../agents/factCheckSearch');
const { buildEvidenceLedger, decideVerdict } = require('../agents/verdictEngine');
const { weighFactCheck } = require('../agents/weightOfEvidence');

const ledgerFor = (overrides = {}) => buildEvidenceLedger({
  claims: [{ claim: 'All Saturdays are bank holidays from November.', verdict: 'unverified', supportingEvidence: [], contradictingEvidence: [] }],
  sourceResult: { matched: false, score: 5 },
  transparencyResult: { score: 5 },
  manipulationResult: { techniques: [] },
  title: 'All Saturdays are bank holidays from November',
  ...overrides
});

const review = (publisher, finding = 'false', rating = 'False') => ({
  publisher, url: `https://${publisher.replace(/\s/g, '').toLowerCase()}.test/fc`, reviewedAt: '2026-10-05',
  claimReviewed: 'The Centre has declared every Saturday a bank holiday.', rating, finding
});

test('free-text ratings collapse into classes', () => {
  assert.strictEqual(ratingClass('False'), 'false');
  assert.strictEqual(ratingClass('FALSE'), 'false');
  assert.strictEqual(ratingClass('Pants on Fire!'), 'false');
  assert.strictEqual(ratingClass('This is incorrect. There is no evidence 5G is harmful.'), 'false');
  assert.strictEqual(ratingClass('Misleading'), 'misleading');
  assert.strictEqual(ratingClass('Missing context'), 'misleading');
  assert.strictEqual(ratingClass('Partly false'), 'misleading');
  assert.strictEqual(ratingClass('True'), 'true');
  assert.strictEqual(ratingClass(''), 'unrated');
});

test('the Explorer reply is parsed past its anti-hijacking prefix', () => {
  const raw = `)]}'\n${JSON.stringify([['claims_response', [[
    ['Army chief seen dancing with a major\'s wife.', ['Social media users'], null,
      [[['AFP Fact Check', 'factcheck.afp.com'], 'https://factcheck.afp.com/x', 1791331200, 'False', null, null, 'en', null, 'Video is AI-generated']]],
    null, 42.5
  ]]]])}`;
  const [item] = parseExplorer(raw);
  assert.strictEqual(item.publisher, 'AFP Fact Check');
  assert.strictEqual(item.rating, 'False');
  assert.strictEqual(item.url, 'https://factcheck.afp.com/x');
  assert.strictEqual(item.reviewedAt, '2026-10-07');
  assert.deepStrictEqual(parseExplorer('not json'), []);
});

test('queries are cut to a few content words, without dates', () => {
  assert.strictEqual(shortQuery('Government declared all Saturdays as bank holidays from November 2026'),
    'Government declared Saturdays bank holidays');
  const queries = queriesFor([{ claim: 'India won 84 medals at the Asian Games 2026.', headline: 'India wins 84 medals at Asian Games', keywordsEn: 'India medals Asian Games 2026' }]);
  assert.ok(queries.length >= 2);
  assert.ok(queries.every(q => !/2026/.test(q)));
  assert.ok(queries.every(q => q.split(' ').length <= 5));
});

test('a claim fact-checkers rated false is FAKE even when no newsroom covered it', () => {
  const ledger = ledgerFor({
    factCheckResult: { status: 'debunked', matches: [review('The Quint'), review('Newschecker')] }
  });
  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.call, 'FAKE');
  assert.strictEqual(decision.rule, 'rated-false-by-fact-checkers');
  assert.match(decision.oneLine, /The Quint and Newschecker/);
  assert.ok(decision.confidence >= 0.85);
  assert.ok(decision.grounds.some(g => /The Quint reviewed/.test(g)));
});

test('a misleading rating is answered MISLEADING, not FAKE', () => {
  const decision = decideVerdict(ledgerFor({
    factCheckResult: { status: 'misleading', matches: [review('BOOM', 'misleading', 'Misleading')] }
  }));
  assert.strictEqual(decision.call, 'MISLEADING');
  assert.strictEqual(decision.verdict, 'misleading');
  assert.strictEqual(decision.level, 'likely-false');
  assert.strictEqual(decision.rule, 'rated-misleading-by-fact-checkers');
  assert.match(decision.oneLine, /BOOM\) found this misleading/);
  assert.ok(decision.ceiling <= 3.5);
});

test('a misleading rating never softens what the other evidence says', () => {
  // Two outlets report otherwise: FAKE without the ruling, and FAKE with it, the desk's finding added.
  const outlet = (source, title) => ({ source, title, description: '', url: `https://${source.replace(/\s/g, '')}.test/x`, reliability: 8, reported: 'otherwise' });
  const decision = decideVerdict(ledgerFor({
    claims: [{
      claim: 'All Saturdays are bank holidays from November.', verdict: 'contradicted', supportingEvidence: [],
      contradictingEvidence: [outlet('The Hindu', 'Banks open on Saturdays as usual, RBI says'), outlet('NDTV', 'No change to bank working days in November')]
    }],
    factCheckResult: { status: 'misleading', matches: [review('BOOM', 'misleading', 'Misleading')] }
  }));
  assert.strictEqual(decision.call, 'FAKE');
  assert.ok(decision.grounds.some(g => /BOOM/.test(g)), 'the desk’s finding is among the grounds');
});

test('a ruling overtaken by wide current reporting is shown as a disagreement, not settled', () => {
  // Different wording per outlet: identical headlines are read as one syndicated copy.
  const outlet = (source, title) => ({ source, title, description: '', url: `https://${source}.test/x`, reliability: 8 });
  const decision = decideVerdict(ledgerFor({
    claims: [{
      claim: 'All Saturdays are bank holidays from November.', verdict: 'supported',
      supportingEvidence: [
        outlet('The Hindu', 'Banks to stay shut on all Saturdays from November'),
        outlet('Indian Express', 'Every Saturday a bank holiday, RBI notifies'),
        outlet('NDTV', 'Five-day week for banks comes into force in November')
      ], contradictingEvidence: []
    }],
    factCheckResult: { status: 'debunked', matches: [review('The Quint')] }
  }));
  assert.strictEqual(decision.rule, 'fact-checkers-and-reporting-disagree');
  assert.strictEqual(decision.call, 'CANNOT VERIFY');
});

test('a desk rating the claim true makes it probably true', () => {
  const decision = decideVerdict(ledgerFor({
    factCheckResult: { status: 'confirmed', matches: [review('Factly', 'true', 'True')] }
  }));
  assert.strictEqual(decision.call, 'REAL');
  assert.strictEqual(decision.rule, 'rated-true-by-fact-checkers');
});

test('no ruling leaves the news rules in charge', () => {
  const decision = decideVerdict(ledgerFor({ factCheckResult: { status: 'none', matches: [] } }));
  assert.strictEqual(decision.rule, 'no-independent-coverage');
});

test('a news contradiction quotes what the outlets report', () => {
  const against = (source, title) => ({ source, title, description: '', url: `https://${source}.test/x`, reliability: 8, reported: '85 medals' });
  const decision = decideVerdict(ledgerFor({
    claims: [{
      claim: 'India won 84 medals at the Asian Games 2026.', verdict: 'contradicted',
      supportingEvidence: [], contradictingEvidence: [
        against('DD India', 'India ends Asian Games campaign with 85 medals'),
        against('The Indian Express', 'Record haul: 85 medals for India in Aichi-Nagoya')
      ]
    }]
  }));
  assert.strictEqual(decision.verdict, 'false');
  assert.match(decision.oneLine, /“85 medals”/);
});

test('a ruling enters the probability; the absence of one does not', () => {
  assert.ok(weighFactCheck({ status: 'debunked' }).decibans > 15);
  assert.ok(weighFactCheck({ status: 'confirmed' }).decibans < 0);
  assert.strictEqual(weighFactCheck({ status: 'none' }), null);
  assert.strictEqual(weighFactCheck(null), null);
});

test('outlets reporting the debunk do not count as reporting that overtakes the ruling', () => {
  const debunkHeadline = (source, title) => ({ source, title, description: '', url: `https://${source.replace(/\s/g, '')}.test/x`, reliability: 8, publishedAt: '2026-10-07T08:00:00Z' });
  const decision = decideVerdict(ledgerFor({
    claims: [{
      claim: 'A video shows the Army chief dancing with a major\'s wife.', verdict: 'supported',
      supportingEvidence: [
        debunkHeadline('NDTV', 'Video of Army chief dancing with major\'s wife is AI-generated'),
        debunkHeadline('India Today', 'Fact Check: viral video of Army chief dancing is a deepfake'),
        debunkHeadline('The Hindu', 'Army chief dance video morphed, says PIB')
      ],
      contradictingEvidence: []
    }],
    factCheckResult: { status: 'debunked', matches: [review('AFP Fact Check'), review('PTI')] }
  }));
  assert.strictEqual(decision.rule, 'rated-false-by-fact-checkers');
  assert.strictEqual(decision.call, 'FAKE');
});

test('mediaScopeCompatible prevents media debunks from falsely matching plain factual claims', () => {
  // A review debunking a viral video does NOT match a plain factual assertion about who holds an office
  assert.strictEqual(
    mediaScopeCompatible(
      'C. Joseph Vijay is the Chief Minister of Tamil Nadu.',
      'The video shows anti-Hindi protests intensifying in Tamil Nadu after C. Joseph Vijay took the oath as Chief Minister on 10 May 2026.',
      'An old video is being shared as showing anti-Hindi protests intensifying in Tamil Nadu after C. Joseph Vijay took oath as Chief Minister'
    ),
    false,
    'a video debunk must not match a claim that mentions no media'
  );

  // A review debunking a video DOES match when the user explicitly claims something about a video
  assert.strictEqual(
    mediaScopeCompatible(
      'A video shows the Army chief dancing with a major\'s wife.',
      'Video shows the Army chief dancing with a major\'s wife.',
      'Fact Check: viral video of Army chief dancing is a deepfake'
    ),
    true,
    'a video debunk matches a claim that asserts a video exists'
  );

  // Non-media factual debunk matches a non-media claim
  assert.strictEqual(
    mediaScopeCompatible(
      'RBI has banned 500 rupee notes.',
      'The Centre has banned 500 rupee notes.',
      'Fact Check: RBI has not withdrawn 500 rupee notes'
    ),
    true,
    'a direct factual debunk matches a direct factual claim'
  );
});

test('factCheckOvertaken requires at least 3 independent outlets, not 2', () => {
  const supportHeadline = (source, title) => ({
    source, title, description: 'Reporting fact', url: `https://${source.replace(/\s/g, '').toLowerCase()}.test/x`,
    reliability: 8, publishedAt: '2026-10-10T08:00:00Z'
  });

  // 2 independent supporting outlets: does NOT overtake the fact-checker ruling (remains FAKE)
  const decisionWith2 = decideVerdict(ledgerFor({
    claims: [{
      claim: 'C. Joseph Vijay is the Chief Minister of Tamil Nadu.',
      verdict: 'supported',
      supportingEvidence: [
        supportHeadline('The Hindu', 'Vijay attends event as party president'),
        supportHeadline('NDTV', 'Vijay political rally in Tamil Nadu')
      ],
      contradictingEvidence: []
    }],
    factCheckResult: { status: 'debunked', matches: [review('FACTLY')] }
  }));
  assert.strictEqual(decisionWith2.rule, 'rated-false-by-fact-checkers');
  assert.strictEqual(decisionWith2.call, 'FAKE');

  // 3 independent supporting outlets: DOES overtake the fact-checker ruling (becomes unverified/disagreement)
  const decisionWith3 = decideVerdict(ledgerFor({
    claims: [{
      claim: 'C. Joseph Vijay is the Chief Minister of Tamil Nadu.',
      verdict: 'supported',
      supportingEvidence: [
        supportHeadline('The Hindu', 'Vijay sworn in as Chief Minister of Tamil Nadu'),
        supportHeadline('NDTV', 'Vijay takes oath as CM of Tamil Nadu'),
        supportHeadline('Indian Express', 'Vijay appointed Chief Minister of Tamil Nadu')
      ],
      contradictingEvidence: []
    }],
    factCheckResult: { status: 'debunked', matches: [review('FACTLY')] }
  }));
  assert.strictEqual(decisionWith3.rule, 'fact-checkers-and-reporting-disagree');
  assert.strictEqual(decisionWith3.verdict, 'unverified');
});



test('evaluation hides the labelling desk whole, not only its ruling\'s address', () => {
  const { excludedReview } = require('../agents/factCheckSearch');
  const saved = { a: process.env.FACT_CHECK_EXCLUDE, d: process.env.FACT_CHECK_EXCLUDE_DESKS };
  process.env.FACT_CHECK_EXCLUDE = 'fullfact.org/world/nepal-miracle-house';
  process.env.FACT_CHECK_EXCLUDE_DESKS = 'fullfact\nfullfact.org';
  try {
    assert.strictEqual(excludedReview({ url: 'https://fullfact.org/world/nepal-miracle-house/?utm=x', publisher: 'Full Fact' }), true);
    assert.strictEqual(excludedReview({ url: 'https://fullfact.org/other/address/', publisher: 'Full Fact' }), true, 'same desk, another address');
    assert.strictEqual(excludedReview({ url: 'https://example.org/x', publisher: 'Full Fact' }), true, 'same desk by name');
    assert.strictEqual(excludedReview({ url: 'https://factcheck.afp.com/x', publisher: 'AFP Fact Check' }), false, 'another desk stays');
    process.env.FACT_CHECK_EXCLUDE_DESKS = 'afp\nafp.com';
    assert.strictEqual(excludedReview({ url: 'https://factuel.afp.com/y', publisher: 'AFP Factuel' }), true, 'a desk\'s other-language edition is the same desk');
  } finally {
    if (saved.a === undefined) delete process.env.FACT_CHECK_EXCLUDE; else process.env.FACT_CHECK_EXCLUDE = saved.a;
    if (saved.d === undefined) delete process.env.FACT_CHECK_EXCLUDE_DESKS; else process.env.FACT_CHECK_EXCLUDE_DESKS = saved.d;
  }
});

test('a short message about a video is matched as sent when the reading step dropped the video', async () => {
  const { isMediaClaim } = require('../agents/factCheckSearch');
  assert.ok(isMediaClaim('Visuals of the protest at Shivaji Park'), 'visuals are pictures');
  assert.ok(isMediaClaim('A News 1st-style news card shows the minister making three statements'), 'a news card is a picture');
  assert.ok(!isMediaClaim('The Gandak Barrage Project protected Bihar from floods originating in Nepal.'));
});

test('reports of the event cannot overtake desks\' rulings on a video of it', () => {
  const outlet = (source, title) => ({ source, title, description: '', url: `https://${source}.test/x`, reliability: 8 });
  const decision = decideVerdict(buildEvidenceLedger({
    claims: [{
      claim: 'Protest against the Chief Election Commissioner at Jantar Mantar.', verdict: 'supported',
      supportingEvidence: [
        outlet('The Hindu', 'Protesters gather at Jantar Mantar against CEC'),
        outlet('Indian Express', 'Jantar Mantar protest demands CEC resignation'),
        outlet('NDTV', 'Hundreds rally at Jantar Mantar over election commission')
      ], contradictingEvidence: []
    }],
    sourceResult: { matched: false, score: 5 },
    transparencyResult: { score: 5 },
    manipulationResult: { techniques: [] },
    title: "This video shows the recent protest against CEC Gyanesh Kumar at Delhi's Jantar Mantar.",
    factCheckResult: { status: 'debunked', matches: [review('Boom Live'), review('India Today')] }
  }));
  assert.strictEqual(decision.rule, 'rated-false-by-fact-checkers');
  assert.strictEqual(decision.call, 'FAKE');
});
