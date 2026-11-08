const mongoose = require('mongoose');

// Cached article summaries, keyed by article URL and kind ("short" | "detailed").
//
// Summaries used to be regenerated on every page load. Even at a low
// temperature that produces small variations, and a reader who opened the same
// article twice saw two different summaries — which reasonably looks like the
// system contradicting itself. Generating once and storing the result makes an
// article's summary stable, and makes the second visit instant.
//
// Entries expire so a re-visit much later re-summarises with the current model.
const summaryCacheSchema = new mongoose.Schema({
  articleUrl: { type: String, required: true, index: true },
  kind: { type: String, required: true, enum: ['short', 'detailed'] },
  summary: { type: String, required: true },
  // What this summary was written from. Keyed on URL alone, a summary of a
  // story the publisher has since replaced kept being served beside the new
  // text: the page said the Nasdaq had hit a record while the summary below it
  // described a sell-off nine days earlier. Same URL, different article.
  sourcePrint: { type: String },
  // Written from the publisher's own page, read by this server. Only such a summary may be shown to a
  // caller whose text cannot be compared with sourcePrint (routes/aiRoutes.js, isUsableSummary).
  shareable: { type: Boolean },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 } // 14 days
});

// One summary per article per kind.
summaryCacheSchema.index({ articleUrl: 1, kind: 1 }, { unique: true });

module.exports = mongoose.models.SummaryCache
  || mongoose.model('SummaryCache', summaryCacheSchema);
