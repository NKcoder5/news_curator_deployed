// Which claims the public registry shows (services/registryPolicy.js).
//
// The rule is written twice, as a database filter for the registry's queries and as a function for the
// check page. These tests evaluate the filter the way MongoDB does, for the operators it uses, and hold
// the two to the same answer on every combination of origin, verdict and evidence count.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTLED_CALLS, publicFilter, isPublicClaim } = require('../services/registryPolicy');
const registry = require('../services/claimRegistry');

const valueAt = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const condition = (value, cond) => {
  if (cond === null) return value === null || value === undefined;   // { field: null } matches missing too
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$ne') return value !== arg;
      if (op === '$in') return arg.includes(value);
      if (op === '$gt') return typeof value === 'number' && value > arg;
      throw new Error(`operator ${op} not modelled`);
    });
  }
  return value === cond;
};
const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
  if (key === '$or') return cond.some(f => matches(doc, f));
  if (key === '$and') return cond.every(f => matches(doc, f));
  return condition(valueAt(doc, key), cond);
});

const ORIGINS = ['user', 'recheck', 'eval', undefined];
const CALLS = [...SETTLED_CALLS, 'CANNOT VERIFY', null];
const COUNTS = [undefined, null, 0, 1, 7];

test('the database filter and the check page agree on every claim', () => {
  let shown = 0;
  for (const origin of ORIGINS) {
    for (const call of CALLS) {
      for (const evidenceCount of COUNTS) {
        const current = { call };
        if (evidenceCount !== undefined) current.evidenceCount = evidenceCount;
        const doc = { origin, current };
        const byFilter = matches(doc, publicFilter());
        assert.strictEqual(byFilter, isPublicClaim({ origin, call, evidenceCount }), JSON.stringify(doc));
        if (byFilter) shown++;
      }
    }
  }
  assert.ok(shown > 0);
});

test('what is published and what is not', () => {
  assert.equal(isPublicClaim({ origin: 'user', call: 'FAKE', evidenceCount: 3 }), true);
  assert.equal(isPublicClaim({ origin: 'recheck', call: 'REAL', evidenceCount: 1 }), true, 'a re-check that settled a claim publishes it');
  assert.equal(isPublicClaim({ origin: 'user', call: 'CANNOT VERIFY', evidenceCount: 4 }), false, 'unsettled, however much was found');
  assert.equal(isPublicClaim({ origin: 'user', call: 'MISLEADING', evidenceCount: 0 }), false, 'settled on nothing a reader can open');
  assert.equal(isPublicClaim({ origin: 'eval', call: 'REAL', evidenceCount: 5 }), false, 'test data');
  assert.equal(isPublicClaim({ origin: 'user', call: 'REAL' }), true, 'a record from before the count existed keeps its page');
});

test('each query gets its own filter, so one query cannot change another\'s', () => {
  const a = publicFilter();
  a['current.call'].$in.push('CANNOT VERIFY');
  a.$or.length = 0;
  assert.deepEqual(publicFilter()['current.call'].$in, SETTLED_CALLS);
  assert.equal(publicFilter().$or.length, 2);
});

test('every registry list starts from the public rule, and only settled verdicts can be asked for', () => {
  const { buildListFilter, parseListQuery } = registry.__test;
  assert.deepEqual(buildListFilter(parseListQuery({})), publicFilter());
  assert.deepEqual(buildListFilter(parseListQuery({ q: 'medals', call: 'fake' })).$and[0], publicFilter());
  assert.throws(() => parseListQuery({ call: 'CANNOT VERIFY' }), (err) => err.status === 400 && /"call" must be one of REAL, FAKE, PARTLY FALSE, MISLEADING/.test(err.message));
});
