// Faults found reading the whole backend on 26 Oct, each pinned so it cannot come back.
const test = require('node:test');
const assert = require('node:assert');

test('a headline keeps its hyphenated words; only a site name is trimmed', () => {
  const { __test: { trimSiteName } } = require('../utils/articleExtractor');
  assert.equal(trimSiteName('Tamil Nadu by-election: DMK wins both seats', '', 'www.thehindu.com'), 'Tamil Nadu by-election: DMK wins both seats');
  assert.equal(trimSiteName('WHO declares end of Covid-19 emergency'), 'WHO declares end of Covid-19 emergency');
  assert.equal(trimSiteName('Indo-Pak talks resume after 5-year gap'), 'Indo-Pak talks resume after 5-year gap');
  assert.equal(trimSiteName('India vs Pakistan - who will win the final', '', 'www.example.com'), 'India vs Pakistan - who will win the final');
  assert.equal(trimSiteName('India beat Pakistan in T20 World Cup - The Hindu', 'The Hindu', 'www.thehindu.com'), 'India beat Pakistan in T20 World Cup');
  assert.equal(trimSiteName('Floods hit Chennai – BBC News', 'BBC News', 'www.bbc.com'), 'Floods hit Chennai');
  assert.equal(trimSiteName('RBI cuts repo rate by 25 bps | NDTV', '', 'www.ndtv.com'), 'RBI cuts repo rate by 25 bps');
});

test('a reference past the last code point is dropped, not thrown', () => {
  const { decodeEntities } = require('../utils/articleExtractor');
  assert.equal(decodeEntities('a&#99999999;b&#x110000;c&#x27;d&#128512;'), "abc'd\u{1F600}");
  assert.equal(decodeEntities('&amp;#39;'), '&#39;', 'decoded once');
});

test('a pasted message is titled by its first sentence, not cut at a decimal point', async () => {
  const { ingestSocialContent } = require('../utils/socialIngest');
  const ingested = await ingestSocialContent({ text: 'RBI cut the repo rate by 0.25 percent today. Banks follow.' });
  assert.equal(ingested.title, 'RBI cut the repo rate by 0.25 percent today');
  const lines = await ingestSocialContent({ text: 'Breaking news\nThe dam has burst' });
  assert.equal(lines.title, 'Breaking news');
});

test('the feed takes only its own sections, and asks for nothing else', async () => {
  const { fetchTopNews, FEED_CATEGORIES } = require('../utils/newsFetcher');
  assert.ok(FEED_CATEGORIES.has('general') && FEED_CATEGORIES.has('technology'));
  for (const bad of ['politics', 'general&q=x', '', 'GENERAL']) {
    await assert.rejects(() => fetchTopNews(bad), (err) => err.code === 'UNKNOWN_CATEGORY' && err.httpStatus === 400, bad);
  }
});

test('the month of May is not a forecast; "may" the verb is', () => {
  const { forecastOnly } = require('../utils/stanceGuards');
  assert.equal(forecastOnly('Polls held in May 2026 saw TVK win', 'TVK won both bypolls'), false);
  assert.equal(forecastOnly('In May TVK swept the bypolls', 'TVK won both bypolls'), false);
  assert.equal(forecastOnly('TVK may win both seats', 'TVK won both bypolls'), true);
});

test('one unreadable screenshot does not switch screenshot reading off', async () => {
  const tesseractPath = require.resolve('tesseract.js');
  const ocrPath = require.resolve('../utils/ocr');
  const real = require.cache[tesseractPath];
  let calls = 0;
  require.cache[tesseractPath] = {
    id: tesseractPath, filename: tesseractPath, loaded: true,
    exports: {
      createWorker: async (langs) => ({
        langs,
        recognize: async () => {
          calls += 1;
          if (calls === 1) throw new Error('corrupt image');
          return { data: { text: 'The dam at Mettur has been opened to release water', confidence: 91 } };
        },
        terminate: async () => {}
      })
    }
  };
  delete require.cache[ocrPath];
  const ocr = require('../utils/ocr');
  try {
    await assert.rejects(() => ocr.readImageText(Buffer.from('x'), ['eng']), (err) => err.code === 'OCR_FAILED');
    assert.equal(ocr.isAvailable(), true, 'still available after one bad image');
    const read = await ocr.readImageText(Buffer.from('y'), ['eng']);
    assert.match(read.text, /Mettur/);
  } finally {
    if (real) require.cache[tesseractPath] = real; else delete require.cache[tesseractPath];
    delete require.cache[ocrPath];
  }
});

test('the style family\'s damping is listed whenever it applies, so the ledger adds up', () => {
  const { assessProbability, weighContentFactors } = require('../agents/weightOfEvidence');
  // One style check left (the others could not run): its weight is damped, and the ledger says so.
  const content = weighContentFactors({ clickbait: 1 });
  if (content.entries.length && content.entries[0].decibans !== 0) {
    assert.ok(content.adjustments.some(a => a.adjustment === 'style-correlation-damping'), 'damping listed for one check');
  }
  for (const factorScores of [{ clickbait: 1 }, { manipulation: 0.5 }, { clickbait: 1, bias: 2 }, {}]) {
    const result = assessProbability({ factorScores, sourceResult: { matched: false, score: 5 }, evidence: { independentSupport: 0 } });
    const sum = result.ledger.reduce((s, e) => s + e.decibans, 0);
    assert.ok(Math.abs(sum - result.totalDecibans) < 0.05, `ledger ${sum.toFixed(2)} against total ${result.totalDecibans} for ${JSON.stringify(factorScores)}`);
  }
  // NaN is a number, and fell in no bin.
  assert.doesNotThrow(() => weighContentFactors({ clickbait: NaN }));
});

test('the pattern checks read "100%", ", period." and acronyms as they are written', () => {
  const { clickbaitByRules, manipulationByRules, transparencyByRules } = require('../agents/heuristics');
  const { CHECKS } = require('../agents/transparencyAgent');
  assert.deepStrictEqual(clickbaitByRules('ISRO launches its heaviest satellite').signals, []);
  assert.ok(clickbaitByRules('SHOCKING video goes VIRAL').signals.includes('Words set in all capitals'));
  const found = (text) => manipulationByRules('', text).techniques.map(t => t.technique);
  assert.ok(found('The remedy works 100% of the time for every single patient.').includes('exaggeration'));
  assert.ok(found('That is the whole truth about the vaccine, period.').includes('thought-terminating cliche'));
  assert.deepStrictEqual(found('Revenue fell sharply during the same period.'), []);
  const named = (text) => transparencyByRules('Fire at the market', text, CHECKS).namedExamples;
  assert.deepStrictEqual(named('He said the fire began at night. Officials said nothing more.'), []);
  assert.deepStrictEqual(named('Fire chief Ravi Kumar said the fire began at night.'), ['Ravi Kumar']);
});

test('desk ratings: "partly true" is misleading, "not real" and "inaccurate" are false', () => {
  const { ratingClass } = require('../agents/factCheckSearch');
  assert.strictEqual(ratingClass('Partly true'), 'misleading');
  assert.strictEqual(ratingClass('Partially True'), 'misleading');
  assert.strictEqual(ratingClass('Not real'), 'false');
  assert.strictEqual(ratingClass('Inaccurate'), 'false');
  assert.strictEqual(ratingClass('Mostly true'), 'true');
  assert.strictEqual(ratingClass('Unverified'), 'unrated');
});

test('"Rs" is a currency only as a word of its own', () => {
  const { readNumbers } = require('../services/claimSignature');
  assert.deepStrictEqual(readNumbers('Mars 2 mission launched').numbers.map(n => n.unit), ['mission']);
  assert.deepStrictEqual(readNumbers('Fuel costs Rs 5 more').numbers.map(n => n.unit), ['rupee']);
  assert.deepStrictEqual(readNumbers('fine of rs.500 imposed').numbers.map(n => n.unit), ['rupee']);
});

test('reporting the desk had in front of it cannot overtake its ruling; later reporting can', () => {
  const { buildEvidenceLedger, decideVerdict } = require('../agents/verdictEngine');
  const outlet = (source, title, publishedAt) => ({ source, title, description: '', url: `https://${source.replace(/\s/g, '')}.test/x`, reliability: 7, publishedAt });
  const decide = (dates) => decideVerdict(buildEvidenceLedger({
    claims: [{
      claim: 'Dhaka agreed to buy costlier power from China.', verdict: 'supported', contradictingEvidence: [],
      supportingEvidence: [
        outlet('News18', 'Bangladesh agreed to pay China 127% more for power', dates[0]),
        outlet('India Today', 'Bangladesh eyes 127% costlier Chinese power', dates[1]),
        outlet('Outlook Business', 'Why Bangladesh is paying more for Chinese power', dates[2])
      ]
    }],
    sourceResult: { matched: false, score: 5 }, transparencyResult: { score: 5 }, manipulationResult: { techniques: [] },
    title: 'Dhaka agrees to buy costlier power from China',
    factCheckResult: { status: 'debunked', matches: [{ publisher: 'AFP', finding: 'false', rating: 'False', reviewedAt: '2026-09-14', url: 'https://factcheck.afp.com/x', claimReviewed: 'Dhaka agreed to buy costlier power from China' }] },
    asOf: Date.parse('2026-10-20T00:00:00Z')
  }));
  const before = decide(['2026-09-10T08:00:00Z', '2026-09-11T08:00:00Z', '2026-09-14T06:00:00Z']);
  assert.strictEqual(before.rule, 'rated-false-by-fact-checkers');
  assert.strictEqual(before.call, 'FAKE');
  const after = decide(['2026-10-01T08:00:00Z', '2026-10-02T08:00:00Z', '2026-10-03T08:00:00Z']);
  assert.strictEqual(after.rule, 'fact-checkers-and-reporting-disagree');
});

test('a name the reference work could not be asked about is reported as unchecked', async () => {
  const wikipediaPath = require.resolve('../utils/wikipedia');
  const nimPath = require.resolve('../utils/nvidiaNimApi');
  const nliPath = require.resolve('../services/localNli');
  const real = { wiki: require.cache[wikipediaPath], nim: require.cache[nimPath], nli: require.cache[nliPath] };
  const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
  stub(wikipediaPath, {
    fetchWikipediaContent: async (entity) => {
      if (/Chennai/.test(entity)) throw new Error('timeout');
      return [{ title: entity, content: `${entity} is an Indian politician.`, url: 'x' }];
    },
    extractKeywords: () => []
  });
  stub(nimPath, { callNimApiJson: async () => ({ same_subject: true, contradicts: false, both_can_be_true: true, asserted_by: 'article', supports: false }), callNimApi: async () => '', extractJson: () => null });
  stub(nliPath, { judgePairs: async (pairs) => pairs.map(() => null), judgePair: async () => null, isAvailable: () => false });
  delete require.cache[require.resolve('../agents/referenceCheck')];
  try {
    const { checkPremises } = require('../agents/referenceCheck');
    const result = await checkPremises('Rahul Gandhi visits Chennai', 'Rahul Gandhi visited Chennai on Tuesday.');
    assert.strictEqual(result.status, 'consistent');
    assert.strictEqual(result.partialFailure, true);
    assert.match(result.explanation, /1 could not be checked/);
  } finally {
    for (const [p, r] of [[wikipediaPath, real.wiki], [nimPath, real.nim], [nliPath, real.nli]]) {
      if (r) require.cache[p] = r; else delete require.cache[p];
    }
    delete require.cache[require.resolve('../agents/referenceCheck')];
  }
});

test('a search asked twice at once is made once; a failed one is asked again', async () => {
  const { cached } = require('../utils/newsFetcher');
  let made = 0;
  const key = `test|${Date.now()}`;
  const search = () => { made += 1; return new Promise(r => setTimeout(() => r(['result']), 20)); };
  const [a, b] = await Promise.all([cached(key, search), cached(key, search)]);
  assert.strictEqual(made, 1);
  assert.deepStrictEqual(a, b);
  let failures = 0;
  const failing = () => { failures += 1; return Promise.reject(new Error('refused')); };
  const failKey = `${key}|fail`;
  await assert.rejects(() => cached(failKey, failing));
  await assert.rejects(() => cached(failKey, failing));
  assert.strictEqual(failures, 2, 'a failure is not remembered');
});

test('NewsAPI is not asked without a key, and is rested after it refuses for its quota', async () => {
  const axiosPath = require.resolve('axios');
  const fetcherPath = require.resolve('../utils/newsFetcher');
  const realAxios = require.cache[axiosPath];
  const saved = process.env.NEWS_API_KEY;
  let calls = 0;
  const actual = require('axios');
  require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: Object.assign(Object.create(actual), {
    get: async () => { calls += 1; throw Object.assign(new Error('Too many requests'), { response: { status: 429, data: { code: 'rateLimited', message: 'You have made too many requests.' } } }); }
  }) };
  delete require.cache[fetcherPath];
  const error = console.error; console.error = () => {};
  try {
    const { searchNewsCoverage } = require('../utils/newsFetcher');
    delete process.env.NEWS_API_KEY;
    await assert.rejects(() => searchNewsCoverage('india medals'), (err) => err.searchUnavailable === true);
    assert.strictEqual(calls, 0, 'no key, no request');
    process.env.NEWS_API_KEY = 'test-key';
    await assert.rejects(() => searchNewsCoverage('india medals'), (err) => err.code === 'NEWS_QUOTA_EXHAUSTED');
    await assert.rejects(() => searchNewsCoverage('another query'), (err) => err.code === 'NEWS_QUOTA_EXHAUSTED');
    assert.strictEqual(calls, 1, 'rested after the refusal');
  } finally {
    console.error = error;
    if (saved === undefined) delete process.env.NEWS_API_KEY; else process.env.NEWS_API_KEY = saved;
    if (realAxios) require.cache[axiosPath] = realAxios; else delete require.cache[axiosPath];
    delete require.cache[fetcherPath];
  }
});

test('an agency credit is read as words: "map —" is not the Associated Press', () => {
  const { detectWireCredit } = require('../agents/independence');
  assert.strictEqual(detectWireCredit({ title: 'Trump\'s tariff map — what changes for India' }), null);
  assert.strictEqual(detectWireCredit({ title: 'Quake hits Japan', description: 'TOKYO (AP) — A strong quake struck' }).agency, 'Associated Press');
  assert.strictEqual(detectWireCredit({ title: 'Rains lash city', description: 'CHENNAI, Oct 2 (PTI) - Heavy rain' }).agency, 'PTI');
  assert.strictEqual(detectWireCredit({ title: 'Markets: Reuters report says rupee fell' }).agency, 'Reuters');
});

test('the checks a verdict can rest on are asked at temperature 0', async () => {
  const nimPath = require.resolve('../utils/nvidiaNimApi');
  const real = require.cache[nimPath];
  const seen = {};
  require.cache[nimPath] = { id: nimPath, filename: nimPath, loaded: true, exports: {
    callNimApi: async () => '', extractJson: () => null,
    callNimApiJson: async (prompt, options) => {
      seen[options.label] = options.temperature;
      return { clickbait_score: 2, bias_score: 2, techniques: [], checks: {}, contradicts: false, both_can_be_true: true, same_subject: true };
    }
  } };
  const agents = ['clickbaitAgent', 'biasAgent', 'manipulationAgent', 'transparencyAgent', 'referenceCheck'].map(a => require.resolve(`../agents/${a}`));
  agents.forEach(p => delete require.cache[p]);
  try {
    await require('../agents/clickbaitAgent').analyzeClickbait('Rains lash Chennai');
    await require('../agents/biasAgent').analyzeBias('Rains lash Chennai', 'Heavy rain fell across Chennai on Monday, the Met department said.');
    await require('../agents/manipulationAgent').detectManipulation('Rains lash Chennai', 'Heavy rain fell across Chennai on Monday, the Met department said.');
    await require('../agents/transparencyAgent').assessTransparency('Rains lash Chennai', 'Heavy rain fell across Chennai on Monday, the Met department said.');
    for (const label of ['clickbait', 'bias', 'manipulation', 'transparency']) assert.strictEqual(seen[label], 0, `${label} at temperature ${seen[label]}`);
    const src = require('fs').readFileSync(require.resolve('../agents/referenceCheck'), 'utf8');
    assert.match(src, /temperature: 0, requiredKeys: \['contradicts'/, 'the premise check is asked at temperature 0');
  } finally {
    if (real) require.cache[nimPath] = real; else delete require.cache[nimPath];
    agents.forEach(p => delete require.cache[p]);
  }
});
