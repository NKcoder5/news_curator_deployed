// backend/services/claimRegistry.js
//
// The claim memory read as a public registry: a searchable list of every claim
// the system has checked, one permanent page per claim, what is being checked
// most this week, and the verdicts that changed. This is what professional
// fact-checkers publish; the checks were already being kept (services/
// claimMemory.js), but only the reader who ran one could see the result.
//
// What leaves this file is the claim, its verdicts and its evidence, and
// nothing else. Records carry a signature key, a re-check schedule and, on the
// assessments behind them, a fingerprint of the message that produced the
// check; none of it is public. Every record is therefore passed through a
// serialiser that names the fields it keeps, rather than one that removes the
// fields it knows about, so a field added to the models later stays private
// until someone decides it should not.
//
// Records the evaluation scripts filed (origin 'eval') are test data and are
// left out of every listing and every count. They are also not found by id.
const mongoose = require('mongoose');
const ClaimRecord = require('../models/ClaimRecord');
const ClaimAssessment = require('../models/ClaimAssessment');
const { claimHistory } = require('./claimMemory');
const { trackRecordFor } = require('./ruleReliability');
const { getSourceReputation } = require('../agents/sourceReputationAgent');

const CALLS = ['REAL', 'FAKE', 'PARTLY FALSE', 'CANNOT VERIFY'];
const SORTS = ['recent', 'checked'];
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const SHORT_LIST = 10;
const MAX_QUERY_LENGTH = 100;
const MAX_TERMS = 6;
const WINDOW_DAYS = 7;
const DAY = 24 * 3600000;

// Test data from the evaluation suites. 'recheck' and 'user' are real claims.
const PUBLIC = { origin: { $ne: 'eval' } };
// What a reader did, as opposed to what the scheduler or a test run did.
const READER_CHECKS = { trigger: { $nin: ['eval', 'recheck'] } };

class RegistryError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const connected = () => mongoose.connection.readyState === 1;
const requireDatabase = () => {
  if (!connected()) throw new RegistryError('The claims registry is unavailable right now.', 503);
};

// ------------------------------------------------------------- validation --

const isValidId = (id) => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);

/** A string that is one value, not the array Express builds from a repeated key. */
const single = (value, name) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new RegistryError(`"${name}" must be given once, as plain text.`, 400);
  return value;
};

const parseLimit = (raw, fallback = DEFAULT_LIMIT) => {
  const value = single(raw, 'limit');
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new RegistryError('"limit" must be a whole number of at least 1.', 400);
  return Math.min(Number(value), MAX_LIMIT);
};

/**
 * Read and check the list endpoint's query string.
 * @throws {RegistryError} 400 naming the parameter that is wrong
 */
const parseListQuery = (query = {}) => {
  const q = (single(query.q, 'q') || '').trim();
  if (q.length > MAX_QUERY_LENGTH) throw new RegistryError(`"q" can be at most ${MAX_QUERY_LENGTH} characters.`, 400);

  const rawCall = single(query.call, 'call');
  const call = rawCall ? rawCall.trim().toUpperCase() : null;
  if (call && !CALLS.includes(call)) throw new RegistryError(`"call" must be one of ${CALLS.join(', ')}.`, 400);

  const sort = single(query.sort, 'sort') || 'recent';
  if (!SORTS.includes(sort)) throw new RegistryError(`"sort" must be one of ${SORTS.join(', ')}.`, 400);

  const limit = parseLimit(query.limit);
  const rawCursor = single(query.cursor, 'cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor, sort) : null;
  return { q, call, sort, limit, cursor };
};

// ----------------------------------------------------------------- cursor --

// Pages are cut by position in the sort order rather than by offset, so a
// claim checked while a reader is paging cannot push the next page's first
// row onto the previous one, or drop it. The position is the sort keys of the
// last row seen; the cursor is those keys, tagged with the sort they belong
// to, in an opaque string.
const encodeCursor = (sort, record) => {
  const keys = sort === 'checked'
    ? [record.timesSeen || 0, new Date(record.lastSeenAt).getTime(), String(record._id)]
    : [new Date(record.lastSeenAt).getTime(), String(record._id)];
  return Buffer.from(JSON.stringify({ s: sort, k: keys })).toString('base64url');
};

const badCursor = () => new RegistryError('"cursor" is not valid for this list; start again from the first page.', 400);

const decodeCursor = (text, sort) => {
  if (text.length > 200 || !/^[A-Za-z0-9_-]+$/.test(text)) throw badCursor();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch (_) {
    throw badCursor();
  }
  const keys = parsed && parsed.s === sort && Array.isArray(parsed.k) ? parsed.k : null;
  const wanted = sort === 'checked' ? 3 : 2;
  if (!keys || keys.length !== wanted || !isValidId(keys[wanted - 1])) throw badCursor();
  const numbers = keys.slice(0, wanted - 1);
  if (!numbers.every(n => Number.isInteger(n) && n >= 0)) throw badCursor();
  return sort === 'checked'
    ? { timesSeen: numbers[0], lastSeenAt: new Date(numbers[1]), id: keys[2] }
    : { lastSeenAt: new Date(numbers[0]), id: keys[1] };
};

// ----------------------------------------------------------- query building --

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words of a search, each of which a claim must contain. */
const searchTerms = (q) => [...new Set(String(q || '').toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_TERMS);

const sortSpec = (sort) => (sort === 'checked'
  ? { timesSeen: -1, lastSeenAt: -1, _id: -1 }
  : { lastSeenAt: -1, _id: -1 });

/** Rows after the cursor's row, in the list's sort order. */
const afterCursor = (sort, cursor) => {
  const id = new mongoose.Types.ObjectId(cursor.id);
  if (sort === 'checked') {
    return { $or: [
      { timesSeen: { $lt: cursor.timesSeen } },
      { timesSeen: cursor.timesSeen, lastSeenAt: { $lt: cursor.lastSeenAt } },
      { timesSeen: cursor.timesSeen, lastSeenAt: cursor.lastSeenAt, _id: { $lt: id } }
    ] };
  }
  return { $or: [
    { lastSeenAt: { $lt: cursor.lastSeenAt } },
    { lastSeenAt: cursor.lastSeenAt, _id: { $lt: id } }
  ] };
};

/**
 * The Mongo filter for a list request. The search text is escaped, so a
 * reader typing "(" or ".*" searches for those characters instead of building
 * a pattern; every word must appear in the claim, one of the ways it has been
 * worded, or its subject.
 * @param {Object} params - from parseListQuery
 * @param {boolean} [withCursor] - false for the count, which ignores the page
 */
const buildListFilter = ({ q, call, sort, cursor }, withCursor = true) => {
  const clauses = [PUBLIC];
  if (call) clauses.push({ 'current.call': call });
  for (const term of searchTerms(q)) {
    const re = new RegExp(escapeRegex(term), 'i');
    clauses.push({ $or: [{ claim: re }, { 'phrasings.text': re }, { subjects: re }] });
  }
  if (withCursor && cursor) clauses.push(afterCursor(sort, cursor));
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

// ------------------------------------------------------------- serialisers --

/** Only an address a browser will open as a web page; anything else is dropped. */
const safeUrl = (url) => {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch (_) {
    return '';
  }
};

const LIST_FIELDS = 'claim current.call current.oneLine current.at timesSeen firstSeenAt lastSeenAt languages';

const summariseRecord = (r) => ({
  claimId: String(r._id),
  claim: r.claim,
  call: r.current?.call || null,
  oneLine: r.current?.oneLine || null,
  verdictAt: r.current?.at || null,
  timesChecked: r.timesSeen || 0,
  firstCheckedAt: r.firstSeenAt || null,
  lastCheckedAt: r.lastSeenAt || null,
  languages: Array.isArray(r.languages) ? r.languages.map(String) : []
});

const serialiseEvidence = (e) => ({
  channel: String(e.channel || ''),
  side: e.side === 'for' ? 'for' : 'against',
  source: e.source || '',
  title: e.title || '',
  url: safeUrl(e.url),
  reported: e.reported || '',
  publishedAt: e.publishedAt || ''
});

/**
 * The evidence a claim's verdict rests on. A message with several claims was
 * judged claim by claim from the news found for each one, so only that news is
 * this claim's evidence; the fact-checker, reference and weekly-coverage
 * findings belong to the message as a whole and are shown only when the check
 * was of this claim alone.
 */
const evidenceFor = (assessment, claim) => {
  const all = assessment?.evidence || [];
  const own = (assessment?.perClaim || []).length > 1
    ? all.filter(e => e.channel === 'news' && e.claim === claim)
    : all;
  return own.map(serialiseEvidence);
};

/**
 * The page of one claim: the history claimMemory keeps, the evidence of the
 * latest check, the rule that decided it with its measured record, and
 * related wordings.
 */
const serialiseDetail = ({ history, assessment, variants }) => {
  const rule = assessment?.rule && assessment.rule !== 'per-claim' && (assessment.perClaim || []).length <= 1
    ? assessment.rule : null;
  return {
    claimId: history.claimId,
    claim: history.claim,
    call: history.current?.call || null,
    oneLine: history.current?.oneLine || null,
    verdictAt: history.current?.at || null,
    timesChecked: history.timesSeen,
    firstCheckedAt: history.firstSeenAt,
    lastCheckedAt: history.lastSeenAt,
    languages: history.languages,
    decidedBy: rule ? { rule, trackRecord: trackRecordFor(rule) } : null,
    recheckDue: history.recheck?.due || null,
    history: history.history.map(h => ({
      assessmentId: h.assessmentId,
      at: h.at,
      trigger: h.trigger,
      call: h.call,
      // claimHistory leaves the one-line reason out of a message with several
      // claims, and the rule of such a message is not this claim's rule.
      rule: h.oneLine ? h.rule || null : null,
      oneLine: h.oneLine || null,
      changeReason: h.changeReason || null,
      evidence: h.evidence
    })),
    evidence: evidenceFor(assessment, history.claim),
    variants: variants.map(v => ({ claimId: v.claimId, claim: v.claim, call: v.call, differences: v.differences || [] }))
  };
};

// ---------------------------------------------------------------- the reads --

/**
 * A page of claims.
 * @returns {Promise<{claims: Array, total: number, limit: number, nextCursor: string|null}>}
 */
const listClaims = async (query) => {
  const params = parseListQuery(query);
  requireDatabase();
  const rows = await ClaimRecord.find(buildListFilter(params))
    .sort(sortSpec(params.sort)).limit(params.limit + 1).select(LIST_FIELDS).lean();
  const page = rows.slice(0, params.limit);
  return {
    claims: page.map(summariseRecord),
    total: await ClaimRecord.countDocuments(buildListFilter(params, false)),
    limit: params.limit,
    nextCursor: rows.length > params.limit ? encodeCursor(params.sort, page[page.length - 1]) : null
  };
};

/** The public records among these ids, in the order the ids were given. */
const publicRecords = async (ids) => {
  const records = await ClaimRecord.find({ _id: { $in: ids }, ...PUBLIC }).select(LIST_FIELDS).lean();
  const byId = new Map(records.map(r => [String(r._id), r]));
  return ids.map(id => byId.get(String(id))).filter(Boolean);
};

/**
 * The claims readers checked most in the last seven days, from the stored
 * assessments, so a claim checked ten times today outranks one checked a
 * hundred times last year. A multi-claim message counts for each of its claims.
 */
const trendingClaims = async (query = {}, now = Date.now()) => {
  const limit = parseLimit(query.limit, SHORT_LIST);
  requireDatabase();
  const rows = await ClaimAssessment.aggregate([
    { $match: { createdAt: { $gte: new Date(now - WINDOW_DAYS * DAY) }, ...READER_CHECKS } },
    { $unwind: '$claimIds' },
    { $group: { _id: '$claimIds', checks: { $sum: 1 }, latest: { $max: '$createdAt' } } },
    { $sort: { checks: -1, latest: -1, _id: -1 } },
    // A test record can sit among the leaders, so more than the page is read.
    { $limit: limit * 3 }
  ]);
  const checks = new Map(rows.map(r => [String(r._id), r.checks]));
  const records = await publicRecords(rows.map(r => r._id));
  return {
    windowDays: WINDOW_DAYS,
    claims: records.slice(0, limit).map(r => ({ ...summariseRecord(r), checksThisWeek: checks.get(String(r._id)) }))
  };
};

/** The latest verdicts that differ from the one before them, and what changed. */
const changedVerdicts = async (query = {}) => {
  const limit = parseLimit(query.limit, SHORT_LIST);
  requireDatabase();
  // A change is only recorded for a check of one claim (services/claimMemory.js).
  const changed = await ClaimAssessment.find({ changeReason: { $type: 'string', $ne: '' }, trigger: { $ne: 'eval' }, claimIds: { $size: 1 } })
    .sort({ createdAt: -1 }).limit(limit * 3)
    .select('createdAt trigger call perClaim changeReason supersedes claimIds').lean();
  const records = new Map((await publicRecords(changed.map(a => a.claimIds[0]))).map(r => [String(r._id), r]));
  const kept = changed.filter(a => records.has(String(a.claimIds[0]))).slice(0, limit);
  const earlier = await ClaimAssessment.find({ _id: { $in: kept.map(a => a.supersedes).filter(Boolean) } })
    .select('call perClaim').lean();
  const earlierById = new Map(earlier.map(a => [String(a._id), a]));
  const callOn = (assessment, claimId) =>
    (assessment.perClaim || []).find(c => String(c.claimId) === String(claimId))?.call || assessment.call;

  return {
    changes: kept.map(a => {
      const claimId = a.claimIds[0];
      const before = earlierById.get(String(a.supersedes));
      return {
        claimId: String(claimId),
        claim: records.get(String(claimId)).claim,
        at: a.createdAt,
        trigger: a.trigger,
        from: before ? callOn(before, claimId) : null,
        to: callOn(a, claimId),
        changeReason: a.changeReason
      };
    })
  };
};

/** Headline numbers for the registry's front page. */
const registryStats = async (now = Date.now()) => {
  requireDatabase();
  const [facets] = await ClaimRecord.aggregate([
    { $match: PUBLIC },
    { $facet: {
      totals: [{ $group: { _id: null, claims: { $sum: 1 }, checks: { $sum: '$timesSeen' }, since: { $min: '$firstSeenAt' } } }],
      calls: [{ $group: { _id: '$current.call', claims: { $sum: 1 } } }],
      languages: [{ $unwind: '$languages' }, { $group: { _id: '$languages', claims: { $sum: 1 } } }, { $sort: { claims: -1, _id: 1 } }]
    } }
  ]);
  const totals = facets.totals[0] || { claims: 0, checks: 0, since: null };
  const calls = Object.fromEntries(CALLS.map(c => [c, 0]));
  let other = 0;
  for (const row of facets.calls) {
    if (CALLS.includes(row._id)) calls[row._id] = row.claims;
    else other += row.claims;
  }
  // Reader checks this week of public claims only. Counting every reader check
  // gave "0 checks, 3 this week" on the front page: readers' checks of a claim
  // the evaluation suites had filed first land under that hidden record.
  const [week] = await ClaimAssessment.aggregate([
    { $match: { createdAt: { $gte: new Date(now - WINDOW_DAYS * DAY) }, ...READER_CHECKS } },
    { $lookup: { from: ClaimRecord.collection.name, localField: 'claimIds', foreignField: '_id', as: 'public',
      pipeline: [{ $match: PUBLIC }, { $project: { _id: 1 } }] } },
    { $match: { 'public.0': { $exists: true } } },
    { $count: 'checks' }
  ]);
  return {
    claims: totals.claims,
    checks: totals.checks,
    checksThisWeek: week ? week.checks : 0,
    calls: { ...calls, other },
    languages: facets.languages.map(l => ({ language: l._id, claims: l.claims })),
    since: totals.since
  };
};

/**
 * One claim's permanent page.
 * @returns {Promise<Object|null>} null when there is no such public claim
 */
const claimDetail = async (id) => {
  if (!isValidId(id)) throw new RegistryError('That is not a claim id.', 400);
  requireDatabase();
  const record = await ClaimRecord.findOne({ _id: id, ...PUBLIC }).select('current.assessmentId variants').lean();
  if (!record) return null;
  const history = await claimHistory(id);
  if (!history) return null;
  const assessment = record.current?.assessmentId
    ? await ClaimAssessment.findById(record.current.assessmentId).select('rule evidence perClaim').lean()
    : null;
  // A related wording is linked only if its own page exists.
  const related = await publicRecords((record.variants || []).map(v => v.claimId));
  const differences = new Map((record.variants || []).map(v => [String(v.claimId), v.differences]));
  const variants = related.map(v => ({
    claimId: String(v._id), claim: v.claim, call: v.current?.call || null, differences: differences.get(String(v._id))
  }));
  return serialiseDetail({ history, assessment, variants });
};

// An outlet's record in claim memory: what readers' checks of its pages concluded, the newest check of
// each message once. Shown beside the published rating, never fed into a verdict: it is the system's own
// output about the outlet, and stays apart from the ratings until it has been validated against them.
const HOST = /^(?=.{3,100}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const parseHost = (raw) => {
  if (typeof raw !== 'string') throw new RegistryError('An outlet is a host name such as thehindu.com.', 400);
  const host = raw.trim().toLowerCase().replace(/^www\./, '');
  if (!HOST.test(host)) throw new RegistryError('An outlet is a host name such as thehindu.com.', 400);
  return host;
};
const OUTLET_MIN_CHECKS = 10;
const summariseOutlet = (host, rows, rating) => {
  const calls = {};
  for (const r of rows) calls[r.call] = (calls[r.call] || 0) + 1;
  const times = rows.map(r => new Date(r.at).getTime()).filter(Number.isFinite);
  return {
    outlet: host,
    checks: rows.length,
    calls,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    published: rating && rating.matched ? { name: rating.matchedName || null, score: rating.score } : null,
    enough: rows.length >= OUTLET_MIN_CHECKS
  };
};
const outletRecord = async (raw) => {
  const host = parseHost(raw);
  requireDatabase();
  const rows = await ClaimAssessment.aggregate([
    { $match: { outlet: host, trigger: 'user', call: { $type: 'string' } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { $ifNull: ['$messageHash', '$_id'] }, call: { $first: '$call' }, at: { $first: '$createdAt' } } },
    { $limit: 5000 }
  ]);
  return summariseOutlet(host, rows, getSourceReputation(host, `https://${host}/`));
};

module.exports = {
  listClaims, trendingClaims, changedVerdicts, registryStats, claimDetail, outletRecord,
  RegistryError, CALLS, MAX_LIMIT,
  __test: {
    isValidId, parseListQuery, parseLimit, encodeCursor, decodeCursor, escapeRegex, searchTerms,
    buildListFilter, sortSpec, safeUrl, summariseRecord, serialiseEvidence, evidenceFor, serialiseDetail, parseHost, summariseOutlet }
};
