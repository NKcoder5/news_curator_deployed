// backend/models/ClaimAssessment.js
//
// One check, kept exactly as it was made. Append-only: a later check of the
// same claim adds a new assessment that points back to this one; nothing here
// is ever updated in place.
//
// It stores what is needed to reproduce and to explain the verdict:
//   - the inputs the verdict engine read (ledgerInput), with the moment it was
//     reached (asOf), so replaying them gives the identical verdict;
//   - the evidence shown to the reader, with the words each outlet reported;
//   - which model answered each judgement, and the versions of the verdict
//     engine and routing table in force;
//   - a fingerprint of the message, never its text.
const mongoose = require('mongoose');

const claimAssessmentSchema = new mongoose.Schema({
  claimIds: { type: [mongoose.Schema.Types.ObjectId], index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  asOf: Date,
  trigger: { type: String, default: 'user' },   // user | recheck | eval
  messageHash: String,
  language: String,
  speechAct: String,
  modality: String,
  // The host of the page a reader submitted, when a link was checked (never its address): the outlet
  // record (services/claimRegistry.js outletRecord) counts by it.
  outlet: { type: String, index: true },
  call: String,
  verdict: String,
  rule: String,
  confidence: Number,
  oneLine: String,
  perClaim: [{
    claimId: mongoose.Schema.Types.ObjectId, claim: String, status: String, call: String,
    independentSupport: Number, independentContradiction: Number, _id: false
  }],
  evidence: [{
    channel: String, side: String, claim: String, source: String, url: String,
    title: String, reported: String, publishedAt: String, _id: false
  }],
  ledgerInput: mongoose.Schema.Types.Mixed,
  versions: {
    schema: Number,
    engine: String,
    routing: String,
    models: [{ label: String, provider: String, model: String, ms: Number, cached: Boolean, _id: false }]
  },
  supersedes: mongoose.Schema.Types.ObjectId,
  changeReason: String
});

module.exports = mongoose.model('ClaimAssessment', claimAssessmentSchema);
