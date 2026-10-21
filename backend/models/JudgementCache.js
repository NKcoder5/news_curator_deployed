const mongoose = require('mongoose');

/**
 * Model judgements asked at temperature 0, kept for a day (utils/nvidiaNimApi.js callNimApiJson).
 *
 * The key is the judgement's label and a hash of its exact prompt, headlines and all, so a stored answer
 * is only ever reused for the identical question about the identical evidence. Within a day the same
 * check of the same coverage gets the same answer, whichever provider has quota left: measured on
 * 22 Oct, three of four wrong answers in a regression run came back right on a re-run, the difference
 * being which model answered while the lighter Gemini models were out of quota.
 */
const judgementCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  // Which provider and model answered, so a fallback model's judgement is still known as one.
  provider: { type: String, default: null },
  model: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 }
}, { versionKey: false });

module.exports = mongoose.models.JudgementCache || mongoose.model('JudgementCache', judgementCacheSchema);
