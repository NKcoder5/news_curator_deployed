const test = require('node:test');
const assert = require('node:assert');
const { ratingClass, parseExplorer, queriesFor, shortQuery } = require('../agents/factCheckSearch');
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

test('a misleading rating is probably false, not false', () => {
  const decision = decideVerdict(ledgerFor({
    factCheckResult: { status: 'misleading', matches: [review('BOOM', 'misleading', 'Misleading')] }
  }));
  assert.strictEqual(decision.verdict, 'likely-false');
  assert.strictEqual(decision.rule, 'rated-misleading-by-fact-checkers');
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
