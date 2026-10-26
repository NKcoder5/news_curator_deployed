// Defects found in the final code review, each held down by the case that
// exposed it. No network, no model and no database.
const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------- caching

const { isCompleteReport, isUsableCachedReport, printOf } = require('../routes/aiRoutes').__test;
const { REPORT_SCHEMA_VERSION } = require('../agents/trustAnalysisAgent');

// "Too recent to check" is true today and false tomorrow. Cached for fourteen
// days, it would go on telling readers a week-old story could not be checked.
test('a too-recent verdict is never cached', () => {
  assert.equal(isCompleteReport({ decision: { rule: 'too-recent-to-corroborate' }, degradedFactors: [] }), false);
  assert.equal(isCompleteReport({ decision: { rule: 'corroborated-by-multiple-independent-sources' }, degradedFactors: [] }), true);
});

// Reopening an article from the reading history sends only its headline.
// Fingerprinting the headline missed the cache and paid for a second analysis
// of a story already analysed.
test('a request carrying only the headline reuses the stored verdict', () => {
  const cached = { report: { schemaVersion: REPORT_SCHEMA_VERSION }, sourcePrint: 'print-of-the-real-body' };
  const title = 'Five arrested near RAF Fairford';
  assert.equal(printOf(title, title), null, 'a headline is not a body');
  assert.equal(printOf('', title), null);
  assert.equal(isUsableCachedReport(cached, printOf(title, title)), true);
});

test('a changed body still invalidates the stored verdict', () => {
  const cached = { report: { schemaVersion: REPORT_SCHEMA_VERSION }, sourcePrint: 'print-of-the-old-body' };
  const newBody = 'The publisher rewrote this story overnight and it now says something quite different from before.';
  assert.notEqual(printOf(newBody, 'Headline'), null);
  assert.equal(isUsableCachedReport(cached, printOf(newBody, 'Headline')), false);
});

test('a body cannot reuse a current but un-fingerprinted verdict', () => {
  const cached = { report: { schemaVersion: REPORT_SCHEMA_VERSION } };
  const body = 'The publisher rewrote this story overnight and it now says something quite different from before.';
  assert.equal(isUsableCachedReport(cached, printOf(body, 'Headline')), false);
});

// ----------------------------------------------------------- endpoint access

const apiAccess = require('../middleware/apiAccess');

const call = (headers) => new Promise((resolve) => {
  const req = { header: (name) => headers[name.toLowerCase()] };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); }
  };
  apiAccess(req, res, () => resolve({ status: 'passed' }));
});

// The analysis endpoints spend the day's news quota. They were open to anyone
// who could reach the server.
test('the analysis endpoints refuse a caller with no login', async () => {
  const outcome = await call({});
  assert.equal(outcome.status, 401);
});

test('the evaluation key opens them, and only the right key', async () => {
  const saved = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = 'a-long-test-key-0123456789';
  try {
    assert.equal((await call({ 'x-internal-key': 'a-long-test-key-0123456789' })).status, 'passed');
    assert.equal((await call({ 'x-internal-key': 'a-long-test-key-0123456780' })).status, 401);
  } finally {
    if (saved === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = saved;
  }
});

test('with no key configured, the key route is closed', async () => {
  const saved = process.env.INTERNAL_API_KEY;
  delete process.env.INTERNAL_API_KEY;
  try {
    assert.equal((await call({ 'x-internal-key': 'anything' })).status, 401);
  } finally {
    if (saved !== undefined) process.env.INTERNAL_API_KEY = saved;
  }
});

// ------------------------------------------------------------------ accounts

const { signup, login } = require('../controllers/authController');

const respond = (handler, body) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode, payload }); }
  };
  handler({ body }, res);
});

// A missing password reached bcrypt and came back as a server error; the page's
// eight-character rule was not held by the server at all.
test('signup rejects what the signup page rejects, before touching the database', async () => {
  assert.equal((await respond(signup, { email: 'not-an-email', password: 'longenough1' })).status, 400);
  assert.equal((await respond(signup, { email: 'reader@example.test', password: 'short' })).status, 400);
  assert.equal((await respond(signup, { email: 'reader@example.test' })).status, 400);
});

test('login asks for both fields rather than failing on a missing one', async () => {
  assert.equal((await respond(login, { email: '' , password: '' })).status, 400);
});
