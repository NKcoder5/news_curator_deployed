// backend/models/ClaimRecord.js
//
// One claim the system has checked, kept across checks.
//
// A record is the claim, not the message: "India won 84 medals at the Asian
// Games 2026" is one record whether it arrived in English, in Tamil, as a
// question or in a forward. It holds the canonical English sentence, the
// signature used to recognise it again (names, figures, years, negation), the
// phrasings it has arrived in, and a pointer to its latest assessment. The
// assessments themselves are append-only (ClaimAssessment), so the record's
// history is never rewritten.
//
// No user's message text is stored, and no user is linked to a claim: what
// people forward is private, and the claim is all a later check needs.
const mongoose = require('mongoose');

const claimRecordSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  claim: { type: String, required: true },
  signature: {
    entities: { type: [String], index: true },
    numbers: [{ value: Number, unit: String, raw: String, _id: false }],
    years: [String],
    terms: [String],
    negated: Boolean,
    roles: [String]                // [who, to whom] for "X beat Y"; empty otherwise
  },
  subjects: [String],
  // The English sentences this claim has been read as, newest last.
  phrasings: [{ text: String, language: String, at: Date, _id: false }],
  languages: [String],
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  timesSeen: { type: Number, default: 0 },
  // The latest verdict on this claim alone.
  current: {
    call: String,
    status: String,
    rule: String,
    oneLine: String,
    at: Date,
    assessmentId: mongoose.Schema.Types.ObjectId
  },
  // Claims about the same thing with a different figure, date or polarity.
  variants: [{ claimId: mongoose.Schema.Types.ObjectId, claim: String, differences: [String], at: Date, _id: false }],
  // When to look again at a claim that could not be settled (services/recheckScheduler.js).
  recheck: {
    due: { type: Date, index: true },
    stage: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 }
  },
  // 'user' for claims people sent; 'eval' for claims created by the evaluation
  // suites, which are never re-checked automatically.
  origin: { type: String, default: 'user' }
});

// The public registry (services/claimRegistry.js) lists claims newest-checked
// first or most-checked first and pages by position in that order; without
// these it would sort the whole collection for every page.
claimRecordSchema.index({ lastSeenAt: -1 });
claimRecordSchema.index({ timesSeen: -1, lastSeenAt: -1 });

module.exports = mongoose.model('ClaimRecord', claimRecordSchema);
