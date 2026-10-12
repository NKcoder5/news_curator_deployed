// The claim memory, split so the reader does not wait on it.
//
// A check used to file itself between the verdict and the reader: look the
// claims up (up to three model calls for an ambiguous match), then write the
// records and the assessment, then answer. Now the lookup runs beside the
// evidence and the write after the answer. These tests hold the split to two
// promises: the page is told exactly what is then stored, and nothing is
// stored before the write.
//
// The models run on an in-memory stand-in for MongoDB: real Mongoose
// documents and casting, with the few queries the memory makes answered from
// a Map, so no database is needed.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const ClaimRecord = require('../models/ClaimRecord');
const ClaimAssessment = require('../models/ClaimAssessment');
const { signatureOf } = require('../services/claimSignature');

/* ---------------------------------------------------------------------------
   An in-memory stand-in for the two collections
--------------------------------------------------------------------------- */

const db = { records: new Map(), assessments: new Map() };
const plain = (doc) => JSON.parse(JSON.stringify(doc));
const asDoc = (raw) => { const d = new ClaimRecord(plain(raw)); d.isNew = false; return d; };
const query = (run) => {
  const q = { n: Infinity, isLean: false };
  q.sort = () => q;
  q.limit = (n) => { q.n = n; return q; };
  q.select = () => q;
  q.lean = () => { q.isLean = true; return q; };
  q.then = (ok, ko) => Promise.resolve().then(() => run(q)).then(ok, ko);
  return q;
};
const matches = (raw, filter) => Object.entries(filter).every(([path, cond]) => {
  const value = path.split('.').reduce((o, k) => (o == null ? o : o[k]), raw);
  if (cond && cond.$in) {
    const wanted = cond.$in.map(String);
    return Array.isArray(value) ? value.some(v => wanted.includes(String(v))) : wanted.includes(String(value));
  }
  return String(value) === String(cond);
});
const saved = {
  findOne: ClaimRecord.findOne, find: ClaimRecord.find, findById: ClaimRecord.findById, updateMany: ClaimRecord.updateMany,
  save: ClaimRecord.prototype.save, create: ClaimAssessment.create, assessmentById: ClaimAssessment.findById
};
ClaimRecord.findOne = (filter) => query(() => {
  const raw = [...db.records.values()].find(r => matches(r, filter));
  return raw ? asDoc(raw) : null;
});
ClaimRecord.find = (filter) => query((q) => [...db.records.values()].filter(r => matches(r, filter)).slice(0, q.n)
  .map(raw => (q.isLean ? plain(raw) : asDoc(raw))));
ClaimRecord.findById = (id) => query((q) => {
  const raw = db.records.get(String(id));
  return raw ? (q.isLean ? plain(raw) : asDoc(raw)) : null;
});
ClaimRecord.updateMany = async (filter, update) => {
  for (const raw of db.records.values()) {
    if (!matches(raw, filter)) continue;
    for (const [k, v] of Object.entries(update.$inc || {})) raw[k] = (raw[k] || 0) + v;
    Object.assign(raw, plain(update.$set || {}));
  }
};
// Saving enforces the unique key, as the real index does.
ClaimRecord.prototype.save = async function save() {
  const clash = [...db.records.values()].find(r => r.key === this.key && String(r._id) !== String(this._id));
  if (clash) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
  db.records.set(String(this._id), plain(this.toObject()));
  return this;
};
ClaimAssessment.create = async (doc) => {
  const cast = new ClaimAssessment(doc);
  db.assessments.set(String(cast._id), plain(cast.toObject()));
  return cast;
};
ClaimAssessment.findById = (id) => query(() => {
  const raw = db.assessments.get(String(id));
  return raw ? plain(raw) : null;
});

// The memory, loaded over a connection that reports itself open, with the
// model that settles ambiguous matches replaced by a counter.
const MEMORY_PATH = require.resolve('../services/claimMemory');
const JUDGE_PATH = require.resolve('../services/claimMatchJudge');
const MONGOOSE_PATH = require.resolve('mongoose');
const judged = [];
const realJudge = require.cache[JUDGE_PATH];
const realMongoose = require.cache[MONGOOSE_PATH];
require.cache[JUDGE_PATH] = { id: JUDGE_PATH, filename: JUDGE_PATH, loaded: true, exports: { sameClaim: async (a, b) => { judged.push([a, b]); return false; } } };
require.cache[MONGOOSE_PATH] = { ...realMongoose, exports: Object.create(mongoose, { connection: { value: { readyState: 1 } } }) };
delete require.cache[MEMORY_PATH];
const memory = require(MEMORY_PATH);
require.cache[MONGOOSE_PATH] = realMongoose;
if (realJudge) require.cache[JUDGE_PATH] = realJudge; else delete require.cache[JUDGE_PATH];

test.after(() => {
  Object.assign(ClaimRecord, { findOne: saved.findOne, find: saved.find, findById: saved.findById, updateMany: saved.updateMany });
  ClaimRecord.prototype.save = saved.save;
  ClaimAssessment.create = saved.create;
  ClaimAssessment.findById = saved.assessmentById;
  delete require.cache[MEMORY_PATH];
});

/* ---------------------------------------------------------------------------
   Fixtures
--------------------------------------------------------------------------- */

const CLAIM = 'India won 84 medals at the Asian Games 2026.';
const reportFor = (claim, call, rule, extra = {}) => ({
  call, oneLine: `${call} because.`, verdictClass: call === 'REAL' ? 'corroborated' : 'unverified', schemaVersion: 5,
  decision: { rule, verdict: call === 'REAL' ? 'corroborated' : 'unverified', confidence: 0.8 },
  evidence: { perClaim: [{ claim, independentSupport: call === 'REAL' ? 2 : 0, independentContradiction: 0 }] },
  factors: [{ id: 'verification', detail: { claims: [{ claim, supportingEvidence: call === 'REAL' ? [{ source: 'The Hindu', url: 'https://thehindu.test/a', title: 'India 84 medals' }, { source: 'NDTV', url: 'https://ndtv.test/a', title: 'India 84 medals' }] : [], contradictingEvidence: [] }] } }],
  ...extra
});
const ledgerFor = (claim) => ({ claims: [{ claim, verdict: 'x', supportingEvidence: [], contradictingEvidence: [] }], asOf: Date.parse('2026-10-12T10:00:00Z') });
const understandingFor = (claim) => ({ language: 'en', speechAct: 'assertion', checkableClaims: [{ claim, subject: 'Asian Games India' }], claims: [{ claim, subject: 'Asian Games India' }] });

const seedRecord = (claim, fields = {}) => {
  const sig = signatureOf(claim);
  const doc = new ClaimRecord({ key: sig.key, claim, signature: { entities: sig.entities, numbers: sig.numbers, years: sig.years, terms: sig.terms, negated: sig.negated },
    origin: 'user', timesSeen: 2, firstSeenAt: new Date('2026-10-12T08:00:00Z'), ...fields });
  db.records.set(String(doc._id), plain(doc.toObject()));
  return doc;
};
const seedAssessment = (fields) => {
  const doc = new ClaimAssessment(fields);
  db.assessments.set(String(doc._id), plain(doc.toObject()));
  return doc;
};
const reset = () => { db.records.clear(); db.assessments.clear(); judged.length = 0; };

/* ---------------------------------------------------------------------------
   Tests
--------------------------------------------------------------------------- */

test('the page is told what the memory knew before anything is written, and the write stores exactly that', async () => {
  reset();
  const earlier = seedAssessment({ call: 'CANNOT VERIFY', rule: 'no-independent-coverage', evidence: [], versions: { engine: memory.ENGINE_VERSION } });
  const record = seedRecord(CLAIM, { current: { call: 'CANNOT VERIFY', status: 'unreported', oneLine: 'Nothing yet.', at: new Date('2026-10-12T08:00:00Z'), assessmentId: earlier._id } });

  const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: understandingFor(CLAIM), trigger: 'user' });
  const prepared = memory.prepareRecord(plan, { report: reportFor(CLAIM, 'REAL', 'corroborated-by-multiple-independent-sources'),
    understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), messageText: 'india won 84 medals!!', trigger: 'user' });

  const told = prepared.memory;
  assert.strictEqual(told.claims[0].claimId, String(record._id));
  assert.strictEqual(told.claims[0].timesSeen, 3);
  assert.strictEqual(told.claims[0].previous.call, 'CANNOT VERIFY');
  assert.strictEqual(told.claims[0].recheckDue, null, 'a settled verdict books no re-check');
  assert.match(told.changeReason, /^Verdict changed from CANNOT VERIFY to REAL: 2 new sources confirm it \(The Hindu and NDTV\)\.$/);

  // Nothing has been written yet.
  assert.strictEqual(db.assessments.size, 1);
  assert.strictEqual(db.records.get(String(record._id)).timesSeen, 2);

  await prepared.write();
  const stored = db.assessments.get(told.assessmentId);
  assert.ok(stored, 'the assessment is stored under the id the page was given');
  assert.strictEqual(stored.call, 'REAL');
  assert.strictEqual(stored.changeReason, told.changeReason);
  assert.strictEqual(String(stored.supersedes), String(earlier._id));
  assert.deepStrictEqual(stored.claimIds.map(String), [String(record._id)]);
  assert.strictEqual(stored.messageHash, memory.fingerprint('india won 84 medals!!'));
  const after = db.records.get(String(record._id));
  assert.strictEqual(after.timesSeen, told.claims[0].timesSeen);
  assert.strictEqual(String(after.current.assessmentId), told.assessmentId);
  assert.strictEqual(after.current.call, 'REAL');
});

test('a new claim gets a record the page can link before it exists, booked for a re-check if unsettled', async () => {
  reset();
  const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: understandingFor(CLAIM), trigger: 'user' });
  const prepared = memory.prepareRecord(plan, { report: reportFor(CLAIM, 'CANNOT VERIFY', 'no-independent-coverage'),
    understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), trigger: 'user' });
  const told = prepared.memory.claims[0];
  assert.strictEqual(db.records.size, 0);
  assert.strictEqual(told.timesSeen, 1);
  assert.strictEqual(told.previous, null);
  assert.ok(told.recheckDue instanceof Date);

  await prepared.write();
  const stored = db.records.get(told.claimId);
  assert.ok(stored, 'stored under the id the page was given');
  assert.strictEqual(stored.timesSeen, 1);
  assert.strictEqual(new Date(stored.recheck.due).getTime(), told.recheckDue.getTime());
  assert.deepStrictEqual(stored.subjects, ['Asian Games India']);
});

test('claims filed by an evaluation run are never booked for a re-check', async () => {
  reset();
  const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: understandingFor(CLAIM), trigger: 'eval' });
  const prepared = memory.prepareRecord(plan, { report: reportFor(CLAIM, 'CANNOT VERIFY', 'no-independent-coverage'),
    understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), trigger: 'eval' });
  assert.strictEqual(prepared.memory.claims[0].recheckDue, null);
  await prepared.write();
  assert.strictEqual(db.records.get(prepared.memory.claims[0].claimId).origin, 'eval');
});

test('a claim another check filed in the meantime is joined, not failed', async () => {
  reset();
  const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: understandingFor(CLAIM), trigger: 'user' });
  const prepared = memory.prepareRecord(plan, { report: reportFor(CLAIM, 'REAL', 'corroborated-by-multiple-independent-sources'),
    understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), trigger: 'user' });
  // Another reader's check of the same new claim is written first.
  const other = seedRecord(CLAIM, { timesSeen: 1 });

  await prepared.write();
  assert.strictEqual(db.records.size, 1);
  const stored = db.assessments.get(prepared.memory.assessmentId);
  assert.deepStrictEqual(stored.claimIds.map(String), [String(other._id)]);
  assert.strictEqual(db.records.get(String(other._id)).timesSeen, 2);
});

test('the record is read again before it is changed, so a check filed meanwhile is not overwritten', async () => {
  reset();
  const record = seedRecord(CLAIM, { timesSeen: 4 });
  const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: understandingFor(CLAIM), trigger: 'user' });
  const prepared = memory.prepareRecord(plan, { report: reportFor(CLAIM, 'REAL', 'corroborated-by-multiple-independent-sources'),
    understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), trigger: 'user' });
  db.records.get(String(record._id)).timesSeen = 5;   // another check landed while this one ran
  await prepared.write();
  assert.strictEqual(db.records.get(String(record._id)).timesSeen, 6);
});

test('recordCheck in one call stores what the lookup and the write store apart', async () => {
  const run = async (apart) => {
    reset();
    seedRecord('India won 85 medals at the Asian Games 2026.', { timesSeen: 1 });   // a variant: a different figure
    const args = { report: reportFor(CLAIM, 'FAKE', 'contradicted-by-multiple-independent-sources'),
      understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), messageText: 'msg', trigger: 'user', modality: 'text' };
    let told;
    if (apart) {
      const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: args.understanding, trigger: 'user' });
      const prepared = memory.prepareRecord(plan, args);
      told = prepared.memory;
      await prepared.write();
    } else {
      told = await memory.recordCheck(args);
    }
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (['_id', 'assessmentId', 'claimId', 'claimIds', 'at', 'firstSeenAt', 'lastSeenAt', 'createdAt', 'asOf', 'due'].includes(k) ? undefined : v)));
    return { told: strip(told), records: strip([...db.records.values()]), assessments: strip([...db.assessments.values()]) };
  };
  const together = await run(false);
  const apart = await run(true);
  assert.deepStrictEqual(apart, together);
  assert.strictEqual(together.told.claims[0].variants.length, 1, 'the 85-medal record is linked as a variant');
});

test('a stored check stays current until a later check of the claim is filed', async () => {
  reset();
  const file = async (call) => {
    const plan = await memory.lookupClaims({ claims: [CLAIM], understanding: understandingFor(CLAIM), trigger: 'user' });
    const prepared = memory.prepareRecord(plan, { report: reportFor(CLAIM, call, 'r'), understanding: understandingFor(CLAIM), ledgerInput: ledgerFor(CLAIM), trigger: 'user' });
    await prepared.write();
    return prepared;
  };
  const first = await file('REAL');
  assert.deepStrictEqual(await memory.stillCurrent(first.recordIds, first.assessmentId), [1]);
  await memory.noteSeenAgain(first.recordIds);
  assert.deepStrictEqual(await memory.stillCurrent(first.recordIds, first.assessmentId), [2]);
  await file('REAL');
  assert.strictEqual(await memory.stillCurrent(first.recordIds, first.assessmentId), null);
});
