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

/**
 * Store one finished check.
 *
 * @returns {Promise<Object|null>} what the memory knew before this check, for
 *   the page ("checked before", "a variant of …"), or null when the database is
 *   not connected (tests, evaluation scripts) or there was nothing to store.
 */
const recordCheck = async ({ report, understanding = null, ledgerInput, modelCalls = [], messageText = '', trigger = 'user', modality = 'text' }) => {
  if (!connected() || !ledgerInput || !(ledgerInput.claims || []).length) return null;

  const now = new Date();
  const origin = trigger === 'eval' ? 'eval' : 'user';
  const single = ledgerInput.claims.length === 1;
  const perClaimReport = report.evidence?.perClaim || [];
  const subjectFor = (claim) => (understanding?.claims || []).find(c => c.claim === claim)?.subject
    || (understanding?.checkableClaims || []).find(c => c.claim === claim)?.subject || null;

  const filed = [];
  for (const c of ledgerInput.claims) {
    const signature = signatureOf(c.claim);
    if (!signature.entities.length && !signature.numbers.length) continue;   // names nothing; not filed
    const { record, created, variants } = await fileClaim(c.claim, signature, { origin, subject: subjectFor(c.claim) });
    const status = statusOf(perClaimReport.find(x => x.claim === c.claim));
    const call = single ? report.call : STATUS_CALL[status];
    const previous = !created && record.current?.assessmentId
      ? { call: record.current.call, oneLine: record.current.oneLine, at: record.current.at, assessmentId: record.current.assessmentId }
      : null;
    filed.push({ claim: c.claim, record, created, variants, status, call, previous });
  }
  if (!filed.length) return null;

  // A verdict that differs from the last one on the same claim says what
  // changed. Day-one version: the change itself; the evidence diff follows.
  const lead = filed[0];
  const changeReason = single && lead.previous && lead.previous.call !== lead.call
    ? `Verdict changed from ${lead.previous.call} to ${lead.call}.`
    : null;

  // Records must exist before the assessment can point at them.
  for (const f of filed) if (f.created) await f.record.save();

  const assessment = await ClaimAssessment.create({
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
    evidence: evidenceSnapshot(report),
    ledgerInput,
    versions: { schema: report.schemaVersion, engine: ENGINE_VERSION, routing: routingVersion(), models: modelCalls.slice(0, 60) },
    supersedes: single && lead.previous ? lead.previous.assessmentId : undefined,
    changeReason
  });

  for (const f of filed) {
    const r = f.record;
    r.timesSeen = (r.timesSeen || 0) + 1;
    r.lastSeenAt = now;
    r.phrasings = [...(r.phrasings || []), { text: f.claim, language: understanding?.language || 'en', at: now }].slice(-20);
    if (understanding?.language && !r.languages.includes(understanding.language)) r.languages.push(understanding.language);
    const subject = subjectFor(f.claim);
    if (subject && !r.subjects.includes(subject)) r.subjects.push(subject);
    r.current = { call: f.call, status: f.status, rule: single ? report.decision?.rule : 'per-claim',
      oneLine: single ? report.oneLine : null, at: now, assessmentId: assessment._id };
    for (const v of f.variants) {
      if (!r.variants.some(x => String(x.claimId) === String(v.record._id))) {
        r.variants.push({ claimId: v.record._id, claim: v.record.claim, differences: v.differences, at: now });
        r.variants = r.variants.slice(-20);
      }
      if (!v.record.variants.some(x => String(x.claimId) === String(r._id))) {
        v.record.variants.push({ claimId: r._id, claim: r.claim, differences: v.differences, at: now });
        v.record.variants = v.record.variants.slice(-20);
        await v.record.save();
      }
    }
    await r.save();
  }

  return {
    assessmentId: String(assessment._id),
    claims: filed.map(f => ({
      claimId: String(f.record._id),
      claim: f.record.claim,
      timesSeen: f.record.timesSeen,
      firstSeenAt: f.record.firstSeenAt,
      previous: f.previous ? { call: f.previous.call, oneLine: f.previous.oneLine, at: f.previous.at } : null,
      variants: f.variants.map(v => ({
        claimId: String(v.record._id), claim: v.record.claim, differences: v.differences,
        call: v.record.current?.call || null, at: v.record.current?.at || null
      }))
    })),
    changeReason
  };
};

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

module.exports = { recordCheck, replayAssessment, evidenceSnapshot, fingerprint, ENGINE_VERSION };
