const mongoose = require('mongoose');

// Cached trust analysis, keyed by article URL.
// Analysis takes several seconds and several LLM calls, so the first reader
// pays that cost and everyone after them gets the report instantly. Entries
// expire automatically so a re-analysis happens if an article is revisited
// much later.
const trustReportCacheSchema = new mongoose.Schema({
  articleUrl: { type: String, required: true, unique: true, index: true },
  title: { type: String },
  source: { type: String },
  report: { type: mongoose.Schema.Types.Mixed, required: true },
  // Fingerprint of the text this verdict was reached about. A publisher that
  // rewrites a story keeps its URL, so the URL alone cannot say whether a
  // stored verdict is still about the article on screen.
  sourcePrint: { type: String },
  // Whether the verdict may be shown to readers who did not send the text it was reached from: true when
  // it was built from the publisher's own page, or by this server from its own feed (the prewarm script).
  // A verdict built from text a caller sent is shown again only to a caller sending the same text.
  shareable: { type: Boolean },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 } // 14 days
});

module.exports = mongoose.models.TrustReportCache
  || mongoose.model('TrustReportCache', trustReportCacheSchema);
