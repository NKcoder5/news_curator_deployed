// backend/services/claimMemory.js
//
// The claim memory: every check kept as a record that can be found again,
// compared with what came before, and replayed.
//
// Without it the system answered each message as if it had never seen
// anything: the same rumour cost a full check every time, could come back with
// a different answer on a different day, and nothing anyone had concluded could
// be produced again later. Now each check is stored as an append-only
// assessment (models/ClaimAssessment.js) holding the exact inputs the verdict
// engine read, and each claim in it is filed under a record (models/
// ClaimRecord.js) that recognises the claim when it comes back — reworded,
// translated, or with a figure changed.
//
// What is stored is the claim and its evidence, not the person's message: only
// a fingerprint of the message is kept, and no user is linked to a claim.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ClaimRecord = require('../models/ClaimRecord');
const ClaimAssessment = require('../models/ClaimAssessment');
const { signatureOf, compareSignatures } = require('./claimSignature');
const { sameClaim } = require('./claimMatchJudge');
const { replayVerdict } = require('../agents/verdictEngine');

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
const fileHash = (...files) => sha1(files.map(f => {
  try { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); } catch (_) { return ''; }
}).join('\n'));

// The code and data a verdict depends on. A replay is only expected to agree
// when these are unchanged; when they have changed, the replay says so.
const ENGINE_VERSION = fileHash('agents/verdictEngine.js', 'agents/independence.js', 'data/evidenceWeights.json');
const routingVersion = () => fileHash('data/taskRouting.json');

const connected = () => mongoose.connection.readyState === 1;

const fingerprint = (text) => crypto.createHash('sha256')
  .update(String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');

const STATUS_CALL = { confirmed: 'REAL', contradicted: 'FAKE', unreported: 'CANNOT VERIFY' };
const statusOf = (entry) => (entry?.independentContradiction > 0 ? 'contradicted'
  : entry?.independentSupport > 0 ? 'confirmed' : 'unreported');

/** The evidence shown to the reader, flattened, with the words each source reported. */
const evidenceSnapshot = (report) => {
  const out = [];
  const verification = (report.factors || []).find(f => f.id === 'verification');
  for (const c of verification?.detail?.claims || []) {
    for (const e of c.supportingEvidence || []) out.push({ channel: 'news', side: 'for', claim: c.claim, source: e.source, url: e.url, title: e.title, reported: e.reported || '', publishedAt: e.publishedAt || '' });
    for (const e of c.contradictingEvidence || []) out.push({ channel: 'news', side: 'against', claim: c.claim, source: e.source, url: e.url, title: e.title, reported: e.reported || '', publishedAt: e.publishedAt || '' });
  }
  for (const m of report.factChecks?.matches || []) {
    out.push({ channel: 'factcheck', side: m.finding === 'true' ? 'for' : 'against', source: m.publisher, url: m.url, title: m.claimReviewed || '', reported: m.rating || m.finding, publishedAt: m.reviewedAt || '' });
  }
  if (report.currentCoverage?.counted) {
    for (const h of report.currentCoverage.presupposingFalse || []) {
      out.push({ channel: 'week', side: 'against', source: h.source, url: h.url, title: h.title, reported: h.reported || '', publishedAt: h.publishedAt || '' });
    }
  }
  for (const c of report.premiseCheck?.contradictions || []) {
    out.push({ channel: 'reference', side: 'against', source: c.reference?.title || c.entity, url: c.reference?.url || '', title: c.articleStates || '', reported: c.referenceStates || '' });
  }
  for (const c of report.premiseCheck?.confirmations || []) {
    out.push({ channel: 'reference', side: 'for', source: c.reference?.title || c.entity, url: c.reference?.url || '', title: '', reported: c.referenceStates || '' });
  }
  return out.slice(0, 40);
};

// When to look again at a claim that could not be settled: 6 hours after it
// was checked, then 24, then 72 (services/recheckScheduler.js runs them).
const RECHECK_HOURS = [6, 24, 72];

/**
 * Book, advance or clear a record's next re-check after a check of it.
 * Only claims readers checked are booked; a settled verdict clears the booking.
 */
const bookRecheck = (record, call, trigger, now = Date.now()) => {
  if (record.origin !== 'user') return;
  const rc = record.recheck || {};
  const attempts = rc.attempts || 0;
  if (call !== 'CANNOT VERIFY') {
    record.recheck = { due: null, stage: rc.stage || 0, attempts };
  } else if (trigger === 'recheck') {
    const stage = (rc.stage || 0) + 1;
    record.recheck = { due: stage < RECHECK_HOURS.length ? new Date(now + RECHECK_HOURS[stage] * 3600000) : null, stage, attempts };
  } else if (!rc.due) {
    // A reader asking again restarts the schedule: the claim is still about.
    record.recheck = { due: new Date(now + RECHECK_HOURS[0] * 3600000), stage: 0, attempts };
  }
};

const listNames = (names) => (names.length <= 1 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Why a verdict changed, from the difference between the evidence then and
 * now: who newly reports it, who newly contradicts it, which fact-checker
 * newly ruled, which earlier sources are gone. When the evidence is the same,
 * says so — the rules changed, or only the evidence's age did.
 */
const describeChange = ({ prevCall, call, prevEvidence = [], evidence = [], prevEngine = null, trigger = 'user' }) => {
  const key = (e) => `${e.channel}|${e.side}|${String(e.source || '').toLowerCase()}`;
  const before = new Set(prevEvidence.map(key));
  const after = new Set(evidence.map(key));
  const added = evidence.filter(e => !before.has(key(e)));
  const gone = prevEvidence.filter(e => !after.has(key(e)));
  const names = (list) => [...new Set(list.map(e => e.source).filter(Boolean))];
  const some = (list) => listNames(list.slice(0, 3)) + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  const parts = [];
  const rulings = names(added.filter(e => e.channel === 'factcheck'));
  if (rulings.length) parts.push(`${some(rulings)} ${rulings.length === 1 ? 'has' : 'have'} ruled on it`);
  const confirming = names(added.filter(e => e.channel !== 'factcheck' && e.side === 'for'));
  if (confirming.length) parts.push(`${confirming.length} new ${confirming.length === 1 ? 'source confirms' : 'sources confirm'} it (${some(confirming)})`);
  const against = names(added.filter(e => e.channel !== 'factcheck' && e.side === 'against'));
  if (against.length) parts.push(`${against.length} new ${against.length === 1 ? 'source reports' : 'sources report'} otherwise (${some(against)})`);
  const lost = names(gone);
  if (lost.length) parts.push(`${lost.length} earlier ${lost.length === 1 ? 'source is' : 'sources are'} no longer found (${some(lost)})`);
  if (!parts.length) {
    parts.push(prevEngine && prevEngine !== ENGINE_VERSION
      ? 'the evidence is the same; the rules that weigh it have been updated since'
      : 'the evidence is the same; only its age has changed');
  }
  return `Verdict changed from ${prevCall} to ${call}${trigger === 'recheck' ? ' on an automatic re-check' : ''}: ${parts.join('; ')}.`;
};

/**
 * The record a claim belongs to: the same claim if one is known (by exact
 * signature, or by comparison with records sharing a name), otherwise a new
 * record. Variants found on the way are returned and linked both ways.
 */
const fileClaim = async (claimText, signature, { origin, subject }) => {
  let record = await ClaimRecord.findOne({ key: signature.key });
  const variants = [];
  if (!record && signature.entities.length) {
    const candidates = await ClaimRecord.find({ 'signature.entities': { $in: signature.entities } })
      .sort({ lastSeenAt: -1 }).limit(60);
    let best = null;
    const ambiguous = [];
    for (const candidate of candidates) {
      const cmp = compareSignatures(signature, candidate.signature);
      if (cmp.relation === 'same' && (!best || cmp.score > best.score)) best = { record: candidate, score: cmp.score };
      if (cmp.relation === 'variant') variants.push({ record: candidate, differences: cmp.differences });
      if (cmp.ambiguous) ambiguous.push({ record: candidate, score: cmp.score });
    }
    // Same names, same figures, different wording: a model settles at most
    // three of these, best first. It is told a false merge is the worse error.
    if (!best) {
      for (const a of ambiguous.sort((x, y) => y.score - x.score).slice(0, 3)) {
        if (await sameClaim(claimText, a.record.claim)) { best = a; break; }
      }
    }
    if (best) record = best.record;
  }
  const created = !record;
  if (!record) {
    record = new ClaimRecord({
      key: signature.key, claim: claimText,
      signature: { entities: signature.entities, numbers: signature.numbers, years: signature.years, terms: signature.terms, negated: signature.negated },
      subjects: subject ? [subject] : [], origin, firstSeenAt: new Date(), timesSeen: 0
    });
  }
  return { record, created, variants: variants.slice(0, 5) };
};

const subjectIn = (understanding, claim) => (understanding?.claims || []).find(c => c.claim === claim)?.subject
  || (understanding?.checkableClaims || []).find(c => c.claim === claim)?.subject || null;

/**
 * What the memory knows about these claims, read without writing anything.
 *
 * Only the claims are needed, not the verdict, so a check runs this beside its
 * evidence channels instead of after them. Measured: with ambiguous matches,
 * filing a claim asks a model up to three times, one after another, and that
 * used to sit between the verdict and the reader.
 *
 * @param {Object} args
 * @param {string[]} args.claims - the claim sentences, in the order checked
 * @returns {Promise<Object|null>} a plan for prepareRecord, or null when the
 *   database is not connected
 */
const lookupClaims = async ({ claims = [], understanding = null, trigger = 'user', recheckOf = null }) => {
  if (!connected() || !claims.length) return null;
  const origin = trigger === 'recheck' ? 'recheck' : trigger === 'eval' ? 'eval' : 'user';

  // A re-check is filed under the record it was run for, whatever wording
  // the claim comes back in, so the record's history does not fork.
  const recheckRecord = recheckOf && mongoose.isValidObjectId(recheckOf) ? await ClaimRecord.findById(recheckOf) : null;

  const entries = await Promise.all(claims.map(async (claim, index) => {
    const signature = signatureOf(claim);
    const forRecheck = index === 0 && recheckRecord;
    if (!signature.entities.length && !signature.numbers.length && !forRecheck) return { claim, skip: true };   // names nothing; not filed
    const { record, created, variants } = forRecheck
      ? { record: recheckRecord, created: false, variants: [] }
      : await fileClaim(claim, signature, { origin, subject: subjectIn(understanding, claim) });
    const previous = !created && record.current?.assessmentId
      ? { call: record.current.call, oneLine: record.current.oneLine, at: record.current.at, assessmentId: record.current.assessmentId }
      : null;
    // The evidence a changed verdict will be compared with, read now so the
    // comparison costs nothing once the verdict is in.
    const prior = previous && claims.length === 1
      ? await ClaimAssessment.findById(previous.assessmentId).select('evidence versions').lean()
      : null;
    return { claim, record, created, variants, previous, prior };
  }));
  return { claims, entries };
};

/**
 * What a finished check adds to the memory, worked out without writing it.
 *
 * @param {Object|null} plan - from lookupClaims, for the same claims
 * @returns {{memory: Object, write: Function}|null} `memory` is what the page
 *   shows ("checked before", "a variant of …"), exactly as it will be stored;
 *   `write` stores it. Null when there is nothing to store.
 */
const prepareRecord = (plan, { report, understanding = null, ledgerInput, modelCalls = [], messageText = '', trigger = 'user', modality = 'text' }) => {
  if (!plan || !ledgerInput || !(ledgerInput.claims || []).length) return null;

  const now = new Date();
  const single = ledgerInput.claims.length === 1;
  const perClaimReport = report.evidence?.perClaim || [];

  // The ledger's claims, in its order, each with what the lookup found.
  const filed = [];
  for (const c of ledgerInput.claims) {
    const entry = plan.entries.find(e => e.claim === c.claim);
    if (!entry || entry.skip) continue;
    const status = statusOf(perClaimReport.find(x => x.claim === c.claim));
    filed.push({ ...entry, status, call: single ? report.call : STATUS_CALL[status] });
  }
  if (!filed.length) return null;

  // A verdict that differs from the last one on the same claim says what
  // changed, from the difference between the evidence then and now.
  const lead = filed[0];
  const evidence = evidenceSnapshot(report);
  const changeReason = single && lead.previous && lead.previous.call !== lead.call
    ? describeChange({
      prevCall: lead.previous.call, call: lead.call, trigger,
      prevEvidence: lead.prior?.evidence || [], evidence, prevEngine: lead.prior?.versions?.engine || null
    })
    : null;

  // The id is chosen here, so the page can link the record before it is written.
  const assessmentId = new mongoose.Types.ObjectId();
  const currentFor = (f) => ({ call: f.call, status: f.status, rule: single ? report.decision?.rule : 'per-claim',
    oneLine: single ? report.oneLine : null, at: now, assessmentId });

  // When a re-check is next due, as the write will book it.
  const recheckDue = (f) => {
    const plain = typeof f.record.toObject === 'function' ? f.record.toObject() : f.record;
    const probe = { origin: plain.origin, recheck: plain.recheck ? { ...plain.recheck } : {} };
    bookRecheck(probe, f.call, trigger, now.getTime());
    return probe.recheck?.due || null;
  };

  const memory = {
    assessmentId: String(assessmentId),
    claims: filed.map(f => ({
      claimId: String(f.record._id),
      claim: f.record.claim,
      timesSeen: (f.record.timesSeen || 0) + 1,
      firstSeenAt: f.record.firstSeenAt,
      previous: f.previous ? { call: f.previous.call, oneLine: f.previous.oneLine, at: f.previous.at } : null,
      recheckDue: recheckDue(f),
      variants: f.variants.map(v => ({
        claimId: String(v.record._id), claim: v.record.claim, differences: v.differences,
        call: v.record.current?.call || null, at: v.record.current?.at || null
      }))
    })),
    changeReason
  };

  const write = async () => {
    // Records must exist before the assessment can point at them. Another
    // check of the same new claim may have filed it in the meantime; then
    // this one is filed under that record rather than failing.
    for (const f of filed) {
      if (!f.created) continue;
      try {
        await f.record.save();
      } catch (err) {
        if (err.code !== 11000) throw err;
        const existing = await ClaimRecord.findOne({ key: f.record.key });
        if (!existing) throw err;
        f.record = existing;
        f.created = false;
      }
    }

    await ClaimAssessment.create({
      _id: assessmentId,
      claimIds: filed.map(f => f.record._id),
      asOf: new Date(ledgerInput.asOf || Date.now()),
      trigger,
      messageHash: messageText ? fingerprint(messageText) : null,
      language: understanding?.language || null,
      speechAct: understanding?.speechAct || null,
      modality,
      call: report.call,
      verdict: report.verdictClass || report.decision?.verdict,
      rule: report.decision?.rule,
      confidence: report.decision?.confidence,
      oneLine: report.oneLine,
      perClaim: filed.map(f => {
        const entry = perClaimReport.find(x => x.claim === f.claim) || {};
        return { claimId: f.record._id, claim: f.claim, status: f.status, call: f.call,
          independentSupport: entry.independentSupport || 0, independentContradiction: entry.independentContradiction || 0 };
      }),
      evidence,
      ledgerInput,
      versions: { schema: report.schemaVersion, engine: ENGINE_VERSION, routing: routingVersion(), models: modelCalls.slice(0, 60) },
      supersedes: single && lead.previous ? lead.previous.assessmentId : undefined,
      changeReason
    });

    for (const f of filed) {
      // Read again just before it is changed: the check took seconds, and
      // another check of the same claim may have been filed meanwhile.
      const r = f.created ? f.record : (await ClaimRecord.findById(f.record._id)) || f.record;
      r.timesSeen = (r.timesSeen || 0) + 1;
      r.lastSeenAt = now;
      r.phrasings = [...(r.phrasings || []), { text: f.claim, language: understanding?.language || 'en', at: now }].slice(-20);
      if (understanding?.language && !r.languages.includes(understanding.language)) r.languages.push(understanding.language);
      const subject = subjectIn(understanding, f.claim);
      if (subject && !r.subjects.includes(subject)) r.subjects.push(subject);
      r.current = currentFor(f);
      bookRecheck(r, f.call, trigger, now.getTime());
      for (const v of f.variants) {
        if (!r.variants.some(x => String(x.claimId) === String(v.record._id))) {
          r.variants.push({ claimId: v.record._id, claim: v.record.claim, differences: v.differences, at: now });
          r.variants = r.variants.slice(-20);
        }
        const other = (await ClaimRecord.findById(v.record._id)) || v.record;
        if (!other.variants.some(x => String(x.claimId) === String(r._id))) {
          other.variants.push({ claimId: r._id, claim: r.claim, differences: v.differences, at: now });
          other.variants = other.variants.slice(-20);
          await other.save();
        }
      }
      await r.save();
    }
  };

  return { memory, write, recordIds: filed.map(f => String(f.record._id)), assessmentId: String(assessmentId) };
};

/**
 * Store one finished check, all at once: the lookup, then the write.
 *
 * Check Anything does the two apart — the lookup beside the evidence channels,
 * the write after the reader has the answer — and this is the same work in one
 * call, for callers that do not need that.
 *
 * @returns {Promise<Object|null>} what the memory knew before this check, for
 *   the page ("checked before", "a variant of …"), or null when the database is
 *   not connected (tests, evaluation scripts) or there was nothing to store.
 */
const recordCheck = async ({ report, understanding = null, ledgerInput, modelCalls = [], messageText = '', trigger = 'user', modality = 'text', recheckOf = null }) => {
  if (!connected() || !ledgerInput || !(ledgerInput.claims || []).length) return null;
  const plan = await lookupClaims({ claims: ledgerInput.claims.map(c => c.claim), understanding, trigger, recheckOf });
  const prepared = prepareRecord(plan, { report, understanding, ledgerInput, modelCalls, messageText, trigger, modality });
  if (!prepared) return null;
  await prepared.write();
  return prepared.memory;
};

/**
 * Is a stored verdict still the latest on its claims? True when every record
 * still points at that assessment: no re-check and no other check of the same
 * claim has been filed since.
 *
 * @returns {Promise<Array|null>} the records' times seen, or null when not current
 */
const stillCurrent = async (recordIds = [], assessmentId) => {
  if (!connected() || !recordIds.length || !mongoose.isValidObjectId(assessmentId)) return null;
  const records = await ClaimRecord.find({ _id: { $in: recordIds } }).select('timesSeen current.assessmentId').lean();
  if (records.length !== recordIds.length) return null;
  if (!records.every(r => String(r.current?.assessmentId) === String(assessmentId))) return null;
  return recordIds.map(id => records.find(r => String(r._id) === String(id)).timesSeen || 0);
};

/** Count a claim asked about again and answered from a check minutes old. */
const noteSeenAgain = (recordIds = []) => (connected() && recordIds.length
  ? ClaimRecord.updateMany({ _id: { $in: recordIds } }, { $inc: { timesSeen: 1 }, $set: { lastSeenAt: new Date() } })
  : Promise.resolve(null));

/**
 * Reach a stored verdict again from its recorded inputs.
 * @returns {{call, rule, same: boolean, engineChanged: boolean}}
 */
const replayAssessment = (doc) => {
  const decision = replayVerdict(doc.ledgerInput);
  return {
    call: decision.call,
    rule: decision.rule,
    same: decision.call === doc.call && decision.rule === doc.rule,
    engineChanged: Boolean(doc.versions?.engine) && doc.versions.engine !== ENGINE_VERSION
  };
};

/**
 * A claim's record and every verdict reached on it, oldest first, for the
 * page's timeline. Holds claims and verdicts only: no message, no reader.
 * @returns {Promise<Object|null>} null when unknown or the database is down
 */
const claimHistory = async (id) => {
  if (!connected() || !mongoose.isValidObjectId(id)) return null;
  const record = await ClaimRecord.findById(id).lean();
  if (!record) return null;
  const assessments = await ClaimAssessment.find({ claimIds: record._id })
    .sort({ createdAt: 1 }).limit(100)
    .select('createdAt trigger call rule oneLine perClaim changeReason evidence').lean();
  return {
    claimId: String(record._id),
    claim: record.claim,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    timesSeen: record.timesSeen,
    languages: record.languages || [],
    current: record.current ? { call: record.current.call, oneLine: record.current.oneLine, at: record.current.at } : null,
    recheck: { due: record.recheck?.due || null, stage: record.recheck?.stage || 0, of: RECHECK_HOURS.length },
    variants: (record.variants || []).map(v => ({ claimId: String(v.claimId), claim: v.claim, differences: v.differences })),
    history: assessments.map(a => {
      const own = (a.perClaim || []).find(c => String(c.claimId) === String(record._id));
      const ev = a.evidence || [];
      return {
        assessmentId: String(a._id),
        at: a.createdAt,
        trigger: a.trigger,
        call: own?.call || a.call,
        rule: a.rule,
        oneLine: (a.perClaim || []).length > 1 ? null : a.oneLine,
        changeReason: a.changeReason || null,
        evidence: {
          for: ev.filter(e => e.side === 'for' && e.channel !== 'factcheck').length,
          against: ev.filter(e => e.side === 'against' && e.channel !== 'factcheck').length,
          rulings: ev.filter(e => e.channel === 'factcheck').length
        }
      };
    })
  };
};

module.exports = {
  recordCheck, lookupClaims, prepareRecord, stillCurrent, noteSeenAgain,
  replayAssessment, evidenceSnapshot, fingerprint, claimHistory, describeChange, bookRecheck, ENGINE_VERSION, RECHECK_HOURS
};
