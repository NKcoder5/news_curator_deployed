// The public claims registry: what may leave the claim memory, how a list is
// searched and paged, and the read-only routes. No database and no network
// beyond a loopback socket: the pure parts are called directly and the routes
// are served over a stubbed registry.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const registry = require('../services/claimRegistry');
const { buildRouter } = require('../routes/claimRoutes');
const table = require('../data/ruleReliability.json');

const {
  isValidId, parseListQuery, parseLimit, encodeCursor, decodeCursor, escapeRegex, searchTerms,
  buildListFilter, safeUrl, summariseRecord, evidenceFor, serialiseDetail
} = registry.__test;

const ID = '65f0a1b2c3d4e5f607182930';
const rejects = (fn, status) => assert.throws(fn, (err) => err instanceof registry.RegistryError && err.status === status);

// ------------------------------------------------------------ query strings --

test('a list request with nothing in it asks for the newest twenty', () => {
  const p = parseListQuery({});
  assert.deepStrictEqual({ ...p }, { q: '', call: null, sort: 'recent', limit: 20, cursor: null });
});

test('a page is never longer than fifty claims, however many are asked for', () => {
  assert.strictEqual(parseListQuery({ limit: '50' }).limit, 50);
  assert.strictEqual(parseListQuery({ limit: '5000' }).limit, registry.MAX_LIMIT);
});

test('bad parameters are refused with a 400 that names them', () => {
  for (const limit of ['0', '-3', 'abc', '2.5', '1e3']) rejects(() => parseListQuery({ limit }), 400);
  rejects(() => parseListQuery({ call: 'MAYBE' }), 400);
  rejects(() => parseListQuery({ sort: 'random' }), 400);
  rejects(() => parseListQuery({ q: 'x'.repeat(101) }), 400);
  // ?q=a&q=b arrives as an array; it is neither a search nor safe to splice into a pattern.
  rejects(() => parseListQuery({ q: ['a', 'b'] }), 400);
  rejects(() => parseListQuery({ limit: ['1', '2'] }), 400);
  assert.throws(() => parseListQuery({ call: 'MAYBE' }), /"call" must be one of/);
});

test('the call filter ignores case and the search is trimmed', () => {
  const p = parseListQuery({ call: 'partly false', q: '  asian games  ' });
  assert.strictEqual(p.call, 'PARTLY FALSE');
  assert.strictEqual(p.q, 'asian games');
  // A claim the desks found misleading is filed MISLEADING, and can be listed by it.
  assert.strictEqual(parseListQuery({ call: 'misleading' }).call, 'MISLEADING');
});

test('ids are 24 hex digits and nothing else', () => {
  assert.strictEqual(isValidId(ID), true);
  for (const bad of ['', 'abc', ID + '0', 'zzzzzzzzzzzzzzzzzzzzzzzz', '{"$ne":null}', undefined, null, 12]) {
    assert.strictEqual(isValidId(bad), false);
  }
  assert.strictEqual(parseLimit(undefined, 10), 10);
});

// ------------------------------------------------------------------ search --

test('search text is escaped, so characters in it are searched for and never run as a pattern', () => {
  assert.strictEqual(escapeRegex('a.b*c(d)[e]'), 'a\\.b\\*c\\(d\\)\\[e\\]');
  const filter = buildListFilter(parseListQuery({ q: '(((' }));
  const re = filter.$and[1].$or[0].claim;
  assert.ok(re.test('a claim with ((( in it'));
  assert.ok(!re.test('a claim without'));
  // ".*" must not match everything.
  const dot = buildListFilter(parseListQuery({ q: '.*' })).$and[1].$or[0].claim;
  assert.ok(!dot.test('India won 84 medals'));
  assert.ok(dot.test('a literal .* here'));
});

test('every word of a search must be found, in any case and any order', () => {
  const filter = buildListFilter(parseListQuery({ q: 'MEDALS india' }));
  const [, first, second] = filter.$and;
  assert.ok(first.$or[0].claim.test('India won 84 medals at the Asian Games'));
  assert.ok(second.$or[0].claim.test('India won 84 medals at the Asian Games'));
  assert.deepStrictEqual(searchTerms('  Same same  SAME '), ['same']);
  assert.strictEqual(searchTerms('a b c d e f g h').length, 6);
});

test('test data from the evaluation suites is excluded from every listing', () => {
  const plain = buildListFilter(parseListQuery({}));
  assert.deepStrictEqual(plain, { origin: { $ne: 'eval' } });
  const filtered = buildListFilter(parseListQuery({ q: 'medals', call: 'FAKE' }));
  assert.deepStrictEqual(filtered.$and[0], { origin: { $ne: 'eval' } });
  assert.deepStrictEqual(filtered.$and[1], { 'current.call': 'FAKE' });
});

// ------------------------------------------------------------------ cursors --

const row = (id, lastSeenAt, timesSeen = 1) => ({ _id: id, lastSeenAt: new Date(lastSeenAt), timesSeen });

test('a cursor carries the position of the last row and survives the round trip', () => {
  const recent = decodeCursor(encodeCursor('recent', row(ID, 1760000000000)), 'recent');
  assert.deepStrictEqual({ ...recent, lastSeenAt: recent.lastSeenAt.getTime() }, { lastSeenAt: 1760000000000, id: ID });
  const checked = decodeCursor(encodeCursor('checked', row(ID, 1760000000000, 7)), 'checked');
  assert.strictEqual(checked.timesSeen, 7);
  assert.strictEqual(checked.id, ID);
});

test('a cursor that is damaged, forged or from another list is refused', () => {
  const good = encodeCursor('recent', row(ID, 1760000000000));
  rejects(() => decodeCursor(good, 'checked'), 400);
  rejects(() => decodeCursor('not a cursor!', 'recent'), 400);
  rejects(() => decodeCursor('x'.repeat(300), 'recent'), 400);
  rejects(() => decodeCursor(good.slice(0, -4), 'recent'), 400);
  const forge = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');
  rejects(() => decodeCursor(forge({ s: 'recent', k: [1760000000000, '{"$gt":""}'] }), 'recent'), 400);
  rejects(() => decodeCursor(forge({ s: 'recent', k: [{ $gt: 0 }, ID] }), 'recent'), 400);
  rejects(() => decodeCursor(forge({ s: 'recent', k: [-5, ID] }), 'recent'), 400);
  rejects(() => parseListQuery({ cursor: 'garbage' }), 400);
});

// A small evaluator for exactly the filter shapes the registry builds, so that
// paging can be run end to end over rows with tied sort keys.
const keyOf = (v) => (v instanceof Date ? v.getTime() : v instanceof mongoose.Types.ObjectId ? v.toString() : v);
const lt = (a, b) => keyOf(a) < keyOf(b);
const same = (a, b) => keyOf(a) === keyOf(b);
const matches = (doc, filter) => Object.entries(filter).every(([field, cond]) => {
  if (field === '$or') return cond.some(c => matches(doc, c));
  if (field === '$and') return cond.every(c => matches(doc, c));
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId)) {
    if ('$lt' in cond) return lt(doc[field], cond.$lt);
    if ('$ne' in cond) return !same(doc[field], cond.$ne);
  }
  return same(doc[field], cond);
});
// Descending on every key, as the registry sorts.
const descending = (spec) => (a, b) => {
  for (const key of Object.keys(spec)) {
    if (!same(a[key], b[key])) return lt(a[key], b[key]) ? 1 : -1;
  }
  return 0;
};

for (const sort of ['recent', 'checked']) {
  test(`paging by ${sort} shows every claim once, even when claims share a time and a count`, () => {
    // Twelve claims, only three distinct times and two distinct counts.
    const rows = Array.from({ length: 12 }, (_, n) => row(
      new mongoose.Types.ObjectId(n + 1).toString(), 1760000000000 + (n % 3) * 1000, 1 + (n % 2)
    ));
    const spec = registry.__test.sortSpec(sort);
    const seen = [];
    let cursor = null;
    for (let pages = 0; pages < 10; pages++) {
      const filter = buildListFilter({ q: '', call: null, sort, cursor }, true);
      const page = rows.filter(r => matches(r, filter)).sort(descending(spec)).slice(0, 5);
      seen.push(...page.map(r => String(r._id)));
      if (page.length < 5) break;
      cursor = decodeCursor(encodeCursor(sort, page[page.length - 1]), sort);
    }
    assert.strictEqual(seen.length, 12);
    assert.strictEqual(new Set(seen).size, 12, 'no claim appears twice');
  });
}

// -------------------------------------------------------------- serialisers --

// Values planted in the stored documents; none may appear in what is served.
const PLANTED = ['HASH-SENTINEL', 'USER-SENTINEL', 'SIGNATURE-SENTINEL', 'PHRASING-SENTINEL'];
const PRIVATE_FIELDS = ['messageHash', 'ledgerInput', 'signature', 'phrasings', 'attempts', 'origin', 'key', 'subjects', 'userId', '_id', 'versions'];
const fieldsOf = (value) => (Array.isArray(value) ? value.flatMap(fieldsOf)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.entries(value).flatMap(([k, v]) => [k, ...fieldsOf(v)]) : []);
const assertNothingPrivate = (value) => {
  const text = JSON.stringify(value);
  for (const planted of PLANTED) assert.ok(!text.includes(planted), planted + ' must not leave the registry');
  const present = fieldsOf(value).filter(f => PRIVATE_FIELDS.includes(f));
  assert.deepStrictEqual(present, [], 'private fields must not leave the registry');
};

test('a listed claim carries the claim, its verdict and its counts, and nothing else', () => {
  const out = summariseRecord({
    _id: ID, key: 'sig-key', claim: 'India won 84 medals at the Asian Games 2026', origin: 'user',
    current: { call: 'REAL', oneLine: 'Two independent outlets report it.', rule: 'x', at: new Date('2026-10-12'), assessmentId: 'a' },
    timesSeen: 3, firstSeenAt: new Date('2026-10-01'), lastSeenAt: new Date('2026-10-12'), languages: ['en', 'ta'],
    signature: { entities: ['SIGNATURE-SENTINEL'] }, phrasings: [{ text: 'PHRASING-SENTINEL' }], subjects: ['sport'],
    recheck: { attempts: 2 }, messageHash: 'HASH-SENTINEL', userId: 'USER-SENTINEL'
  });
  assert.deepStrictEqual(Object.keys(out).sort(), [
    'call', 'claim', 'claimId', 'firstCheckedAt', 'languages', 'lastCheckedAt', 'oneLine', 'timesChecked', 'verdictAt'
  ]);
  assert.strictEqual(out.timesChecked, 3);
  assertNothingPrivate(out);
});

test('a claim that has no verdict yet is listed without one rather than failing', () => {
  const out = summariseRecord({ _id: ID, claim: 'A claim', timesSeen: 1 });
  assert.strictEqual(out.call, null);
  assert.deepStrictEqual(out.languages, []);
});

test('only web addresses are passed on as links', () => {
  assert.strictEqual(safeUrl('https://www.thehindu.com/news/a'), 'https://www.thehindu.com/news/a');
  assert.strictEqual(safeUrl('http://example.org/x'), 'http://example.org/x');
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'not a url', '', null, undefined]) {
    assert.strictEqual(safeUrl(bad), '');
  }
});

test('the evidence of a one-claim check is all of it; of a several-claim check, only that claim’s news', () => {
  const evidence = [
    { channel: 'news', side: 'for', claim: 'A', source: 'The Hindu', url: 'https://a.example/1', title: 't', reported: 'confirms it' },
    { channel: 'news', side: 'against', claim: 'B', source: 'NDTV', url: 'https://b.example/1' },
    { channel: 'factcheck', side: 'against', source: 'Factly', url: 'https://f.example/1', reported: 'False' }
  ];
  assert.strictEqual(evidenceFor({ perClaim: [{}], evidence }, 'A').length, 3);
  const multi = evidenceFor({ perClaim: [{}, {}], evidence }, 'A');
  assert.deepStrictEqual(multi.map(e => e.source), ['The Hindu']);
  assert.deepStrictEqual(Object.keys(multi[0]).sort(), ['channel', 'publishedAt', 'reported', 'side', 'source', 'title', 'url']);
  assert.deepStrictEqual(evidenceFor(null, 'A'), []);
});

const historyOf = (extra = {}) => ({
  claimId: ID, claim: 'India won 84 medals', firstSeenAt: new Date('2026-10-01'), lastSeenAt: new Date('2026-10-12'),
  timesSeen: 2, languages: ['en'],
  current: { call: 'REAL', oneLine: 'Reported.', at: new Date('2026-10-12') },
  recheck: { due: null, stage: 0, of: 3 },
  history: [
    { assessmentId: 'a1', at: new Date('2026-10-01'), trigger: 'user', call: 'CANNOT VERIFY', rule: 'no-independent-coverage', oneLine: 'Nothing found.', changeReason: null, evidence: { for: 0, against: 0, rulings: 0 } },
    { assessmentId: 'a2', at: new Date('2026-10-12'), trigger: 'recheck', call: 'REAL', rule: 'corroborated-by-multiple-independent-sources', oneLine: 'Reported.', changeReason: 'Verdict changed from CANNOT VERIFY to REAL.', evidence: { for: 2, against: 0, rulings: 0 } }
  ],
  ...extra
});

test('a claim page names the deciding rule with its measured record, from the table', () => {
  const rule = Object.keys(table.rules)[0];
  const out = serialiseDetail({
    history: historyOf(),
    assessment: { rule, perClaim: [{}], evidence: [] },
    variants: [{ claimId: 'v1', claim: 'India won 85 medals', call: 'FAKE', differences: ['85 instead of 84'] }]
  });
  assert.strictEqual(out.decidedBy.rule, rule);
  assert.strictEqual(out.decidedBy.trackRecord.n, table.rules[rule].n);
  assert.strictEqual(out.history.length, 2);
  assert.strictEqual(out.history[1].changeReason, 'Verdict changed from CANNOT VERIFY to REAL.');
  assert.strictEqual(out.variants[0].claim, 'India won 85 medals');
});

test('a part of a several-claim message has no deciding rule of its own', () => {
  const rule = Object.keys(table.rules)[0];
  const out = serialiseDetail({
    history: historyOf({ history: [{ ...historyOf().history[0], oneLine: null, rule }] }),
    assessment: { rule, perClaim: [{}, {}], evidence: [] },
    variants: []
  });
  assert.strictEqual(out.decidedBy, null);
  assert.strictEqual(out.history[0].rule, null);
});

test('nothing private leaves in a claim page, even when the stored documents carry it', () => {
  const polluted = historyOf({ messageHash: 'HASH-SENTINEL', ledgerInput: { claims: [] }, userId: 'USER-SENTINEL', recheck: { due: null, stage: 0, of: 3, attempts: 1 } });
  polluted.history[0].messageHash = 'HASH-SENTINEL';
  polluted.history[0].ledgerInput = { claims: [] };
  const out = serialiseDetail({
    history: polluted,
    assessment: {
      rule: 'x', perClaim: [{}], messageHash: 'HASH-SENTINEL', ledgerInput: {},
      evidence: [{ channel: 'news', side: 'for', source: 'S', url: 'javascript:alert(1)', title: 't', messageHash: 'HASH-SENTINEL' }]
    },
    variants: [{ claimId: 'v', claim: 'c', call: null, differences: [], key: 'k' }]
  });
  assertNothingPrivate(out);
  assert.strictEqual(out.evidence[0].url, '', 'a script address is not turned into a link');
});

// ------------------------------------------------------------------- routes --

const serve = async (stub, handler) => {
  const app = express();
  app.use('/api/claims', buildRouter({ RegistryError: registry.RegistryError, ...stub }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/claims`;
  try {
    await handler(async (path) => {
      const res = await fetch(base + path);
      return { status: res.status, headers: res.headers, body: await res.json() };
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

test('each read endpoint answers its own path and hands over the query string', async () => {
  const calls = [];
  const record = (name, body) => async (arg) => { calls.push([name, arg]); return body; };
  await serve({
    listClaims: record('list', { claims: [], total: 0, limit: 20, nextCursor: null }),
    trendingClaims: record('trending', { windowDays: 7, claims: [] }),
    changedVerdicts: record('changes', { changes: [] }),
    registryStats: record('stats', { claims: 0 }),
    claimDetail: record('detail', { claimId: ID })
  }, async (get) => {
    assert.strictEqual((await get('?q=medals&sort=checked')).status, 200);
    assert.strictEqual((await get('/trending?limit=3')).body.windowDays, 7);
    assert.deepStrictEqual((await get('/changes')).body, { changes: [] });
    assert.deepStrictEqual((await get('/stats')).body, { claims: 0 });
    assert.strictEqual((await get('/' + ID)).body.claimId, ID);
  });
  assert.deepStrictEqual(calls.map(c => c[0]), ['list', 'trending', 'changes', 'stats', 'detail']);
  assert.deepStrictEqual({ ...calls[0][1] }, { q: 'medals', sort: 'checked' });
  assert.deepStrictEqual({ ...calls[1][1] }, { limit: '3' });
  assert.strictEqual(calls[4][1], ID);
});

test('answers can be kept for a minute, errors cannot', async () => {
  await serve({
    listClaims: async () => ({ claims: [] }),
    claimDetail: async () => null
  }, async (get) => {
    assert.match((await get('')).headers.get('cache-control'), /public, max-age=60/);
    const missing = await get('/' + ID);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.headers.get('cache-control'), null);
  });
});

test('a refusal from the registry keeps its status and its words', async () => {
  await serve({
    listClaims: async () => { throw new registry.RegistryError('"limit" must be a whole number of at least 1.', 400); },
    registryStats: async () => { throw new registry.RegistryError('The claims registry is unavailable right now.', 503); }
  }, async (get) => {
    const bad = await get('?limit=0');
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /"limit"/);
    assert.strictEqual((await get('/stats')).status, 503);
  });
});

test('an unexpected failure is a 500 that does not repeat the error’s own words', async () => {
  const logged = console.error;
  console.error = () => {};
  try {
    await serve({ listClaims: async () => { throw new Error('connection string mongodb://user:pass@host failed'); } }, async (get) => {
      const res = await get('');
      assert.strictEqual(res.status, 500);
      assert.ok(!JSON.stringify(res.body).includes('mongodb'));
    });
  } finally {
    console.error = logged;
  }
});

test('the real registry refuses bad input before it looks at the database, and says so when it is down', async () => {
  await serve(registry, async (get) => {
    assert.strictEqual((await get('?limit=abc')).status, 400);
    assert.strictEqual((await get('?call=MAYBE')).status, 400);
    assert.strictEqual((await get('?cursor=garbage')).status, 400);
    assert.strictEqual((await get('/trending?limit=0')).status, 400);
    assert.strictEqual((await get('/not-an-id')).status, 400);
    // Valid requests, no database connected in this test.
    assert.strictEqual((await get('')).status, 503);
    assert.strictEqual((await get('/stats')).status, 503);
    assert.strictEqual((await get('/' + ID)).status, 503);
  });
});

test('an outlet is asked for by its host name, and anything else is refused', () => {
  const { parseHost } = registry.__test;
  assert.strictEqual(parseHost('www.TheHindu.com'), 'thehindu.com');
  assert.strictEqual(parseHost('indianexpress.com'), 'indianexpress.com');
  for (const bad of ['', 'localhost', 'thehindu', 'a/b.com', 'http://x.com', '$where.com', ['x.com'], 'x'.repeat(120) + '.com']) {
    rejects(() => parseHost(bad), 400);
  }
});

test('an outlet record counts each message once and says when there are too few checks to judge by', () => {
  const { summariseOutlet } = registry.__test;
  const rows = [{ call: 'REAL', at: '2026-10-10' }, { call: 'REAL', at: '2026-10-12' }, { call: 'FAKE', at: '2026-10-20' }];
  const out = summariseOutlet('example.com', rows, { matched: true, matchedName: 'Example', score: 7.5 });
  assert.deepStrictEqual(out.calls, { REAL: 2, FAKE: 1 });
  assert.strictEqual(out.checks, 3);
  assert.strictEqual(out.enough, false);
  assert.strictEqual(out.firstAt.slice(0, 10), '2026-10-10');
  assert.deepStrictEqual(out.published, { name: 'Example', score: 7.5 });
  assert.strictEqual(summariseOutlet('x.com', [], { matched: false }).published, null);
});
