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
