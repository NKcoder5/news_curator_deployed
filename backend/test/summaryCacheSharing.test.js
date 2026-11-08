// Whose text may a stored summary be shown to?
//
// Summaries are cached per article URL and served to every later reader. When a publisher blocks page
// reading, or the headline the caller sent does not match the page, the summary is written from the text
// the caller sent. A caller who sent only a headline stored an entry with no fingerprint, and an entry
// with no fingerprint matched every later caller: one request naming a real article's address and a
// made-up headline put a summary of that headline on the article for every reader for fourteen days.
// These tests drive the real /summarize route with the model, the page reader and the database stood in.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, '..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

// The database: one entry per (url, kind), as the unique index makes it.
const rows = new Map();
stub('models/SummaryCache.js', {
  findOne: (q) => ({ lean: async () => rows.get(`${q.articleUrl}|${q.kind}`) || null }),
  updateOne: async (q, update) => {
    const key = `${q.articleUrl}|${q.kind}`;
    rows.set(key, { ...(rows.get(key) || {}), ...update.$set });
    return { acknowledged: true };
  }
});

// The model writes "SUMMARY OF: <what it was given>", so a test can see which text a summary came from.
stub('agents/summarizeAgent.js', async (body) => `SUMMARY OF: ${body}`);

// Pages the server can read. Any other address is a publisher that blocks reading, and the route falls
// back to the caller's text, as resolveArticleText does.
const READABLE = new Map();
const realText = require('../utils/articleText');
stub('utils/articleText.js', {
  ...realText,
  resolveArticleText: async ({ url, fallback }) => (READABLE.has(url)
    ? { text: READABLE.get(url), source: 'full', chars: READABLE.get(url).length }
    : { text: fallback, source: 'snippet', chars: String(fallback || '').length })
});

const router = require('../routes/aiRoutes');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'test'; next(); });
app.use('/', router);

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
test.beforeEach(() => { rows.clear(); READABLE.clear(); });

const summarize = async (body) => {
  const res = await fetch(`${base}/summarize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  return res.json();
};

const URL_A = 'https://news.example.com/2026/11/08/budget-session-opens';
const REAL_TITLE = 'Budget session of Parliament opens with debate on fuel prices';
const REAL_SNIPPET = 'The budget session of Parliament opened on Monday with opposition members demanding a debate on fuel prices and the new tax slabs.';
const FAKE = 'Prime Minister resigns after budget session collapses';

test('a headline someone made up is not served to readers who sent the real text', async () => {
  await summarize({ url: URL_A, title: FAKE, article: FAKE });
  const reader = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_SNIPPET });
  assert.doesNotMatch(reader.summary, /resigns/);
  assert.match(reader.summary, /budget session of Parliament opened/);
});

test('text someone sent is not served to a reader who reopens the story with only its headline', async () => {
  await summarize({ url: URL_A, title: REAL_TITLE, article: `${FAKE}. Sources say the cabinet will be dissolved by evening.` });
  const reopened = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_TITLE });
  assert.doesNotMatch(reopened.summary, /resigns|dissolved/);
});

test('a reader who sends the same text as the stored summary still gets it from the cache', async () => {
  const first = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_SNIPPET });
  const second = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_SNIPPET });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.summary, first.summary);
});

test('a summary of the publisher\'s own page is shared with every reader, headline-only reopens included', async () => {
  READABLE.set(URL_A, `${REAL_SNIPPET} The finance minister will present the budget on Thursday. `.repeat(8));
  const first = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_SNIPPET });
  const reopened = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_TITLE });
  assert.equal(reopened.cached, true);
  assert.equal(reopened.summary, first.summary);
});

test('a headline-only reopen does not overwrite a stored summary it may not see', async () => {
  await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_SNIPPET });
  await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_TITLE });
  const again = await summarize({ url: URL_A, title: REAL_TITLE, article: REAL_SNIPPET });
  assert.equal(again.cached, true, 'the snippet reader\'s entry survives the headline-only visit');
});
